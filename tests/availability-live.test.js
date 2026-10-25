import { MatchRepository } from '../src/repositories/MatchRepository.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { AvailabilityService, triggerAvailability } from '../src/services/AvailabilityService.js';
import { liveAvailabilityMessage, liveAvailabilityForm, londonDate, addWeek } from '../src/discord/handlers/availabilityViews.js';
import { handleAvailability } from '../src/discord/handlers/availability.js';
import { execute as fallback } from '../src/discord/commands/availability.js';
import { execute as adminCommand } from '../src/discord/commands/availability-admin.js';
import { execute as publish } from '../src/discord/commands/fixturepublish.js';
import { execute as setWeek } from '../src/discord/commands/fixturesweek.js';
import { execute as startSeason } from '../src/discord/commands/season.js';
import { ModalSubmitFields, ModalSubmitInteraction } from 'discord.js';

function fixture({ failUser = null, enabled = true } = {}) {
    const today = londonDate();
    const state = { match_id: 'match1', guild_id: 'guild', season_id: 'season1', week: 1,
        player_a_id: 'a', player_b_id: 'b', released_on: today, original_due_on: addWeek(today), effective_due_on: addWeek(today),
        a_response: null, b_response: 'available', a_days: [], b_days: [today], a_note: '', b_note: 'SECRET BEFORE BOTH ANSWER',
        revealed_at: null, extension_status: 'none', extension_used: false, request_version: 0, review_notice_version: 0, version: 1 };
    const season = { id: 'season1', guild_id: 'guild', name: 'Season 9', status: 'active', fixtures_week: 1 };
    const match = { id: 'match1', season_id: 'season1', player_a_id: 'a', player_b_id: 'b', status: 'scheduled' };
    const sends = [], edits = [], actCalls = [], deliveries = new Map();
    const messages = new Map();
    const repo = {
        get: async () => structuredClone(state), release: async () => [structuredClone(state)],
        list: async () => [structuredClone(state)], messages: async () => [...deliveries.values()],
        work: async () => [{ match_id: 'match1' }], reminder: async () => null,
        reviewedNotice: async () => {},
        claim: async (_, user, token, force) => {
            const existing = deliveries.get(user);
            if (existing?.token || (!force && existing?.status === 'sent' && existing?.sent_version === state.version)) return null;
            const row = { ...existing, match_id: 'match1', user_id: user, token };
            deliveries.set(user, row); return row;
        },
        finish: async (_, user, token, version, message, error) => {
            const row = deliveries.get(user); assert.equal(row.token, token);
            Object.assign(row, { token: null, status: error ? 'failed' : 'sent', sent_version: error ? row.sent_version : version,
                message_id: message?.id ?? row.message_id, channel_id: message?.channelId ?? row.channel_id, last_error: error });
        },
        act: async (matchId, actor, action, payload, admin) => {
            actCalls.push({ matchId, actor, action, payload, admin });
            state.a_response = action === 'available' ? 'available' : 'unavailable'; state.a_days = payload.days ?? []; state.a_note = payload.note ?? '';
            state.revealed_at = 'now'; state.version++; return state;
        },
    };
    const client = { users: { fetch: async user => ({ send: async payload => {
        if (user === failUser) throw Object.assign(new Error('DM blocked'), { code: 50007 });
        const message = { id: 'dm-' + user, channelId: 'channel-' + user, edit: async payload => { edits.push({ user, payload }); return message; } };
        messages.set(message.id, message); sends.push({ user, payload }); return message;
    } }) }, channels: { fetch: async () => ({ messages: { fetch: async id => {
        if (!messages.has(id)) throw Object.assign(new Error('Missing'), { code: 10008 });
        return messages.get(id);
    } } }) } };
    const service = new AvailabilityService({ availability: repo,
        seasons: { getCurrentForGuild: async () => season, getById: async () => season },
        matches: { getById: async () => match }, players: { listByDiscordIds: async () => [{ discord_user_id: 'a', display_name: 'Player A' }, { discord_user_id: 'b', display_name: 'Player B' }] }, enabled });
    client.services = { availability: service };
    return { state, season, match, repo, client, service, sends, edits, deliveries, messages, actCalls };
}

test('live cards hide the opponent’s days and note until both have answered', async () => {
    const f = fixture(); const context = await f.service.context('match1', 'a');
    let json = JSON.stringify(liveAvailabilityMessage(context, 'a'));
    assert(!json.includes('SECRET BEFORE BOTH ANSWER')); assert.match(json, /Hidden until you both answer/);
    context.state.a_response = 'available'; context.state.revealed_at = 'now';
    json = JSON.stringify(liveAvailabilityMessage(context, 'a'));
    assert.match(json, /SECRET BEFORE BOTH ANSWER/); assert.match(json, /Contact your opponent/);
    assert(!json.includes('Practice')); assert(!/holiday|admin example/i.test(json));
    context.state.b_response = 'unavailable';
    assert(!JSON.stringify(liveAvailabilityMessage(context, 'a')).includes('SECRET BEFORE BOTH ANSWER'), 'absence reasons stay with the player/admin');
});
test('live forms support an extended period with checkbox groups of at most ten dates', async () => {
    const f = fixture(); f.state.effective_due_on = addWeek(f.state.original_due_on);
    const context = await f.service.context('match1', 'a'); const form = liveAvailabilityForm(context, 'a', true);
    const groups = form.components.filter(component => component.component.type === 22);
    assert.equal(groups.length, 2);
    assert(groups.every(group => group.component.options.length <= 10 && group.component.required === false));
    assert.equal(groups.flatMap(group => group.component.options).length, 15);
    assert.equal(form.components.at(-1).component.required, false);
});
test('releasing and retrying the same week edits stored DMs without duplicate sends', async () => {
    const f = fixture();
    await f.service.releaseWeek({ client: f.client, guildId: 'guild', week: 1 });
    assert.equal(f.sends.length, 2); assert(f.sends.every(send => send.payload.enforceNonce));
    await f.service.releaseWeek({ client: f.client, guildId: 'guild', week: 1 }); assert.equal(f.sends.length, 2);
    await f.service.act({ client: f.client, matchId: 'match1', userId: 'a', action: 'available', payload: { days: [], note: '' } });
    assert.equal(f.edits.length, 2); assert.equal(f.sends.length, 2);
});
test('concurrent sync calls in one process share delivery state', async () => {
    const f = fixture(); await Promise.all([f.service.syncMatch(f.client, 'match1'), f.service.syncMatch(f.client, 'match1')]);
    assert.equal(f.sends.length, 2);
});
test('closed DMs are recorded and can be recovered with the retry command', async () => {
    const f = fixture({ failUser: 'b' }); const result = await f.service.releaseWeek({ client: f.client, guildId: 'guild', week: 1 });
    assert.equal(result.failures, 1); assert.equal(f.deliveries.get('b').last_error, '50007');
    assert.match(result.message, /availability-admin/);
});
test('deleted stored messages are replaced with a deduplicated new DM', async () => {
    const f = fixture(); await f.service.syncMatch(f.client, 'match1'); f.messages.delete('dm-a');
    await f.service.syncMatch(f.client, 'match1', true);
    assert.equal(f.sends.filter(send => send.user === 'a').length, 2);
    assert.notEqual(f.sends[0].payload.nonce, f.sends.at(-1).payload.nonce);
});
test('outsiders, substituted players and cross-server admin requests cannot act', async () => {
    const f = fixture(); await assert.rejects(f.service.context('match1', 'outsider'), /not your match/);
    await assert.rejects(f.service.context('match1', 'admin', true, 'other-guild'), /another server/);
    f.match.player_a_id = 'replacement'; await assert.rejects(f.service.context('match1', 'a'), /fixture has changed/);
    assert.equal(f.actCalls.length, 0);
});
test('feature flag and inactive seasons prevent releases', async () => {
    const disabled = fixture({ enabled: false }); assert((await disabled.service.releaseWeek({})).skipped);
    await assert.rejects(disabled.service.context('match1', 'a'), /not enabled/);
    const f = fixture(); f.season.status = 'signups_closed';
    assert((await f.service.releaseWeek({ client: f.client, guildId: 'guild', week: 1 })).skipped); assert.equal(f.sends.length, 0);
});
test('both explicit fixture commands trigger availability after successful publication', async () => {
    for (const command of [publish, setWeek]) {
        const calls = [], replies = [];
        const client = { services: { config: { adminUserId: 'admin' }, fixturesPublisher: {
            publish: async () => { calls.push('fixtures'); return { season: { name: 'Season 9' }, week: 1 }; },
            setWeek: async () => { calls.push('fixtures'); },
        }, availability: { enabled: true, releaseWeek: async input => { calls.push('availability'); assert.equal(input.week, 1); return { message: 'Availability sent.' }; } } } };
        await command({ client, guildId: 'guild', channelId: 'channel', user: { id: 'admin' }, options: { getInteger: () => 1 }, deferReply: async () => {}, editReply: async text => replies.push(text) });
        assert.deepEqual(calls, ['fixtures', 'availability']); assert.match(replies[0], /Availability sent/);
    }
});
test('starting after fixtures were prepublished releases that week; otherwise waits for publication', async () => {
    for (const prepublished of [false, true]) {
        let releases = 0;
        const client = { services: { seasons: { startSeason: async () => ({ name: 'Season 9', fixtures_week: 1, fixtures_channel_id: prepublished ? 'channel' : null, fixtures_message_id: prepublished ? 'msg' : null }) },
            availability: { enabled: true, releaseWeek: async () => { releases++; return { message: 'Sent' }; } } } };
        await startSeason({ client, guildId: 'guild', options: { getSubcommand: () => 'start' }, deferReply: async () => {}, editReply: async () => {} });
        assert.equal(releases, prepublished ? 1 : 0);
    }
});
test('fixture success is preserved if availability migration or delivery fails', async () => {
    const result = await triggerAvailability({ services: { availability: { enabled: true, releaseWeek: async () => { throw new Error('Migration missing'); } } } }, 'guild', 1);
    assert.match(result, /Fixtures were updated/); assert.match(result, /Migration missing/);
});
test('server fallback returns a private real match card without opening DMs', async () => {
    const f = fixture(); const replies = [];
    f.client.repos = { seasons: f.service.seasons };
    await fallback({ client: f.client, guildId: 'guild', user: { id: 'a' }, options: { getInteger: () => null },
        deferReply: async options => assert.equal(options.flags, 64), editReply: async payload => replies.push(payload) });
    assert.equal(replies.length, 1); assert(replies[0].components); assert.equal(f.sends.length, 0);
});
test('admin-only status rejects a normal player before reading hidden replies', async () => {
    let calls = 0;
    await adminCommand({ guildId: 'guild', client: { services: { config: {}, availability: { requireEnabled: () => { calls++; } } } }, user: { id: 'a' },
        memberPermissions: { has: () => false }, reply: async payload => assert.equal(payload.flags, 64) });
    assert.equal(calls, 0);
});
test('live modal submission uses authenticated actor and actual checkbox values', async () => {
    const f = fixture(); const edits = [];
    const fields = new ModalSubmitFields([
        { type: 18, component: { type: 22, custom_id: 'days-0', values: [londonDate()] } },
        { type: 18, component: { type: 4, custom_id: 'note', value: 'After 7' } },
    ].map(component => ModalSubmitInteraction.transformComponent(component)));
    const interaction = { client: f.client, user: { id: 'a' }, customId: 'league-avail:match1:submit-yes:0', fields,
        isButton: () => false, isModalSubmit: () => true, deferUpdate: async () => { interaction.deferred = true; }, editReply: async payload => edits.push(payload), followUp: async payload => { throw new Error(payload.content); } };
    assert(await handleAvailability(interaction)); assert.equal(f.actCalls[0].actor, 'a'); assert.equal(f.actCalls[0].action, 'available');
    assert.deepEqual(f.actCalls[0].payload.days, [londonDate()]); assert.equal(edits.length, 1);
});

test('approved extra time excludes only matching current participants from overdue results', async () => {
    const rows=[
        {id:'extended',player_a_id:'a',player_b_id:'b'},
        {id:'changed',player_a_id:'a',player_b_id:'replacement'},
        {id:'ordinary',player_a_id:'c',player_b_id:'d'},
    ];
    const query={select(){return this},eq(){return this},lt(){return this},neq(){return this},order(){return this},then(resolve){return Promise.resolve(resolve({data:rows,error:null}))}};
    const repo=new MatchRepository({supabase:{schema:()=>({from:()=>query})},schema:'public'});
    let reads=0;
    repo.availability={activeExtensions:async()=>{reads++;return[
        {match_id:'extended',player_a_id:'a',player_b_id:'b'},
        {match_id:'changed',player_a_id:'a',player_b_id:'b'},
    ]}};
    const original=await repo.listUnreportedBeforeWeek({seasonId:'s',week:2});assert.equal(original.length,3);assert.equal(reads,0);
    repo.availabilityEnabled=true;
    const filtered=await repo.listUnreportedBeforeWeek({seasonId:'s',week:2});assert.deepEqual(filtered.map(row=>row.id),['changed','ordinary']);assert.equal(reads,1);
});
test('a saved extension refreshes fixtures without invoking fixture release again', async () => {
    const f=fixture();let refreshes=0;f.client.services.fixturesPublisher={refresh:async()=>{refreshes++}};
    f.repo.act=async()=>{f.state.effective_due_on=addWeek(f.state.original_due_on);f.state.extension_status='approved';f.state.version++;return f.state};
    await f.service.act({client:f.client,matchId:'match1',userId:'a',action:'agree',payload:{requestVersion:1}});
    assert.equal(refreshes,1);assert.equal(f.sends.length,2);
});
test('one claimed reminder sends a simple prompt and records completion', async () => {
    const f=fixture();let claimed=false,done=0;
    f.repo.reminder=async(_,user,token,finished)=>{
        if(finished){done++;return{}};
        if(user!=='a'||claimed)return null;
        claimed=true;return{message_id:'previous'};
    };
    await f.service.remindPlayers(f.client,f.state);await f.service.remindPlayers(f.client,f.state);
    assert.equal(f.sends.length,1);assert.equal(done,1);assert.match(f.sends[0].payload.content,/Reminder/);assert(f.sends[0].payload.enforceNonce);
});

test('failed-only sync leaves successful recipients untouched, even if their card version is older', async () => {
    const f=fixture(); f.state.version=2;
    f.deliveries.set('a',{match_id:'match1',user_id:'a',status:'sent',sent_version:1,message_id:'dm-a',channel_id:'channel-a'});
    f.deliveries.set('b',{match_id:'match1',user_id:'b',status:'failed',sent_version:0,last_error:'50278'});
    const expedited=[];
    f.repo.expedite=async(match,user)=>expedited.push(user);
    f.repo.reminder=async()=>{throw Error('A failed-only retry must not generate reminders')};
    const result=await f.service.syncMatch(f.client,'match1',false,{recipients:['a','b'],failedOnly:true});
    assert.equal(result.attempted,1);assert.equal(result.failures,0);assert.deepEqual(expedited,['b']);
    assert.deepEqual(f.sends.map(send=>send.user),['b']);assert.equal(f.edits.length,0);
    assert.equal(f.deliveries.get('a').sent_version,1);
});

test('failed-only retry does not touch a recipient recovered by another worker after the status read', async () => {
    const f=fixture();f.state.version=2;
    f.repo.messages=async()=>[{match_id:'match1',user_id:'b',status:'failed'}];
    f.repo.expedite=async()=>{};
    f.repo.claim=async(_,user,token)=>{
        const row={match_id:'match1',user_id:user,status:'sent',sent_version:1,message_id:'recovered',channel_id:'channel',token};
        f.deliveries.set(user,row);return row;
    };
    const result=await f.service.syncMatch(f.client,'match1',false,{recipients:['b'],failedOnly:true});
    assert.equal(result.attempted,0);assert.equal(f.sends.length,0);assert.equal(f.edits.length,0);
    assert.equal(f.deliveries.get('b').sent_version,1);
});
