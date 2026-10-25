import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
const db=new PGlite();
await db.exec('create role anon; create role authenticated; create role service_role bypassrls;');

for(const [schema,idType,id] of [['public','uuid','11111111-1111-1111-1111-111111111111'],['dev','bigint','123']]){
await test(schema+' migration and real PostgreSQL workflow',async t=>{
 await db.exec(`create schema if not exists ${schema}; grant usage on schema ${schema} to service_role;
 create table ${schema}.seasons(id bigint primary key,guild_id text,status text);
 create table ${schema}.matches(id ${idType} primary key,season_id bigint references ${schema}.seasons,week integer,player_a_id text,player_b_id text,status text);
 insert into ${schema}.seasons values(1,'guild','active');insert into ${schema}.matches values('${id}',1,1,'a','b','scheduled');
 grant select,update on ${schema}.seasons,${schema}.matches to service_role;`);
 const sql=fs.readFileSync(new URL('../scripts/migrations/002_league_availability_'+schema+'.sql',import.meta.url),'utf8');
 await db.exec(sql);await db.exec(sql);
 const q=(sql,params=[])=>db.query(sql,params);
 const release=()=>q(`select to_jsonb(a) data from ${schema}.league_availability_release('guild','1',1) a`);
 const state=async()=> (await q(`select to_jsonb(a) data from ${schema}.league_availability a where match_id=$1`,[id])).rows[0].data;
 const act=async(actor,action,payload={},admin=false)=>(await q(`select to_jsonb(${schema}.league_availability_act($1,$2,$3,$4::jsonb,$5)) data`,[id,actor,action,JSON.stringify(payload),admin])).rows[0].data;
 await db.exec('set role service_role');
 await t.test('release is repeatable and freezes dates',async()=>{
  const first=(await release()).rows[0].data;const second=(await release()).rows[0].data;
  assert.equal(first.original_due_on,second.original_due_on);assert.equal(first.version,second.version);
  const due=new Date(first.original_due_on+'T00:00:00Z');assert.equal(due.getUTCDay(),0);
  assert.equal((await q(`select count(*)::int n from ${schema}.league_availability_events`)).rows[0].n,1);
 });
 await t.test('first reply stays hidden; second reveals atomically and edits never hide it again',async()=>{
  const initial=await state();const today=(await q("select (now() at time zone 'Europe/London')::date::text d")).rows[0].d;
  await assert.rejects(act('outsider','available'),/not your match/);
  const first=await act('a','available',{days:[today,today],note:'After 7'});assert.equal(first.revealed_at,null);assert.deepEqual(first.a_days,[today]);
  const duplicate=await act('a','available',{days:[today],note:'After 7'});assert.equal(duplicate.version,first.version);
  await assert.rejects(act('a','available',{days:['1999-01-01']}),/Choose dates/);
  await assert.rejects(act('a','available',{note:'x'.repeat(301)}),/300 characters/);
  const both=await act('b','unavailable',{note:'Working'});assert(both.revealed_at);
  assert.equal((await act('a','unavailable')).revealed_at,both.revealed_at);
 });
 await t.test('leases prevent duplicate delivery and stale completion cannot overwrite a claim',async()=>{
  const claim=async token=>(await q(`select * from ${schema}.league_availability_claim($1,'a',$2,false)`,[id,token])).rows;
  assert.equal((await claim('one')).length,1);assert.equal((await claim('two')).length,0);
  await q(`select ${schema}.league_availability_finish($1,'a','wrong',1,'channel','wrong',null)`,[id]);
  assert.equal((await q(`select message_id from ${schema}.league_availability_messages where match_id=$1 and user_id='a'`,[id])).rows[0].message_id,null);
  const current=await state();await q(`select ${schema}.league_availability_finish($1,'a','one',$2,'channel','msg',null)`,[id,current.version]);assert.equal((await claim('three')).length,0);
 });
 await t.test('only the opponent may agree, and an extra week is granted once',async()=>{
  const request=await act('a','request');assert.equal(request.extension_status,'pending');
  assert.equal((await act('b','request')).extension_requested_by,'a');
  await assert.rejects(act('a','agree',{requestVersion:request.request_version}),/Only your opponent/);
  await assert.rejects(act('b','agree',{requestVersion:request.request_version-1}),/changed/);
  const approved=await act('b','agree',{requestVersion:request.request_version});assert.equal(approved.extension_status,'approved');assert(approved.extension_used);
  assert.equal((new Date(approved.effective_due_on)-new Date(approved.original_due_on))/86400000,7);
  await assert.rejects(act('a','request'),/already been granted/);
 });
 await db.exec('reset role');
 await db.exec(`update ${schema}.matches set player_b_id='c' where id='${id}'`);
 await db.exec('set role service_role');
 await t.test('substitutions invalidate old replies and re-release keeps the original deadline',async()=>{
  const old=await state();await assert.rejects(act('b','available'),/fixture has changed/);
  await release();const fresh=await state();assert.equal(fresh.player_b_id,'c');assert.equal(fresh.a_response,null);assert.equal(fresh.b_response,null);
  assert.equal(fresh.revealed_at,null);assert.equal(fresh.original_due_on,old.original_due_on);assert(fresh.request_version>old.request_version);
  await assert.rejects(act('b','available'),/not your match/);
 });
 await db.exec('reset role');
 await db.exec(`update ${schema}.league_availability set released_on=(now() at time zone 'Europe/London')::date-10,original_due_on=(now() at time zone 'Europe/London')::date-1,effective_due_on=(now() at time zone 'Europe/London')::date-1 where match_id='${id}'`);
 await db.exec('set role service_role');
 await t.test('late requests require admin review and cannot be self-approved',async()=>{
  const late=await act('a','request');assert.equal(late.extension_status,'review');
  const reply=await act('c','agree',{requestVersion:late.request_version});assert.equal(reply.extension_status,'review');assert.equal(reply.effective_due_on,reply.original_due_on);
  await assert.rejects(act('admin','approve',{requestVersion:late.request_version}),/Only an admin/);
  await assert.rejects(act('admin','approve',{requestVersion:late.request_version},null),/Only an admin/);
  const approved=await act('admin','approve',{requestVersion:late.request_version},true);assert.equal(approved.extension_status,'approved');
 });
 await t.test('unanswered players get one leased reminder after 48 hours; answered players do not',async()=>{
  const current=await state();
  for(const user of ['a','c']){
   const token='delivery-'+user;
   await q(`select * from ${schema}.league_availability_claim($1,$2,$3,true)`,[id,user,token]);
   await q(`select ${schema}.league_availability_finish($1,$2,$3,$4,'dm','message',null)`,[id,user,token,current.version]);
  }
  await q(`update ${schema}.league_availability_releases set released_at=now()-interval '49 hours'`);
  const work=await q(`select * from ${schema}.league_availability_work()`);assert(work.rows.some(row=>row.match_id===id));
  const remind=(user,token,done=false)=>q(`select * from ${schema}.league_availability_remind($1,$2,$3,$4)`,[id,user,token,done]);
  assert.equal((await remind('a','r1')).rows.length,1);
  assert.equal((await remind('a','r2')).rows.length,0);
  assert.equal((await remind('a','wrong',true)).rows.length,0);
  assert.equal((await remind('a','r1',true)).rows.length,1);
  assert.equal((await remind('a','r3')).rows.length,0);
  await act('c','available');assert.equal((await remind('c','r4')).rows.length,0);
 });
 await db.exec('reset role');
 await t.test('anonymous and authenticated clients cannot read replies or call functions',async()=>{
  for(const role of ['anon','authenticated']){
   const perms=(await q(`select has_table_privilege($1,'${schema}.league_availability','select') can_read,has_function_privilege($1,'${schema}.league_availability_act(text,text,text,jsonb,boolean)','execute') can_act`,[role])).rows[0];
   assert.equal(perms.can_read,false);assert.equal(perms.can_act,false);
  }
 });
 await db.exec(`update ${schema}.seasons set status='closed'`);
 await db.exec('set role service_role');
 await t.test('closed seasons reject replies and releases',async()=>{
  await assert.rejects(act('a','available'),/closed/);await assert.rejects(release(),/Start the season/);
 });
 await db.exec('reset role');
});
}
await db.close();
