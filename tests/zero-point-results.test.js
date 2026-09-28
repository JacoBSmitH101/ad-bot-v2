import test from 'node:test';
import assert from 'node:assert/strict';

// Never use credentials from the checkout's .env in unit tests.
Object.assign(process.env, {
    DISCORD_TOKEN: 'test', DISCORD_CLIENT_ID: 'test', GUILD_ID: 'test',
    SUPABASE_URL: 'https://example.invalid', SUPABASE_SERVICE_ROLE_KEY: 'test',
    INTERNAL_API_BASE_URL: 'https://example.invalid', INTERNAL_API_KEY: 'test',
});
const { PlayerStatsService } = await import('../src/services/PlayerStatsService.js');
const { StandingsService } = await import('../src/services/StandingsService.js');
const { MatchStatsService } = await import('../src/services/MatchStatsService.js');
const { data, execute } = await import('../src/discord/commands/division_void.js');
const { PermissionFlagsBits } = await import('discord.js');
const zero = { id: 'zero', status: 'confirmed', player_a_id: 'a', player_b_id: 'b', match_results: { legs_a: 0, legs_b: 0 } };
const win = { id: 'win', status: 'confirmed', player_a_id: 'a', player_b_id: 'b', match_results: { legs_a: 4, legs_b: 2 } };
const season = { id: 's', status: 'active' };
const deps = {
    seasons: { getCurrentForGuild: async () => season },
    matches: {
        listAllConfirmedForPlayerInGuild: async () => [zero, win],
        listForPlayerInSeasonWithResults: async () => [zero, win, { ...win, status: 'void' }],
        listHeadToHeadMatches: async () => [zero, win],
    },
};

test('0–0 is a draw, never a loss or points, for either player; voids excluded', async () => {
    const service = new PlayerStatsService(deps);
    for (const id of ['a', 'b']) {
        const { stats, recentMatches } = await service.getOverallStats({ guildId: 'g', discordUserId: id });
        assert.equal(stats.played, 2);
        assert.equal(stats.draws, 1);
        assert.equal(stats.wins, id === 'a' ? 1 : 0);
        assert.equal(stats.losses, id === 'a' ? 0 : 1);
        assert.equal(stats.points, id === 'a' ? 6 : 2);
        assert.equal(recentMatches[0].drawn, true);
        const current = await service.getCurrentSeasonStats({ guildId: 'g', discordUserId: id });
        assert.deepEqual(current.stats, stats);
    }
    const { record } = await service.getHeadToHead({ guildId: 'g', playerAId: 'a', playerBId: 'b' });
    assert.equal(record.wins, 1);
    assert.equal(record.losses, 0);
    assert.equal(record.draws, 1);
});

test('both standings paths award zero to both players for 0–0', async () => {
    const service = new StandingsService({
        seasons: deps.seasons,
        divisions: { listForSeason: async () => [{ id: 'd', name: 'Div 1' }] },
        divisionPlayers: { listPlayersForDivision: async () => ['a','b'].map(id => ({ discord_user_id: id })) },
        matches: { listAllForDivision: async () => [zero], listConfirmedWithResultsForDivision: async () => [zero] },
        statsDb: { from: () => { throw new Error('No stats lookup expected'); } },
    });
    const all = await service.getStandingsForSeason({ season });
    const one = await service.getDivisionStandings({ guildId: 'g', divisionId: 'd' });
    assert.deepEqual(all.divisions[0].standings, one.standings);
    for (const row of one.standings) {
        assert.equal(row.points, 0);
        assert.equal(row.wins, 0);
        assert.equal(row.losses, 0);
        assert.equal(row.played, 1);
    }
});

test('equal score cannot attribute Autodarts performance stats to either player', async () => {
    const service = new MatchStatsService({ internalApi: { getMatchStats: async () => ({ matchStats: [{ average: 80 }, { average: 20 }], scores: [{ legs: 0 }, { legs: 0 }] }) } });
    const result = await service.fetchKeyStatsForProofUrl('https://play.autodarts.com/history/matches/00000000-0000-0000-0000-000000000000', { legsA: 0, legsB: 0 });
    assert.equal(result.keyStats.averageA, null);
    assert.equal(result.keyStats.averageB, null);
});

function interaction(admin) {
    const replies = [];
    return {
        guildId: 'g', user: { id: 'u' }, memberPermissions: { has: permission => admin && permission === PermissionFlagsBits.Administrator },
        options: { getString: () => '1' }, replies,
        client: { services: { config: {}, results: { adminVoidRemainingDivision: async () => { throw new Error('must not mutate'); } } } },
        reply: async value => replies.push(value), deferReply: async () => {}, editReply: async value => replies.push(value),
    };
}

test('command schema is valid and runtime admin gate prevents unauthorized mutations', async () => {
    assert.equal(data.toJSON().name, 'division-void');
    const request = interaction(false);
    await execute(request);
    assert.match(request.replies[0].content, /permission/);
});

test('refresh failure preserves success message and attempts all publishers', async (t) => {
    t.mock.method(console, 'error', () => {});
    const request = interaction(true);
    const called = [];
    const services = request.client.services;
    services.results.adminVoidRemainingDivision = async () => ({ season: { name: 'Season' }, division: { name: 'Div 1' }, updated: [zero] });
    for (const key of ['standingsPublisher', 'fixturesPublisher', 'statsLeadersPublisher']) {
        services[key] = { refresh: async () => { called.push(key); if (key === 'standingsPublisher') throw new Error('Discord offline'); } };
    }
    await execute(request);
    assert.equal(called.length, 3);
    assert.match(request.replies.at(-1), /Voided \*\*1\*\*/);
    assert.match(request.replies.at(-1), /could not refresh/);
});
