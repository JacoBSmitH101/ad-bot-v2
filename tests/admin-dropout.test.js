import test from 'node:test';
import assert from 'node:assert/strict';
import { data, execute } from '../src/discord/commands/admin-dropout.js';
import { SignupService } from '../src/services/SignupService.js';

function fixture({ admin = true, config = {}, status = 'signups_open', signedUp = true, refreshFails = false } = {}) {
    const calls = { deleted: [], refresh: 0, edits: [] };
    const signups = new SignupService({
        seasons: { getCurrentForGuild: async guild => { assert.equal(guild, 'guild'); return { id: 'current', name: 'Season 9', status }; } },
        players: {}, signups: {
            getBySeasonAndUser: async (season, user) => { assert.equal(season, 'current'); assert.equal(user, 'target'); return signedUp ? { avg_3dart: 45 } : null; },
            deleteBySeasonAndUser: async (season, user) => calls.deleted.push([season, user]),
        },
    });
    const interaction = { guildId: 'guild', user: { id: 'actor' },
        memberPermissions: { has: () => admin },
        options: { getUser: () => ({ id: 'target' }) },
        client: { services: { config, signups, signupsPublisher: { refresh: async input => { assert.equal(input.guildId, 'guild'); calls.refresh++; if (refreshFails) throw new Error('Refresh failed'); } } } },
        reply: async message => { calls.reply = message; },
        deferReply: async message => { calls.defer = message; },
        editReply: async message => calls.edits.push(message),
    };
    return { interaction, calls };
}

test('command is admin-only with a required player selection', () => {
    const definition = data.toJSON();
    assert.equal(definition.name, 'admin-dropout');
    assert.equal(definition.default_member_permissions, '8');
    assert.equal(definition.options[0].name, 'user');
    assert.equal(definition.options[0].required, true);
});
test('ordinary members cannot remove signups', async () => {
    const f = fixture({ admin: false }); await execute(f.interaction);
    assert.equal(f.calls.reply.flags, 64); assert.deepEqual(f.calls.deleted, []); assert.equal(f.calls.refresh, 0);
});
test('server admins and the configured league admin can remove the selected user only', async () => {
    for (const options of [{}, { admin: false, config: { adminUserId: 'actor' } }]) {
        const f = fixture(options); await execute(f.interaction);
        assert.equal(f.calls.defer.flags, 64);
        assert.deepEqual(f.calls.deleted, [['current', 'target']]);
        assert.equal(f.calls.refresh, 1); assert.match(f.calls.edits[0].content, /Removed <@target>/);
        assert.deepEqual(f.calls.edits[0].allowedMentions, { parse: [] });
    }
});
test('configured admin role is accepted', async () => {
    const f = fixture({ admin: false, config: { adminRoleId: 'admins' } });
    f.interaction.member = { roles: { cache: new Map([['admins', {}]]) } };
    await execute(f.interaction); assert.equal(f.calls.deleted.length, 1);
});
test('closed or active seasons cannot be changed through signup removal', async () => {
    for (const status of ['signups_closed', 'active', 'closed']) {
        const f = fixture({ status }); await execute(f.interaction);
        assert.deepEqual(f.calls.deleted, []); assert.equal(f.calls.refresh, 0); assert.match(f.calls.edits[0].content, /Signups must be open/);
    }
});
test('an unsigned player gets a clear response with no removal or refresh', async () => {
    const f = fixture({ signedUp: false }); await execute(f.interaction);
    assert.match(f.calls.edits[0].content, /That player is not signed up/);
    assert.deepEqual(f.calls.deleted, []); assert.equal(f.calls.refresh, 0);
});
test('a list-refresh failure preserves the successful removal message', async () => {
    const f = fixture({ refreshFails: true }); await execute(f.interaction);
    assert.equal(f.calls.deleted.length, 1);
    assert.match(f.calls.edits.at(-1).content, /Removed <@target>/);
    assert.match(f.calls.edits.at(-1).content, /signups publish/);
});
