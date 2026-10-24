import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { buildDivisionProposal, divisionTargetSizes } from '../src/utils/buildDivisionProposal.js';
import { renderDivisionProposalImages } from '../src/services/DivisionProposalImageRenderer.js';
import { DivisionService } from '../src/services/DivisionService.js';
import { execute, data } from '../src/discord/commands/divisions.js';

function fixture() {
    const previousDivisions = [1, 2, 3].map(n => ({ id: n, name: `Div ${n}`, sort_order: n }));
    const signups = [], placementsByUser = new Map();
    previousDivisions.forEach((division, index) => {
        for (let i = 0; i < 10; i++) {
            const id = `${index + 1}-${i + 1}`;
            signups.push({ discord_user_id: id, avg_3dart: [77, 59, 43][index] - i * 2, name: `Player ${id}` });
            placementsByUser.set(id, [{ divisionName: division.name, divisionSortOrder: division.sort_order, rank: i + 1, of: 10 }]);
        }
    });
    const previousSignupIds = new Set(signups.map(p => p.discord_user_id));
    [85, 72, 64, 56, 50, 46, 40, 34, 30, 26, 22, 18].forEach((average, i) => signups.push({ discord_user_id: `new-${i + 1}`, avg_3dart: average, name: `New player ${i + 1}` }));
    return { signups, count: 4, previousDivisions, placementsByUser, previousSignupIds };
}
function find(plan, id) { return plan.groups.flat().find(p => p.discord_user_id === id); }
function model(input = fixture()) {
    const plan = buildDivisionProposal(input);
    return { ...plan, season: { name: 'Season 9', id: 'current', status: 'signups_open' }, playerCount: input.signups.length,
        divisions: plan.groups.map((_, i) => ({ name: `Div ${i + 1}`, sort_order: i + 1 })) };
}

test('sizes balance generally with extras in the lowest divisions', () => {
    for (let count = 1; count <= 10; count++) for (let total = 0; total <= 150; total++) {
        const sizes = divisionTargetSizes(total, count);
        assert.equal(sizes.reduce((a, b) => a + b, 0), total);
        assert(Math.max(...sizes) - Math.min(...sizes) <= 1);
        assert.deepEqual(sizes, [...sizes].sort((a, b) => a - b));
    }
    assert.deepEqual(divisionTargetSizes(42, 4), [10, 10, 11, 11]);
    assert.deepEqual(divisionTargetSizes(43, 4), [10, 11, 11, 11]);
    assert.deepEqual(divisionTargetSizes(45, 4), [11, 11, 11, 12]);
});
test('expansion honours promotions and established relegations without retroactive bottom-division relegation', () => {
    const input = fixture();
    const before = JSON.stringify(input.signups);
    input.signups.find(p => p.discord_user_id === '2-1').avg_3dart = 12;
    const expected = JSON.stringify(input.signups);
    const plan = buildDivisionProposal(input);
    assert.deepEqual(plan.counts, [10, 10, 11, 11]);
    for (const [id, division] of [['2-1', 0], ['2-2', 0], ['3-1', 1], ['3-2', 1], ['1-9', 1], ['1-10', 1], ['2-9', 2], ['2-10', 2]]) {
        assert.equal(find(plan, id).proposal.divisionIndex, division);
        assert(find(plan, id).proposal.locked);
    }
    assert.equal(find(plan, '3-10').proposal.reason, 'returning');
    assert.equal(plan.stats.promotions, 4);
    assert.equal(plan.groups.flat().length, 42);
    assert.equal(new Set(plan.groups.flat().map(p => p.discord_user_id)).size, 42);
    assert.equal(JSON.stringify(input.signups), expected);
    assert.notEqual(before, expected);
});
test('strong newcomers get appropriate places and input order does not change the proposal', () => {
    const input = fixture();
    const first = buildDivisionProposal(input);
    assert.equal(find(first, 'new-1').proposal.divisionIndex, 0);
    assert.equal(find(first, 'new-12').proposal.divisionIndex, 3);
    const reversed = buildDivisionProposal({ ...input, signups: [...input.signups].reverse(), previousDivisions: [...input.previousDivisions].reverse() });
    assert.deepEqual(first.groups.map(g => g.map(p => p.discord_user_id)), reversed.groups.map(g => g.map(p => p.discord_user_id)));
});
test('similar averages keep established groups and no-history proposals use average bands', () => {
    const input = fixture(); input.signups = input.signups.filter(p => !p.discord_user_id.startsWith('new-'));
    input.count = 3; input.signups.forEach(p => { p.avg_3dart = 50; });
    const plan = buildDivisionProposal(input);
    assert.equal(plan.stats.moved, 0); assert.equal(plan.stats.kept, 22);
    const fresh = buildDivisionProposal({ signups: fixture().signups, count: 4 });
    assert.deepEqual(fresh.counts, [10, 10, 11, 11]);
    for (let i = 0; i < 3; i++) assert(Math.min(...fresh.groups[i].map(p => p.avg_3dart)) >= Math.max(...fresh.groups[i + 1].map(p => p.avg_3dart)));
});
test('protected-capacity conflicts are visible and never undo earned places', () => {
    const input = fixture(); input.count = 4;
    input.signups = input.signups.filter(p => ['2-1', '2-2', '3-1', '3-2'].includes(p.discord_user_id));
    const plan = buildDivisionProposal(input);
    assert(plan.conflicts.length);
    assert.equal(find(plan, '2-1').proposal.divisionIndex, 0);
    assert.equal(find(plan, '2-2').proposal.divisionIndex, 0);
    assert.equal(plan.groups.flat().length, 4);
});
test('rejects invalid counts, duplicate players and invalid averages', () => {
    const input = fixture();
    for (const count of [0, -1, 11, 1.5]) assert.throws(() => buildDivisionProposal({ ...input, count }));
    assert.throws(() => buildDivisionProposal({ ...input, signups: [input.signups[0], input.signups[0]] }));
    assert.throws(() => buildDivisionProposal({ signups: [{ discord_user_id: 'x', avg_3dart: null }], count: 1 }));
});

function serviceFixture() {
    const input = fixture(); const writes = [];
    const previous = { id: 'previous', status: 'closed' };
    const current = { id: 'current', name: 'Season 9', status: 'signups_open', created_at: '2026-10-01' };
    const service = new DivisionService({
        seasons: { getCurrentForGuild: async () => current, getPreviousForGuild: async () => previous },
        signups: { listBySeason: async id => id === 'current' ? input.signups : input.signups.filter(p => input.previousSignupIds.has(p.discord_user_id)) },
        divisions: { listBySeason: async id => id === 'previous' ? input.previousDivisions : [],
            clearPlayersForSeason: async () => writes.push('clear'), addPlayersBulk: async rows => writes.push(rows) },
        divisionPlayers: {}, matches: {},
    });
    service._getFinalTable = async ({ division }) => input.signups.filter(p => p.discord_user_id.startsWith(division.id + '-')).map(p => ({ discordUserId: p.discord_user_id, hasConfirmedResults: true }));
    return { input, service, writes, current };
}
test('preview reads signups while open without writes and explicit assignment uses the same proposal', async () => {
    const f = serviceFixture();
    const preview = await f.service.previewAuto({ guildId: 'guild', count: 4 });
    assert.deepEqual(preview.counts, [10, 10, 11, 11]); assert.deepEqual(f.writes, []);
    f.current.status = 'signups_closed';
    const list = f.service.divisions.listBySeason;
    f.service.divisions.listBySeason = id => id === 'current' ? Promise.resolve([1, 2, 3, 4].map(id => ({ id: `new-${id}`, name: `Div ${id}`, sort_order: id }))) : list(id);
    await f.service.assignAuto({ guildId: 'guild' });
    assert.equal(f.writes[0], 'clear');
    for (const row of f.writes[1]) assert.equal(row.division_id, 'new-' + (find(preview, row.discord_user_id).proposal.divisionIndex + 1));
});
test('no confirmed previous results never award arbitrary promotions', async () => {
    const f = serviceFixture();
    f.service._getFinalTable = async ({ division }) => f.input.signups.filter(p => p.discord_user_id.startsWith(division.id + '-')).map(p => ({ discordUserId: p.discord_user_id, hasConfirmedResults: false }));
    const plan = await f.service.previewAuto({ guildId: 'guild', count: 4 });
    assert.equal(plan.stats.promotions, 0); assert.equal(plan.stats.relegations, 0); assert(plan.warnings.some(w => w.includes('no confirmed results')));
});
test('explicit assignment refuses conflicts before clearing saved players', async () => {
    const f = serviceFixture(); f.current.status = 'signups_closed';
    f.service.divisions.listBySeason = async () => [{ id: 1, sort_order: 1 }];
    f.service._buildProposal = async () => ({ conflicts: ['Protected capacity conflict'] });
    await assert.rejects(f.service.assignAuto({ guildId: 'guild' }), error => error.code === 'PROPOSAL_CONFLICT');
    assert.deepEqual(f.writes, []);
});
test('renderer produces readable PNGs with escaped names and paginates large rosters', async () => {
    const plan = model(); plan.groups[0][0].name = '<Alice & Bob> "Long name" '.repeat(5) + '🎯';
    const images = await renderDivisionProposalImages(plan);
    assert.equal(images.length, 1);
    const meta = await sharp(images[0]).metadata(); assert.equal(meta.width, 1280); assert(meta.height > 1000); assert(images[0].length < 8_000_000);
    const large = model({ signups: Array.from({ length: 90 }, (_, i) => ({ discord_user_id: `p${i}`, avg_3dart: 100 - i, name: `Player ${i}` })), count: 2 });
    assert.equal((await renderDivisionProposalImages(large)).length, 2);
});

function interaction(publish = false) {
    const calls = { edits: [], sends: [], preview: 0, names: 0 };
    const i = { guildId: 'guild', options: { getSubcommand: () => 'preview-auto', getInteger: () => 4, getBoolean: () => publish },
        client: { services: { divisions: { previewAuto: async () => { calls.preview++; return model(); } } },
            repos: { players: { listByDiscordIds: async () => { calls.names++; return []; } } } },
        deferReply: async message => { calls.defer = message; }, editReply: async message => calls.edits.push(message),
        followUp: async message => calls.edits.push(message), channel: { send: async message => calls.sends.push(message) } };
    return { i, calls };
}
test('command generates private graphics by default and only publishes on request', async () => {
    const definition = data.toJSON().options.find(option => option.name === 'preview-auto');
    assert(definition.options.some(option => option.name === 'publish'));
    const f = interaction(); await execute(f.i);
    assert.equal(f.calls.defer.flags, 64); assert.equal(f.calls.sends.length, 0); assert.equal(f.calls.preview, 1); assert.equal(f.calls.names, 1);
    assert.match(f.calls.edits[0].content, /10 \/ 10 \/ 11 \/ 11/); assert.equal(f.calls.edits[0].files.length, 2);
    const publicPreview = interaction(true); await execute(publicPreview.i);
    assert.equal(publicPreview.calls.sends.length, 1); assert.deepEqual(publicPreview.calls.sends[0].allowedMentions, { parse: [] });
});

test('history-first keeps every returning earned place and puts newcomers below full divisions', () => {
    const input = fixture();
    const plan = buildDivisionProposal({ ...input, strategy: 'history' });
    assert.deepEqual(plan.counts, [10, 10, 10, 12]);
    assert.equal(plan.stats.moved, 0); assert.equal(plan.stats.kept, 22); assert.equal(plan.stats.promotions, 4);
    for (const player of plan.groups.flat().filter(p => p.proposal.expectedIndex >= 0)) assert.equal(player.proposal.divisionIndex, player.proposal.expectedIndex);
    assert.equal(find(plan, 'new-1').proposal.divisionIndex, 3, 'even the strongest newcomer must wait for a vacancy');
    assert.equal(find(plan, '3-10').proposal.divisionIndex, 2, 'old lowest-division returner stays');
    assert.equal(plan.groups.flat().length, 42);
});
test('history-first fills only actual vacancies with newcomers, strongest first', () => {
    const input = fixture();
    input.signups = input.signups.filter(p => !['1-3', '2-3', '3-3'].includes(p.discord_user_id));
    const plan = buildDivisionProposal({ ...input, strategy: 'history' });
    assert.deepEqual(plan.counts, [10, 10, 10, 9]);
    assert.equal(find(plan,'new-1').proposal.divisionIndex,0);
    assert.equal(find(plan,'new-2').proposal.divisionIndex,1);
    assert.equal(find(plan,'new-3').proposal.divisionIndex,2);
    assert.equal(find(plan,'new-4').proposal.divisionIndex,3);
    assert.equal(plan.stats.moved,0);
    assert.match(find(plan,'new-1').proposal.detail,/vacancy/);
});
test('history-first never drops players when too few divisions are requested', () => {
    const input = fixture();
    const plan = buildDivisionProposal({ ...input, count:3, strategy:'history' });
    assert.equal(plan.groups.flat().length,42);
    assert.equal(new Set(plan.groups.flat().map(p=>p.discord_user_id)).size,42);
    assert(plan.conflicts.some(text=>text.includes('additional lower division')));
    assert.equal(plan.stats.moved,0);
});
test('both previews share historical reads and previewing saves neither option', async () => {
    const f = serviceFixture(); let reads=0;
    const original=f.service._getFinalTable;
    f.service._getFinalTable=async input=>{reads++;return original(input)};
    const plan = await f.service.previewAuto({guildId:'guild',count:4});
    assert.equal(reads,3);
    assert.equal(plan.alternatives.length,1);
    assert.equal(plan.alternatives[0].strategy,'history');
    assert.deepEqual(plan.alternatives[0].counts,[10,10,10,12]);
    assert.deepEqual(f.writes,[]);
});
test('command sends both clearly labelled graphics with one combined notes file', async () => {
    const f=interaction();
    const base=model();
    base.alternatives=[buildDivisionProposal({...fixture(),strategy:'history'})];
    f.i.client.services.divisions.previewAuto=async()=>base;
    await execute(f.i);
    const message=f.calls.edits[0];
    assert.match(message.content,/Option 1/);assert.match(message.content,/Option 2/);
    assert.match(message.content,/10 \/ 10 \/ 10 \/ 12/);
    assert.deepEqual(message.files.map(file=>file.name),['division-proposal-balanced-1.png','division-proposal-history-1.png','division-proposal-notes.txt']);
    assert.equal(f.calls.names,1);assert.equal(f.calls.sends.length,0);
});

function outlierFixture() {
    const signups=[],placementsByUser=new Map(),previousSignupIds=new Set();
    const add=(id,avg,old=null,rank=null)=>{
        signups.push({discord_user_id:id,avg_3dart:avg});
        if(old){previousSignupIds.add(id);placementsByUser.set(id,[{divisionName:'Div '+old,divisionSortOrder:old,rank,of:10}]);}
    };
    [63.8,60.9,59,57,52.4,49.7,49.5,48.9].forEach((avg,i)=>add('upper-'+i,avg,1));
    [49,48,45.7,45.7,43.7].forEach((avg,i)=>add('middle-'+i,avg,2));
    add('promoted-a',52.2,2,1);add('promoted-b',48,2,2);add('relegated',41,2,9);
    [42,41.6,38.9,37.3,36.7,33.9,29.7].forEach((avg,i)=>add('lower-'+i,avg,3));
    add('promoted-c',39.6,3,1);add('promoted-d',40.4,3,2);
    [62.2,55,54.2,51.4,50.1,50,48.2,47.9,43.6,41.3,41.2,40.7,40,40,36.5,34.3,29.9].forEach((avg,i)=>add('new-'+i,avg));
    return {signups,count:4,placementsByUser,previousSignupIds,previousDivisions:[1,2,3].map(i=>({name:'Div '+i,sort_order:i}))};
}
test('balanced preview swaps a weak upper-group returner with a strong lower-group newcomer', () => {
    const input=outlierFixture();const plan=buildDivisionProposal(input);
    assert.deepEqual(plan.counts,[10,10,11,11]);
    assert.equal(find(plan,'lower-5').proposal.divisionIndex,3);
    assert.equal(find(plan,'new-7').proposal.divisionIndex,2);
    assert.match(find(plan,'lower-5').proposal.detail,/Average-fit swap/);
    assert.equal(plan.stats.promotions,4);
    for(const id of ['promoted-a','promoted-b','promoted-c','promoted-d','relegated'])assert.equal(find(plan,id).proposal.divisionIndex,find(plan,id).proposal.expectedIndex);
    assert.equal(new Set(plan.groups.flat().map(p=>p.discord_user_id)).size,42);
    const history=buildDivisionProposal({...input,strategy:'history'});
    assert.equal(find(history,'lower-5').proposal.divisionIndex,2);assert.equal(history.stats.moved,0);
    assert(!history.groups.flat().some(p=>p.proposal.averageSwap));
});
test('outlier refinement is deterministic and never moves established players more than one division', () => {
    const input=outlierFixture();const first=buildDivisionProposal(input);
    const second=buildDivisionProposal({...input,signups:[...input.signups].reverse()});
    assert.deepEqual(first.groups.map(g=>g.map(p=>p.discord_user_id)),second.groups.map(g=>g.map(p=>p.discord_user_id)));
    for(const player of first.groups.flat())if(player.proposal.expectedIndex>=0)assert(Math.abs(player.proposal.divisionIndex-player.proposal.expectedIndex)<=1);
});
