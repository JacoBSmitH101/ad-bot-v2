import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { buildSeasonSummary } from '../src/utils/buildSeasonSummary.js';
import { renderSeasonSummaryImage } from '../src/services/SeasonSummaryImageRenderer.js';
import { data, execute } from '../src/discord/commands/season-summary.js';

function fixture(status = 'closed') {
    return {
        season: { id: 's1', name: 'Season 4', guild_id: 'guild', status },
        divisions: [1, 2, 3].map(n => ({
            division: { id: n, name: `Division ${n}`, sort_order: n },
            standings: Array.from({ length: 6 }, (_, i) => ({
                discordUserId: `${n}-${i}`, name: `Player ${n}-${i + 1}`,
                points: 50 - i * 5, wins: 10 - i, played: 10, totalMatches: 10,
            })),
        })),
    };
}

test('three champions and correct top-two/bottom-two movements', () => {
    const input = fixture();
    input.divisions.reverse();
    const summary = buildSeasonSummary(input);
    assert.deepEqual(summary.champions.map(e => e.player.name), ['Player 1-1', 'Player 2-1', 'Player 3-1']);
    assert.deepEqual(summary.promotions.map(e => [e.from, e.to, e.players.map(p => p.name)]), [
        ['Division 2', 'Division 1', ['Player 2-1', 'Player 2-2']],
        ['Division 3', 'Division 2', ['Player 3-1', 'Player 3-2']],
    ]);
    assert.deepEqual(summary.moves.map(e => [e.from, e.to, e.players.map(p => p.name)]), [
        ['Division 1', 'Division 2', ['Player 1-5', 'Player 1-6']],
        ['Division 2', 'Division 3', ['Player 2-5', 'Player 2-6']],
    ]);
    assert.equal(summary.provisional, false);
    assert.equal(input.divisions[0].division.id, 3, 'input remains untouched');
});

test('active and incomplete closed seasons remain provisional', () => {
    assert.equal(buildSeasonSummary(fixture('active')).provisional, true);
    const input = fixture();
    input.divisions[0].standings[0].played--;
    input.divisions[0].standings[1].played--;
    const summary = buildSeasonSummary(input);
    assert.equal(summary.outstanding, 1);
    assert.equal(summary.provisional, true);
});

test('no champion for unplayed divisions, and no conflicting small-division moves', () => {
    const empty = fixture();
    empty.divisions[0].standings.forEach(p => { p.played = 0; p.totalMatches = 0; });
    assert.equal(buildSeasonSummary(empty).champions[0].player, null);
    assert.equal(buildSeasonSummary(empty).provisional, true);
    const small = fixture();
    small.divisions.forEach(d => { d.standings = d.standings.slice(0, 2); });
    const summary = buildSeasonSummary(small);
    const promotedIds = new Set(summary.promotions.flatMap(g => g.players.map(p => p.discordUserId)));
    const winnerIds = new Set(summary.champions.map(c => c.player.discordUserId));
    for (const player of summary.moves.flatMap(g => g.players)) {
        assert.equal(promotedIds.has(player.discordUserId) || winnerIds.has(player.discordUserId), false);
    }
});

test('single division has no promotion or relegation', () => {
    const input = fixture();
    input.divisions = input.divisions.slice(0, 1);
    const result = buildSeasonSummary(input);
    assert.deepEqual(result.promotions, []);
    assert.deepEqual(result.moves, []);
});

test('renderer supports long and XML-special names in a Discord-sized PNG', async () => {
    const input = fixture();
    input.divisions[0].standings[0].name = '<Alice & Bob> "The arrows" '.repeat(5);
    const png = await renderSeasonSummaryImage(buildSeasonSummary(input));
    const meta = await sharp(png).metadata();
    assert.equal(meta.format, 'png');
    assert.equal(meta.width, 1280);
    assert(png.length < 8_000_000);
});

function interaction({ permitted = true, publish = false, seasonId = null, otherGuild = false } = {}) {
    const result = fixture();
    if (otherGuild) result.season.guild_id = 'other';
    const calls = { reply: [], defer: [], edit: [], send: [], standings: 0 };
    const value = {
        guildId: 'guild', user: { id: 'admin' }, memberPermissions: { has: () => permitted },
        options: { getBoolean: () => publish, getString: () => seasonId },
        client: {
            services: { config: {}, standings: { getStandingsForSeason: async () => { calls.standings++; return result; } } },
            repos: { seasons: { getById: async () => result.season, getLatestStandingsSeasonForGuild: async () => result.season } },
        },
        reply: async x => calls.reply.push(x), deferReply: async x => calls.defer.push(x), editReply: async x => calls.edit.push(x),
        channel: { isTextBased: () => true, send: async x => calls.send.push(x) },
    };
    return { value, calls };
}

test('command registers automatically using existing command loader format', () => {
    const command = data.toJSON();
    assert.equal(command.name, 'season-summary');
    assert.deepEqual(command.options.map(o => o.name), ['season-id', 'publish']);
});

test('private preview makes no public post', async () => {
    const { value, calls } = interaction();
    await execute(value);
    assert.equal(calls.send.length, 0);
    assert.equal(calls.edit[0].files.length, 1);
    assert.equal(calls.defer[0].flags, 64);
    assert.equal(calls.standings, 1);
});

test('publish posts exactly one graphic without mentions', async () => {
    const { value, calls } = interaction({ publish: true });
    await execute(value);
    assert.equal(calls.send.length, 1);
    assert.equal(calls.send[0].files.length, 1);
    assert.deepEqual(calls.send[0].allowedMentions, { parse: [] });
});

test('unauthorized users and cross-server seasons cannot generate a graphic', async () => {
    const denied = interaction({ permitted: false });
    await execute(denied.value);
    assert.equal(denied.calls.standings, 0);
    assert.equal(denied.calls.reply.length, 1);
    const other = interaction({ seasonId: 's1', otherGuild: true });
    await execute(other.value);
    assert.equal(other.calls.standings, 0);
    assert.match(other.calls.edit[0], /this server/);
});
