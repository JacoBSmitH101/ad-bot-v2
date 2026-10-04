import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanGraphicName } from '../src/utils/cleanGraphicName.js';

test('removes whole emoji sequences and Discord custom emoji', () => {
    for (const tail of ['🎯🏆', '👨‍👩‍👧‍👦', '👍🏽', '🇬🇧', '1️⃣', '❤️', '<:darts:123456>', '<a:win:123456>']) {
        assert.equal(cleanGraphicName(`José 180 ${tail}`), 'José 180');
    }
});

test('preserves names, accents, numbers and non-Latin text', () => {
    for (const name of ['José 180', 'Zoë', 'Łukasz', '山田', 'O’Connor', 'Jose\u0301']) {
        assert.equal(cleanGraphicName(name), name);
    }
    assert.equal(cleanGraphicName('🏆'), '');
    assert.equal(cleanGraphicName(null), '');
});
