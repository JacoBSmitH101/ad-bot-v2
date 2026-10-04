import test from 'node:test';
import assert from 'node:assert/strict';
import { ResultService } from '../src/services/ResultService.js';
import { MatchRepository } from '../src/repositories/MatchRepository.js';
import { MatchesService } from '../src/services/MatchesService.js';

function setup(status = 'active') {
    const rows = [
        ...['scheduled', 'reported', 'disputed', 'confirmed', 'void'].map((status, i) => ({ id: String(i), season_id: 's', division_id: 'd', status })),
        { id: 'other-division', season_id: 's', division_id: 'other', status: 'scheduled' },
        { id: 'other-season', season_id: 'other', division_id: 'd', status: 'scheduled' },
    ];
    const scores = new Map(rows.map(row => [row.id, { legs_a: 4, legs_b: 2 }]));
    // Exercise the real repository's update filters against an in-memory query.
    const db = { from(table) {
        assert.equal(table, 'matches');
        const filters = [];
        let patch;
        return {
            update(value) { patch = value; return this; },
            eq(key, value) { filters.push(row => row[key] === value); return this; },
            in(key, values) { filters.push(row => values.includes(row[key])); return this; },
            select() { return this; },
            then(resolve) {
                const data = rows.filter(row => filters.every(filter => filter(row)));
                if (patch) data.forEach(row => Object.assign(row, patch));
                return Promise.resolve({ data: structuredClone(data), error: null }).then(resolve);
            },
        };
    } };
    const matches = new MatchRepository({ supabase: { schema: () => db }, schema: 'public' });
    const deps = {
        seasons: { getCurrentForGuild: async () => ({ id: 's', status }) },
        divisions: { getBySeasonAndName: async (id, name) => id === 's' && name === 'Div 1' ? { id: 'd', name } : null },
        matches,
        matchResults: { deleteByMatchIds: async ids => ids.forEach(id => scores.delete(id)) },
    };
    return { rows, scores, deps, service: new ResultService(deps) };
}

test('voids all open states only in selected division and season; repeat is harmless', async () => {
    const { rows, scores, service } = setup();
    const input = { guildId: 'g', divisionName: ' 1 ' };
    const result = await service.adminVoidRemainingDivision(input);
    assert.deepEqual(result.updated.map(row => row.id), ['0', '1', '2']);
    assert.equal(result.cleanupFailed, false);
    assert.equal(rows[3].status, 'confirmed');
    assert.equal(rows[5].status, 'scheduled');
    assert.equal(rows[6].status, 'scheduled');
    assert.deepEqual([...scores.keys()], ['3', 'other-division', 'other-season']);
    assert.equal((await service.adminVoidRemainingDivision(input)).updated.length, 0);
});

test('rejects setup seasons and unknown divisions before mutating', async () => {
    for (const status of ['draft', 'signups_open', 'signups_closed']) {
        const { service, rows } = setup(status);
        await assert.rejects(service.adminVoidRemainingDivision({ guildId: 'g', divisionName: '1' }), /active or closed/);
        assert.equal(rows[0].status, 'scheduled');
    }
    const { service, rows } = setup();
    await assert.rejects(service.adminVoidRemainingDivision({ guildId: 'g', divisionName: '2' }), /Division not found/);
    assert.equal(rows[0].status, 'scheduled');
});

test('cleanup failure reports committed voids and can be retried', async (t) => {
    t.mock.method(console, 'error', () => {});
    const { service, deps, scores, rows } = setup('closed');
    const cleanup = deps.matchResults.deleteByMatchIds;
    deps.matchResults.deleteByMatchIds = async () => { throw new Error('offline'); };
    const input = { guildId: 'g', divisionName: '1' };
    assert.equal((await service.adminVoidRemainingDivision(input)).cleanupFailed, true);
    assert.equal(rows[0].status, 'void');
    deps.matchResults.deleteByMatchIds = cleanup;
    const retried = await service.adminVoidRemainingDivision(input);
    assert.equal(retried.updated.length, 0);
    assert.equal(retried.cleanupFailed, false);
    assert.equal(scores.has('0'), false);
    assert.equal(scores.has('3'), true);
});

test('my matches never marks a void next and hides stale scores/proof', async () => {
    const service = new MatchesService({
        seasons: { getCurrentForGuild: async () => ({ id: 's', status: 'active' }) },
        matches: { listForPlayerInSeasonWithResults: async () => [
            { id: 'v', week: 1, status: 'void', player_a_id: 'a', player_b_id: 'b', match_results: { legs_a: 4, legs_b: 2, proof_url: 'stale' } },
            { id: 's', week: 2, status: 'scheduled', player_a_id: 'a', player_b_id: 'c' },
        ] },
    });
    const { weeks } = await service.getMyMatches({ guildId: 'g', discordUserId: 'a' });
    assert.match(weeks[0].lines[0], /0-0.*no points.*void/);
    assert.doesNotMatch(weeks[0].lines.join(' '), /Next up|stale|4-2/);
    assert.equal(weeks[1].lines[0], '👉 **Next up**');
});
