-- Run in Supabase SQL Editor. This version targets public; use the supplied
-- dev version for SUPABASE_DB_SCHEMA=dev. No existing results are modified.
begin;

create table if not exists public.league_availability_releases (
  guild_id text not null, season_id text not null, week integer not null check (week > 0),
  released_on date not null, original_due_on date not null, released_at timestamptz not null default now(),
  primary key (guild_id, season_id, week), check (original_due_on > released_on)
);
-- IDs are text because deployed league schemas use different ID types. Every
-- mutation validates the ID, season and current participants against matches.
create table if not exists public.league_availability (
  match_id text primary key, guild_id text not null, season_id text not null,
  week integer not null check (week > 0), player_a_id text not null, player_b_id text not null,
  released_on date not null, original_due_on date not null, effective_due_on date not null,
  a_response text check (a_response in ('available','unavailable')),
  b_response text check (b_response in ('available','unavailable')),
  a_days date[] not null default '{}', b_days date[] not null default '{}',
  a_note text not null default '' check (length(a_note) <= 300),
  b_note text not null default '' check (length(b_note) <= 300),
  revealed_at timestamptz,
  extension_status text not null default 'none' check (extension_status in ('none','pending','review','approved','declined')),
  extension_requested_by text, extension_requested_at timestamptz,
  extension_proposed_on date, extension_decided_by text, extension_decided_at timestamptz,
  extension_used boolean not null default false, request_version integer not null default 0,
  review_notice_version integer not null default 0,
  version bigint not null default 1, updated_at timestamptz not null default now(),
  foreign key (guild_id, season_id, week) references public.league_availability_releases on delete cascade,
  check (player_a_id <> player_b_id),
  check (cardinality(a_days) <= 15 and cardinality(b_days) <= 15),
  check (effective_due_on >= original_due_on and effective_due_on <= original_due_on + 7)
);
create index if not exists league_availability_week_idx on public.league_availability(guild_id,season_id,week);
create table if not exists public.league_availability_messages (
  match_id text not null references public.league_availability on delete cascade,
  user_id text not null, channel_id text, message_id text,
  status text not null default 'pending' check (status in ('pending','sent','failed')),
  sent_version bigint not null default 0, claim_token text, lease_until timestamptz,
  retry_at timestamptz not null default now(), last_error text,
  reminder_sent_at timestamptz, reminder_token text, reminder_retry_at timestamptz not null default now(),
  primary key (match_id,user_id)
);
create table if not exists public.league_availability_events (
  id bigint generated always as identity primary key,
  match_id text not null references public.league_availability on delete cascade,
  actor_id text, action text not null, detail jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index if not exists league_availability_events_match_idx on public.league_availability_events(match_id,id);

create or replace function public.league_availability_release(p_guild text,p_season text,p_week integer)
returns setof public.league_availability language plpgsql security invoker set search_path = '' as $$
declare r public.league_availability_releases; v_match record; old public.league_availability;
  today date := (now() at time zone 'Europe/London')::date;
begin
  if not exists(select 1 from public.seasons s where s.id::text=p_season and s.guild_id::text=p_guild and s.status='active') then
    raise exception 'Start the season before releasing availability.';
  end if;
  if p_week < 1 or not exists(select 1 from public.matches m where m.season_id::text=p_season and m.week=p_week) then
    raise exception 'There are no fixtures for that week.';
  end if;
  insert into public.league_availability_releases(guild_id,season_id,week,released_on,original_due_on) values(p_guild,p_season,p_week,today,today+(7-extract(dow from today)::integer)) on conflict do nothing;
  select * into r from public.league_availability_releases where guild_id=p_guild and season_id=p_season and week=p_week for update;
  for v_match in select id::text id,player_a_id::text a,player_b_id::text b from public.matches where season_id::text=p_season and week=p_week and status='scheduled' loop
    select * into old from public.league_availability where match_id=v_match.id for update;
    if not found then
      insert into public.league_availability(match_id,guild_id,season_id,week,player_a_id,player_b_id,released_on,original_due_on,effective_due_on)
        values(v_match.id,p_guild,p_season,p_week,v_match.a,v_match.b,r.released_on,r.original_due_on,r.original_due_on);
      insert into public.league_availability_events(match_id,action) values(v_match.id,'released');
    elsif old.player_a_id<>v_match.a or old.player_b_id<>v_match.b then
      update public.league_availability set player_a_id=v_match.a,player_b_id=v_match.b,
        a_response=null,b_response=null,a_days='{}',b_days='{}',a_note='',b_note='',revealed_at=null,
        effective_due_on=original_due_on,extension_status='none',extension_requested_by=null,extension_requested_at=null,
        extension_proposed_on=null,extension_decided_by=null,extension_decided_at=null,extension_used=false,
        request_version=request_version+1,version=version+1,updated_at=now() where match_id=v_match.id;
      delete from public.league_availability_messages where match_id=v_match.id and user_id not in (v_match.a,v_match.b);
      insert into public.league_availability_events(match_id,action,detail) values(v_match.id,'participants_changed',jsonb_build_object('old_a',old.player_a_id,'old_b',old.player_b_id,'new_a',v_match.a,'new_b',v_match.b));
    end if;
  end loop;
  return query select a.* from public.league_availability a join public.matches m on m.id::text=a.match_id
    where a.guild_id=p_guild and a.season_id=p_season and a.week=p_week and m.status='scheduled';
end $$;

create or replace function public.league_availability_act(p_match text,p_actor text,p_action text,p_payload jsonb default '{}',p_admin boolean default false)
returns public.league_availability language plpgsql security invoker set search_path = '' as $$
declare a public.league_availability; before_row jsonb; v_match record; days date[]; note text;
  today date := (now() at time zone 'Europe/London')::date; requested_version integer;
begin
  select * into a from public.league_availability where match_id=p_match for update;
  if not found then raise exception 'This fixture has not been released for availability.'; end if;
  select m.player_a_id::text pa,m.player_b_id::text pb,m.status::text ms,s.status::text ss,s.guild_id::text gid into v_match
    from public.matches m join public.seasons s on s.id=m.season_id where m.id::text=p_match for share of m,s;
  if not found or v_match.pa<>a.player_a_id or v_match.pb<>a.player_b_id or v_match.gid<>a.guild_id then raise exception 'This fixture has changed. Ask an admin to release its availability again.'; end if;
  if v_match.ss<>'active' or v_match.ms<>'scheduled' then raise exception 'Availability is closed for this match.'; end if;
  if p_action in ('approve','keep') then
    if p_admin is not true then raise exception 'Only an admin can decide this request.'; end if;
  elsif p_actor not in (a.player_a_id,a.player_b_id) then raise exception 'This is not your match.'; end if;
  if p_actor is null or p_actor='' then raise exception 'A player identity is required.'; end if;
  before_row := to_jsonb(a);
  if p_action in ('available','unavailable') then
    if today>a.effective_due_on then raise exception 'The play-by date has passed. Contact an admin about extra time.'; end if;
    note := coalesce(p_payload->>'note','');
    if length(note)>300 then raise exception 'Keep your note under 300 characters.'; end if;
    select coalesce(array_agg(distinct d::date order by d::date),'{}'::date[]) into days from jsonb_array_elements_text(coalesce(p_payload->'days','[]')) d;
    if cardinality(days)>15 or exists(select 1 from unnest(days) d where d is null or d<greatest(today,a.released_on) or d>a.effective_due_on) then raise exception 'Choose dates from the current play-by period.'; end if;
    if p_action='unavailable' then days:='{}'; end if;
    if p_actor=a.player_a_id then a.a_response:=p_action; a.a_days:=days; a.a_note:=note;
    else a.b_response:=p_action; a.b_days:=days; a.b_note:=note; end if;
    if a.a_response is not null and a.b_response is not null then a.revealed_at:=coalesce(a.revealed_at,now()); end if;
  elsif p_action='request' then
    if a.extension_used then raise exception 'Another week has already been granted. Contact an admin if you need more help.'; end if;
    if a.extension_status in ('pending','review') then return a; end if;
    if today>a.original_due_on+7 then raise exception 'The extra week has already passed. Contact an admin.'; end if;
    a.extension_status:=case when today>a.original_due_on or a.extension_status='declined' then 'review' else 'pending' end;
    a.extension_requested_by:=p_actor; a.extension_requested_at:=now(); a.extension_proposed_on:=a.original_due_on+7;
    a.extension_decided_by:=null; a.extension_decided_at:=null; a.request_version:=a.request_version+1;
  elsif p_action in ('agree','decline','help','approve','keep') then
    requested_version:=(p_payload->>'requestVersion')::integer;
    if requested_version is null or requested_version<>a.request_version then raise exception 'This request has changed. Open the latest message.'; end if;
    if a.extension_status not in ('pending','review') then raise exception 'This request has already been decided.'; end if;
    if p_action in ('agree','decline','help') and p_actor=a.extension_requested_by then raise exception 'Only your opponent can answer your request.'; end if;
    if p_action='agree' then
      if a.extension_status='review' or today>a.original_due_on then a.extension_status:='review';
      else a.extension_status:='approved'; a.effective_due_on:=a.extension_proposed_on; a.extension_used:=true; end if;
    elsif p_action='approve' then
      if today>a.extension_proposed_on then raise exception 'The proposed date has passed. Contact the players to arrange a manual decision.'; end if;
      a.extension_status:='approved'; a.effective_due_on:=a.extension_proposed_on; a.extension_used:=true;
    elsif p_action='keep' then a.extension_status:='declined';
    else a.extension_status:='review'; end if;
    a.extension_decided_by:=p_actor; a.extension_decided_at:=now();
  else raise exception 'Unknown availability action.'; end if;
  if to_jsonb(a)=before_row then return a; end if;
  a.version:=a.version+1; a.updated_at:=now();
  update public.league_availability set a_response=a.a_response,b_response=a.b_response,a_days=a.a_days,b_days=a.b_days,
    a_note=a.a_note,b_note=a.b_note,revealed_at=a.revealed_at,effective_due_on=a.effective_due_on,
    extension_status=a.extension_status,extension_requested_by=a.extension_requested_by,extension_requested_at=a.extension_requested_at,
    extension_proposed_on=a.extension_proposed_on,extension_decided_by=a.extension_decided_by,extension_decided_at=a.extension_decided_at,
    extension_used=a.extension_used,request_version=a.request_version,version=a.version,updated_at=a.updated_at where match_id=p_match;
  insert into public.league_availability_events(match_id,actor_id,action,detail) values(p_match,p_actor,p_action,
    jsonb_build_object('payload',p_payload,'old_due_on',before_row->>'effective_due_on','due_on',a.effective_due_on,'extension',a.extension_status,'version',a.version));
  return a;
end $$;

create or replace function public.league_availability_claim(p_match text,p_user text,p_token text,p_force boolean default false)
returns setof public.league_availability_messages language plpgsql security invoker set search_path = '' as $$
declare a public.league_availability;
begin
  select * into a from public.league_availability where match_id=p_match;
  if not found or p_user not in (a.player_a_id,a.player_b_id) then return; end if;
  insert into public.league_availability_messages(match_id,user_id) values(p_match,p_user) on conflict do nothing;
  return query update public.league_availability_messages d set claim_token=p_token,lease_until=now()+interval '90 seconds'
    where d.match_id=p_match and d.user_id=p_user and (d.lease_until is null or d.lease_until<now())
    and (p_force or (d.retry_at<=now() and (d.status<>'sent' or d.sent_version<a.version))) returning d.*;
end $$;

create or replace function public.league_availability_finish(p_match text,p_user text,p_token text,p_version bigint,p_channel text,p_message text,p_error text default null)
returns void language sql security invoker set search_path = '' as $$
  update public.league_availability_messages set channel_id=coalesce(p_channel,channel_id),message_id=coalesce(p_message,message_id),
    sent_version=case when p_error is null then p_version else sent_version end,
    status=case when p_error is null then 'sent' else 'failed' end,last_error=left(p_error,160),
    retry_at=case when p_error is null then now() else now()+interval '15 minutes' end,claim_token=null,lease_until=null
    where match_id=p_match and user_id=p_user and claim_token=p_token;
$$;

create or replace function public.league_availability_remind(p_match text,p_user text,p_token text,p_done boolean default false)
returns setof public.league_availability_messages language plpgsql security invoker set search_path = '' as $$
begin
  if p_done then
    return query update public.league_availability_messages d set reminder_sent_at=now(),reminder_token=null
      where d.match_id=p_match and d.user_id=p_user and d.reminder_token=p_token returning d.*;
  else
    return query update public.league_availability_messages d set reminder_token=p_token,reminder_retry_at=now()+interval '15 minutes'
      from public.league_availability a join public.league_availability_releases r using(guild_id,season_id,week)
      join public.matches m on m.id::text=a.match_id join public.seasons s on s.id=m.season_id
      where d.match_id=a.match_id and d.match_id=p_match and d.user_id=p_user and d.status='sent'
        and d.reminder_sent_at is null and d.reminder_retry_at<=now() and r.released_at<=now()-interval '48 hours'
        and s.status='active' and m.status='scheduled' and m.player_a_id::text=a.player_a_id and m.player_b_id::text=a.player_b_id
        and (now() at time zone 'Europe/London')::date<=a.effective_due_on
        and ((p_user=a.player_a_id and a.a_response is null) or (p_user=a.player_b_id and a.b_response is null)) returning d.*;
  end if;
end $$;

create or replace function public.league_availability_work()
returns table(match_id text) language sql security invoker set search_path = '' as $$
  select distinct a.match_id from public.league_availability a
    join public.matches m on m.id::text=a.match_id and m.player_a_id::text=a.player_a_id and m.player_b_id::text=a.player_b_id
    join public.seasons s on s.id=m.season_id
    join public.league_availability_releases r on r.guild_id=a.guild_id and r.season_id=a.season_id and r.week=a.week
    cross join lateral (values(a.player_a_id),(a.player_b_id)) recipient(id)
    left join public.league_availability_messages d on d.match_id=a.match_id and d.user_id=recipient.id
    where s.status='active' and m.status='scheduled' and
      (a.extension_status='review' and a.review_notice_version<a.request_version and (now() at time zone 'Europe/London')::date<=a.extension_proposed_on+1 or
       (d.reminder_sent_at is null and d.status='sent' and d.reminder_retry_at<=now() and r.released_at<=now()-interval '48 hours' and (now() at time zone 'Europe/London')::date<=a.effective_due_on and ((d.user_id=a.player_a_id and a.a_response is null) or (d.user_id=a.player_b_id and a.b_response is null))) or
       ((now() at time zone 'Europe/London')::date<=a.effective_due_on and (d.user_id is null or ((d.lease_until is null or d.lease_until<now()) and d.retry_at<=now() and (d.status<>'sent' or d.sent_version<a.version)))))
    order by a.match_id limit 50;
$$;

alter table public.league_availability_releases enable row level security;
alter table public.league_availability enable row level security;
alter table public.league_availability_messages enable row level security;
alter table public.league_availability_events enable row level security;
revoke all on public.league_availability_releases,public.league_availability,public.league_availability_messages,public.league_availability_events from public,anon,authenticated;
grant usage on schema public to service_role;
grant all on public.league_availability_releases,public.league_availability,public.league_availability_messages,public.league_availability_events to service_role;
grant usage,select on sequence public.league_availability_events_id_seq to service_role;
do $$ declare f record; begin
  for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname in ('league_availability_release','league_availability_act','league_availability_claim','league_availability_finish','league_availability_work','league_availability_remind') loop
    execute format('revoke all on function %s from public,anon,authenticated',f.signature);
    execute format('grant execute on function %s to service_role',f.signature);
  end loop;
end $$;
notify pgrst, 'reload schema';
commit;
