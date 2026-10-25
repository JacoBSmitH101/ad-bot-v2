import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { buildAvailabilityAdminModel, renderAvailabilityAdminImages, deliveryReason, availabilityOutcome } from '../src/services/AvailabilityAdminImageRenderer.js';
import { execute, data } from '../src/discord/commands/availability-admin.js';

function fixture(total = 2) {
    const season = { id: 'season', name: 'Season 9', fixtures_week: 1 };
    const states = Array.from({ length: total }, (_, i) => ({ match_id: 'match-' + i, season_id: 'season', guild_id: 'guild', week: 1,
        player_a_id: 'a-' + i, player_b_id: 'b-' + i, a_response: i ? null : 'available', b_response: 'unavailable',
        a_days: i ? [] : ['2026-10-26', '2026-10-28'], b_days: [], a_note: 'PRIVATE NOTE', b_note: 'Working',
        effective_due_on: '2026-11-01', extension_status: i ? 'review' : 'none' }));
    const players = states.flatMap((state, i) => [{ discord_user_id: state.player_a_id, display_name: i ? 'Player A ' + i : '<Alice & Bob> 🎯' },
        { discord_user_id: state.player_b_id, display_name: 'Player B ' + i }]);
    const matches = states.map(state => ({ id: state.match_id, division_id: 'division', player_a_id: state.player_a_id, player_b_id: state.player_b_id, status: 'scheduled' }));
    const divisions = [{ id: 'division', name: 'Div 1', sort_order: 1 }];
    const messages = states.flatMap((state, i) => [{ match_id: state.match_id, user_id: state.player_a_id, status: i ? 'failed' : 'sent', last_error: i ? '50278' : null },
        { match_id: state.match_id, user_id: state.player_b_id, status: 'sent' }]);
    return { season, week: 1, states, players, matches, divisions, messages };
}

test('admin model shows unpaired replies/days, removes emoji and keeps private notes in text only', () => {
    const input = fixture(); const model = buildAvailabilityAdminModel(input);
    assert.equal(model.groups.length, 1);
    assert.equal(model.groups[0].fixtures[0].sides[0].name, '<Alice & Bob>');
    assert.deepEqual(model.groups[0].fixtures[0].sides[0].days, ['2026-10-26', '2026-10-28']);
    assert.equal(model.groups[0].fixtures[1].sides[0].delivery.last_error, '50278');
    assert(!JSON.stringify(model).includes('PRIVATE NOTE'));
});
test('changed pairings never display old participants’ responses as the replacement’s answers', () => {
    const input = fixture(); input.matches[0].player_a_id = 'replacement';
    const fixtureModel = buildAvailabilityAdminModel(input).groups[0].fixtures[0];
    assert(fixtureModel.changed); assert.equal(fixtureModel.sides[0].id, 'replacement');
    assert.equal(fixtureModel.sides[0].status, 'changed'); assert.deepEqual(fixtureModel.sides[0].days, []);
});
test('graphics paginate complete rosters and handle many selected dates safely', async () => {
    const input = fixture(7);
    input.states[0].a_days = Array.from({ length: 15 }, (_, i) => '2026-11-' + String(i + 1).padStart(2, '0'));
    const images = await renderAvailabilityAdminImages(buildAvailabilityAdminModel(input));
    assert.equal(images.length, 2);
    for (const image of images) {
        const metadata = await sharp(image.png).metadata(); assert.equal(metadata.width, 1280); assert(metadata.height > 400);
        assert(image.png.length < 8_000_000);
    }
});

function interaction({ view = null, action = 'status', allowed = true, total = 2 } = {}) {
    const input = fixture(total), calls = { edits: [], followUps: [], sync: [], reads: 0 };
    const service = {
        requireEnabled: () => {}, players: { listByDiscordIds: async () => input.players },
        availability: { list: async () => { calls.reads++; return input.states; }, messages: async () => input.messages, fixtureMetadata: async () => input.matches },
        syncMatch: async (client, id, force, options) => { calls.sync.push({ id, force, options }); return { attempted: 1, failures: 1 }; },
    };
    const value = { guildId: 'guild', user: { id: 'admin' }, memberPermissions: { has: () => allowed },
        client: { services: { availability: service, config: {} }, repos: { seasons: { getCurrentForGuild: async () => input.season }, divisions: { listBySeason: async () => input.divisions } } },
        options: { getString: key => ({ action, view, match: null })[key], getInteger: () => null },
        reply: async message => { calls.reply = message; }, deferReply: async message => { calls.defer = message; },
        editReply: async message => calls.edits.push(message), followUp: async message => calls.followUps.push(message) };
    return { value, calls, input };
}
test('weekly status defaults to private PNGs with failed users first and full notes attached', async () => {
    const f = interaction(); await execute(f.value);
    assert.equal(f.calls.defer.flags, 64);
    assert.equal(f.calls.edits[0].files.length, 2);
    assert.match(f.calls.edits[0].content, /Failed DMs \(1\)/);
    assert.match(f.calls.edits[0].content, /<@a-1>/);
    assert.match(f.calls.edits[0].content, /No shared server/);
    assert.equal(f.calls.edits[0].files.at(-1).name, 'availability-details.txt');
    assert.match(f.calls.edits[0].files.at(-1).attachment.toString(), /PRIVATE NOTE/);
    assert.deepEqual(f.calls.edits[0].allowedMentions, { parse: [] });
});
test('text view remains available and every continuation is private', async () => {
    const f = interaction({ view: 'text', total: 18 }); await execute(f.value);
    assert(!f.calls.edits[0].files);
    assert(f.calls.followUps.length); assert(f.calls.followUps.every(message => message.flags === 64));
    assert([f.calls.edits[0], ...f.calls.followUps].every(message => message.content.length <= 2000));
});
test('failed-only retry selects recipients rather than updating successful matches', async () => {
    const f = interaction({ action: 'retry' }); await execute(f.value);
    assert.equal(f.calls.sync.length, 1);
    assert.deepEqual(f.calls.sync[0], { id: 'match-1', force: false, options: { recipients: ['a-1'], failedOnly: true } });
    assert.match(f.calls.edits[0].content, /Successful DMs were left alone/);
    assert.match(f.calls.edits[0].content, /<@a-1>/);
});
test('refresh explicitly updates all cards, while ordinary players cannot access the graphic', async () => {
    const refresh = interaction({ action: 'refresh' }); await execute(refresh.value);
    assert.equal(refresh.calls.sync.length, 2); assert(refresh.calls.sync.every(call => call.force));
    const denied = interaction({ allowed: false }); await execute(denied.value);
    assert.equal(denied.calls.reads, 0); assert.equal(denied.calls.reply.flags, 64);
    assert(data.toJSON().options.find(option => option.name === 'action').choices.some(choice => choice.value === 'refresh'));
});
test('many delivery failures fit Discord’s message limit without hiding the report', async () => {
    const f = interaction({ action: 'retry', total: 35 }); await execute(f.value);
    assert(f.calls.edits[0].content.length <= 2000);
    assert.match(f.calls.edits[0].content, /more/);
});
test('delivery codes get neutral, readable descriptions', () => {
    assert.equal(deliveryReason('50278'), 'No shared server'); assert.equal(deliveryReason('50007'), 'DM could not be sent');
    assert.equal(deliveryReason('something'), 'Delivery error');
});

test('confirmed scores preserve player order and zero legs for object and array results', () => {
    for(const result of [{legs_a:4,legs_b:0},[{legs_a:'4',legs_b:'0'}]]){
        const outcome=availabilityOutcome({status:'confirmed',match_results:result});
        assert(outcome.closed);assert(outcome.confirmed);assert.deepEqual(outcome.score,[4,0]);assert.match(outcome.label,/COMPLETE/);
    }
    const missing=availabilityOutcome({status:'confirmed',match_results:null});
    assert(missing.closed);assert.equal(missing.score,null,'missing scores must not become a fictional 0–0');
});
test('pending, disputed and void results cannot appear as confirmed wins', () => {
    for(const status of ['reported','disputed']){
        const outcome=availabilityOutcome({status,match_results:{legs_a:2,legs_b:4}});
        assert(outcome.closed);assert.equal(outcome.confirmed,false);assert.deepEqual(outcome.score,[2,4]);
    }
    assert.match(availabilityOutcome({status:'reported'}).label,/PENDING/);
    assert.match(availabilityOutcome({status:'disputed'}).label,/DISPUTED/);
    const voided=availabilityOutcome({status:'void',match_results:{legs_a:0,legs_b:0}});
    assert(voided.closed);assert.equal(voided.score,null);assert.match(voided.label,/VOID/);
    assert.equal(availabilityOutcome({status:'scheduled',match_results:{legs_a:null,legs_b:null}}).closed,false);
});
test('played matches render their results even when neither player answered availability', async () => {
    const input=fixture(4);
    const statuses=['confirmed','reported','disputed','void'];
    input.matches.forEach((match,i)=>{match.status=statuses[i];match.match_results=i<3?{legs_a:4,legs_b:i}:null});
    input.states.forEach(state=>{state.a_response=null;state.b_response=null});
    const model=buildAvailabilityAdminModel(input);
    assert(model.groups[0].fixtures.every(fixture=>fixture.outcome.closed));
    assert.equal(model.groups[0].fixtures[0].outcome.confirmed,true);
    const images=await renderAvailabilityAdminImages(model);assert.equal(images.length,1);
    assert.equal((await sharp(images[0].png).metadata()).width,1280);
});
