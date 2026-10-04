import test from 'node:test';
import assert from 'node:assert/strict';
import { readMatchStats } from '../src/db/readMatchStats.js';

const pair = [{ average: 60, legsWon: 4 }, { average: 50, legsWon: 2 }];
const otherPair = [{ average: 65, legsWon: 4 }, pair[1]];
const consumers = [
    (s) => s?.stats?.matchStats ?? s?.matchStats ?? s,
    (s) => s?.matchStats || s,
    (s) => s?.matchStats ?? s?.stats?.matchStats ?? s,
];

for (const [name, stats] of [
    ['object', { matchStats: pair, games: ['unused large payload'] }],
    ['nested object', { stats: { matchStats: pair } }],
    ['both summaries', { matchStats: pair, stats: { matchStats: otherPair } }],
    ['legacy array', pair],
    ['legacy JSON string', JSON.stringify({ matchStats: pair })],
    ['empty summary', { matchStats: [], stats: { matchStats: otherPair } }],
    ['unusual summary', { matchStats: false, stats: { matchStats: pair } }],
    ['null', null],
]) {
    for (const batch of [false, true]) {
        test(`${name}: preserve consumed stats (${batch ? 'batch' : 'single'})`, async () => {
            const calls = [];
            const original = { match_id: 'match-1', stats };
            const result = await readMatchStats(async (columns) => {
                calls.push(columns);
                const row = columns.includes('->') ? {
                    match_id: original.match_id,
                    match_summary: stats?.matchStats ?? null,
                    nested_summary: stats?.stats?.matchStats ?? null,
                } : original;
                return { data: batch ? [row] : row, error: null };
            });
            const actual = (batch ? result.data[0] : result.data).stats;
            const parse = (s) => typeof s === 'string' ? JSON.parse(s) : s;
            for (const consume of consumers) {
                // Existing consumers ignore results that are not arrays.
                const before = consume(parse(stats));
                const after = consume(parse(actual));
                assert.deepEqual(Array.isArray(after) ? after : null,
                    Array.isArray(before) ? before : null);
            }
            if (name === 'object') assert.equal(calls.length, 1);
            if (name.startsWith('legacy')) assert.equal(calls.length, 2);
        });
    }
}

test('missing rows do not cause a fallback read', async () => {
    for (const data of [null, []]) {
        let calls = 0;
        assert.deepEqual(await readMatchStats(async () => {
            calls++;
            return { data, error: null };
        }), { data, error: null });
        assert.equal(calls, 1);
    }
});

test('projection errors fall back and preserve original read errors', async () => {
    const calls = [];
    const error = { message: 'unavailable' };
    const result = await readMatchStats(async (columns) => {
        calls.push(columns);
        return { data: null, error };
    });
    assert.equal(calls.length, 2);
    assert.equal(calls[1], 'match_id, stats');
    assert.equal(result.error, error);
});

test('mixed legacy batches use the original full read', async () => {
    const full = [{ match_id: 'one', stats: { matchStats: pair } },
        { match_id: 'two', stats: JSON.stringify(pair) }];
    const calls = [];
    const result = await readMatchStats(async (columns) => {
        calls.push(columns);
        return { error: null, data: columns.includes('->') ? [
            { match_id: 'one', match_summary: pair, nested_summary: null },
            { match_id: 'two', match_summary: null, nested_summary: null },
        ] : full };
    });
    assert.deepEqual(result.data, full);
    assert.equal(calls.length, 2);
});
