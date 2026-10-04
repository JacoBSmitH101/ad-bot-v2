import test from 'node:test';
import assert from 'node:assert/strict';
import { createAvailabilityDemo, availabilityDemoMessage, handleAvailabilityDemo, discardAvailabilityDemo } from '../src/discord/handlers/availabilityDemo.js';
import { execute, data } from '../src/discord/commands/availability-test.js';

function event(state, action, { user = state.ownerId, modal = false, days = '4', message = 'dm1' } = {}) {
    const calls = {};
    return { calls, user: { id: user }, message: { id: message },
        customId: `availability-demo:${state.id}:${action}`,
        isButton: () => !modal, isModalSubmit: () => modal,
        fields: { getTextInputValue: () => days },
        reply: async x => { calls.reply = x; }, update: async x => { calls.update = x; },
        showModal: async x => { calls.modal = x; },
    };
}
test('all screens serialize with native Discord embeds and valid buttons', () => {
    assert.equal(data.toJSON().name, 'availability-test');
    for (const screen of ['availability', 'extension', 'admin']) {
        const state = createAvailabilityDemo('owner', screen);
        const message = availabilityDemoMessage(state);
        assert.match(message.embeds[0].toJSON().footer.text, /SAMPLE DATA ONLY/);
        for (const row of message.components) for (const button of row.toJSON().components) assert(button.custom_id.length <= 100);
        discardAvailabilityDemo(state.id);
    }
});
test('responses only reveal together and stay revealed after changes', async () => {
    const state = createAvailabilityDemo('owner'); state.messageId = 'dm1';
    await handleAvailabilityDemo(event(state, 'opponent'));
    assert.equal(state.revealed, false);
    assert.match(availabilityDemoMessage(state).embeds[0].toJSON().fields[1].value, /Hidden/);
    await handleAvailabilityDemo(event(state, 'available'));
    assert.equal(state.revealed, true);
    await handleAvailabilityDemo(event(state, 'unavailable'));
    assert.equal(state.revealed, true);
    await handleAvailabilityDemo(event(state, 'reset'));
    assert.equal(state.revealed, false);
    discardAvailabilityDemo(state.id);
});
test('holiday modal validates 1–14 without altering the weekly answer', async () => {
    const state = createAvailabilityDemo('owner'); state.messageId = 'dm1';
    const open = event(state, 'holiday'); await handleAvailabilityDemo(open);
    assert.equal(open.calls.modal.toJSON().title, 'Sample holiday · no real booking');
    for (const days of ['0','15','-1','2.5','xx']) {
        const invalid = event(state, 'holiday-submit', { modal:true, days });
        await handleAvailabilityDemo(invalid); assert(invalid.calls.reply); assert.equal(state.holiday,null);
    }
    const valid = event(state, 'holiday-submit', { modal:true }); await handleAvailabilityDemo(valid);
    assert.equal(state.holiday,4); assert.equal(state.own,null); assert(valid.calls.update);
    discardAvailabilityDemo(state.id);
});
test('only the owner on the original message can use the demo; expired demos are rejected', async () => {
    const state = createAvailabilityDemo('owner'); state.messageId = 'dm1';
    for (const options of [{user:'other'}, {message:'other-dm'}]) {
        const denied = event(state,'available',options); await handleAvailabilityDemo(denied);
        assert(denied.calls.reply); assert.equal(state.own,null);
    }
    state.expires = Date.now()-1;
    const expired = event(state,'available'); await handleAvailabilityDemo(expired); assert(expired.calls.reply);
});
test('extension and admin buttons affect sample state only', async () => {
    const state = createAvailabilityDemo('owner'); state.messageId = 'dm1';
    for (const action of ['extension','agree','decline','review','admin','history','approve','keep','availability']) {
        const input=event(state,action); await handleAvailabilityDemo(input); assert(input.calls.update);
    }
    assert.match(state.admin,/No result or forfeit/); discardAvailabilityDemo(state.id);
});
function command(admin, fail = false) {
    const calls = { sent:0 };
    return { calls, guildId:'guild', user:{id:'owner',send:async payload=>{calls.sent++; calls.payload=payload; if(fail)throw Object.assign(new Error('DM blocked'),{code:50007});return {id:'dm1'}}},
        client:{services:{config:{}}}, memberPermissions:{has:()=>admin},
        options:{getString:()=>null}, reply:async x=>{calls.reply=x}, deferReply:async x=>{calls.defer=x}, editReply:async x=>{calls.edit=x} };
}
test('command denies non-admins and sends only to the invoking admin', async () => {
    const denied=command(false);await execute(denied);assert.equal(denied.calls.sent,0);
    const admin=command(true);await execute(admin);assert.equal(admin.calls.sent,1);assert.equal(admin.calls.defer.flags,64);assert.match(admin.calls.edit,/Sent a sample/);
});
test('closed DMs receive a helpful private error', async () => {
    const blocked=command(true,true);await execute(blocked);assert.match(blocked.calls.edit,/Allow direct messages/);
});
test('unrelated interactions are not consumed', async () => {
    assert.equal(await handleAvailabilityDemo({isButton:()=>true,isModalSubmit:()=>false,customId:'result_confirm:123'}),false);
});
