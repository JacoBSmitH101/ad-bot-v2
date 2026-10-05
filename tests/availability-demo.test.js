import test from 'node:test';
import assert from 'node:assert/strict';
import { createAvailabilityDemo, availabilityDemoMessage, handleAvailabilityDemo, discardAvailabilityDemo } from '../src/discord/handlers/availabilityDemo.js';
import { execute, data } from '../src/discord/commands/availability-test.js';
import { demoDeadlines } from '../src/discord/handlers/demoDeadlines.js';

test('deadlines are next Sunday plus one week, with dates and no times', () => {
    for (const [released, original, extended] of [
        ['2026-10-04', 'Sunday 11 October 2026', 'Sunday 18 October 2026'],
        ['2026-10-05', 'Sunday 11 October 2026', 'Sunday 18 October 2026'],
        ['2026-12-27', 'Sunday 3 January 2027', 'Sunday 10 January 2027'],
        ['2026-03-28', 'Sunday 29 March 2026', 'Sunday 5 April 2026'],
    ]) {
        const dates = demoDeadlines(released);
        assert.equal(dates.original, original); assert.equal(dates.extended, extended);
    }
});

test('unavailable form accepts empty or supplied reason and only changes answer on submit', async () => {
    const state = createAvailabilityDemo('owner'); state.messageId = 'dm1';
    const open = event(state, 'unavailable'); await handleAvailabilityDemo(open);
    assert.equal(state.own, null);
    const form = open.calls.modal.toJSON();
    assert.equal(form.components[0].components[0].required, false);
    for (const reason of ['', 'Working late this week']) {
        const input = event(state, 'unavailable-submit', {modal:true, reason});
        await handleAvailabilityDemo(input);
        assert.equal(state.own, 'Not this week'); assert.equal(state.unavailableReason, reason);
    }
    await handleAvailabilityDemo(event(state, 'available-submit', {modal:true}));
    assert.equal(state.unavailableReason, '');
    discardAvailabilityDemo(state.id);
});

test('holiday reason is optional and privacy explanation is removed', async () => {
    const state = createAvailabilityDemo('owner'); state.messageId = 'dm1';
    const open = event(state, 'holiday'); await handleAvailabilityDemo(open);
    assert.equal(open.calls.modal.toJSON().components[1].components[0].required, false);
    await handleAvailabilityDemo(event(state, 'holiday-submit', {modal:true, reason:'Family trip'}));
    assert.equal(state.holidayReason, 'Family trip');
    assert(!JSON.stringify(availabilityDemoMessage(state)).includes('Your answer stays private'));
    state.screen='extension';
    assert(!JSON.stringify(availabilityDemoMessage(state)).includes('20:00'));
    await handleAvailabilityDemo(event(state, 'agree'));
    assert(state.extension.includes(state.dates.extended));
    discardAvailabilityDemo(state.id);
});

function event(state, action, { user = state.ownerId, modal = false, days = '4', reason = '', selectedDays = [], note = '', message = 'dm1' } = {}) {
    const calls = {};
    return { calls, user: { id: user }, message: { id: message },
        customId: `availability-demo:${state.id}:${action}`,
        isButton: () => !modal, isModalSubmit: () => modal,
        fields: { getStringSelectValues: () => selectedDays, getTextInputValue: key => key === 'days' ? days : key === 'available-note' ? note : reason },
        reply: async x => { calls.reply = x; }, update: async x => { calls.update = x; },
        showModal: async x => { calls.modal = x; },
    };
}
test('all screens serialize as Discord cards with valid buttons', () => {
    assert.equal(data.toJSON().name, 'availability-test');
    for (const screen of ['availability', 'extension', 'extension-request', 'admin']) {
        const state = createAvailabilityDemo('owner', screen);
        Object.assign(state, { holiday: 14, holidayReason: '*'.repeat(300), unavailableReason: '_'.repeat(300), history: true });
        const message = availabilityDemoMessage(state);
        assert.equal(message.flags, 32768);
        assert.equal(message.embeds, undefined);
        const parts = message.components.map(component => component.toJSON());
        assert.match(JSON.stringify(parts), /SAMPLE DATA ONLY/);
        const check = part => {
            if (part.custom_id) assert(part.custom_id.length <= 100);
            for (const child of part.components ?? []) check(child);
        };
        parts.forEach(check);
        discardAvailabilityDemo(state.id);
    }
});
test('responses only reveal together and stay revealed after changes', async () => {
    const state = createAvailabilityDemo('owner'); state.messageId = 'dm1';
    await handleAvailabilityDemo(event(state, 'opponent'));
    assert.equal(state.revealed, false);
    assert.match(JSON.stringify(availabilityDemoMessage(state)), /Hidden until you both answer/);
    await handleAvailabilityDemo(event(state, 'available-submit', {modal:true}));
    assert.equal(state.revealed, true);
    await handleAvailabilityDemo(event(state, 'unavailable-submit', {modal:true}));
    assert.equal(state.revealed, true);
    await handleAvailabilityDemo(event(state, 'reset'));
    assert.equal(state.revealed, false);
    discardAvailabilityDemo(state.id);
});
test('holiday modal validates 1–14 without altering the weekly answer', async () => {
    const state = createAvailabilityDemo('owner'); state.messageId = 'dm1';
    const open = event(state, 'holiday'); await handleAvailabilityDemo(open);
    assert.equal(open.calls.modal.toJSON().title, 'Your holiday (practice)');
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
test('command allows ordinary members and admins and sends to the caller', async () => {
    assert.equal(data.toJSON().default_member_permissions, undefined);
    const member=command(false);await execute(member);assert.equal(member.calls.sent,1);assert.equal(member.calls.defer.flags,64);
    const admin=command(true);await execute(admin);assert.equal(admin.calls.sent,1);assert.equal(admin.calls.defer.flags,64);assert.match(admin.calls.edit,/Sent a sample/);
});
test('closed DMs receive a helpful private error', async () => {
    const blocked=command(true,true);await execute(blocked);assert.match(blocked.calls.edit,/Allow direct messages/);
});
test('unrelated interactions are not consumed', async () => {
    assert.equal(await handleAvailabilityDemo({isButton:()=>true,isModalSubmit:()=>false,customId:'result_confirm:123'}),false);
});

function renderedButtons(state) {
    const found = [];
    const visit = part => {
        if (part.custom_id) found.push(part);
        (part.components ?? []).forEach(visit);
    };
    availabilityDemoMessage(state).components.map(x => x.toJSON()).forEach(visit);
    return found;
}
test('saved answers visibly select a button and can be changed', async () => {
    const state = createAvailabilityDemo('owner'); state.messageId = 'dm1';
    for (const [action, modal, suffix] of [['available-submit', true, ':available'], ['unavailable-submit', true, ':unavailable']]) {
        await handleAvailabilityDemo(event(state, action, { modal }));
        const buttons = renderedButtons(state);
        const selected = buttons.find(b => b.custom_id.endsWith(suffix));
        assert(selected.disabled); assert.match(selected.label, /^✓/);
        assert(!buttons.find(b => b.custom_id.endsWith(suffix === ':available' ? ':unavailable' : ':available')).disabled);
        assert.match(JSON.stringify(availabilityDemoMessage(state)), /Answer saved/);
    }
    discardAvailabilityDemo(state.id);
});
test('extra time is requested from the match card and needs confirmation', async () => {
    const state = createAvailabilityDemo('owner'); state.messageId = 'dm1';
    assert(renderedButtons(state).some(b => b.label === 'Ask for another week'));
    await handleAvailabilityDemo(event(state, 'extension-request'));
    assert.equal(state.extensionRequested, false);
    assert(JSON.stringify(availabilityDemoMessage(state)).includes(state.dates.extended));
    await handleAvailabilityDemo(event(state, 'send-extension'));
    assert.equal(state.extensionRequested, true);
    assert(renderedButtons(state).find(b => b.custom_id.endsWith(':send-extension')).disabled);
    await handleAvailabilityDemo(event(state, 'availability'));
    assert.match(JSON.stringify(availabilityDemoMessage(state)), /Waiting for Player2 to agree/);
    await handleAvailabilityDemo(event(state, 'reset'));
    assert.equal(state.extensionRequested, false);
    discardAvailabilityDemo(state.id);
});

test('available form is optional, saves only on submit and supports editing', async () => {
    const state = createAvailabilityDemo('owner'); state.messageId = 'dm1';
    const open = event(state, 'available'); await handleAvailabilityDemo(open);
    assert.equal(state.own, null);
    const form = open.calls.modal.toJSON();
    assert.equal(form.components[0].component.required, false);
    assert.equal(form.components[0].component.min_values, 0);
    assert.equal(form.components[1].component.required, false);
    assert(form.components[0].component.options.every(day => /October|January|February|March|April|May|June|July|August|September|November|December/.test(day.label)));
    const selectedDays = state.dates.days.slice(0, 2).map(day => day.value);
    await handleAvailabilityDemo(event(state, 'available-submit', {modal:true, selectedDays, note:'After 7'}));
    assert.equal(state.own, 'Available'); assert.deepEqual(state.ownDays, selectedDays);
    assert.equal(state.availableNote, 'After 7');
    assert(renderedButtons(state).some(button => button.label === 'Edit my days'));
    const edit = event(state, 'edit-days'); await handleAvailabilityDemo(edit);
    assert.equal(edit.calls.modal.toJSON().components[1].component.value, 'After 7');
    assert.deepEqual(edit.calls.modal.toJSON().components[0].component.options.filter(day => day.default).map(day=>day.value), selectedDays);
    await handleAvailabilityDemo(event(state, 'available-submit', {modal:true}));
    assert.equal(state.own, 'Available'); assert.deepEqual(state.ownDays, []); assert.equal(state.availableNote, '');
    discardAvailabilityDemo(state.id);
});
test('opponent days and note are hidden until both answer, invalid dates are rejected and reset clears days', async () => {
    const state = createAvailabilityDemo('owner'); state.messageId = 'dm1';
    await handleAvailabilityDemo(event(state, 'opponent'));
    assert(!JSON.stringify(availabilityDemoMessage(state)).includes('Player2’s days'));
    assert(!JSON.stringify(availabilityDemoMessage(state)).includes('Usually after 7'));
    const invalid=event(state,'available-submit',{modal:true,selectedDays:['1999-01-01']});
    await handleAvailabilityDemo(invalid); assert(invalid.calls.reply); assert.equal(state.own,null);
    await handleAvailabilityDemo(event(state, 'available-submit', {modal:true,selectedDays:[state.dates.days[0].value]}));
    assert.match(JSON.stringify(availabilityDemoMessage(state)), /Player2’s days/);
    assert.match(JSON.stringify(availabilityDemoMessage(state)), /Usually after 7/);
    await handleAvailabilityDemo(event(state,'reset'));
    assert.deepEqual(state.ownDays,[]); assert.deepEqual(state.otherDays,[]); assert.equal(state.availableNote,'');
    discardAvailabilityDemo(state.id);
});
test('day choices cover release through the Sunday deadline across a year boundary', () => {
    const dates=demoDeadlines('2026-12-27');
    assert.equal(dates.days.length,8);
    assert.equal(dates.days[0].value,'2026-12-27');
    assert.equal(dates.days.at(-1).value,'2027-01-03');
    assert.equal(dates.days.at(-1).label,'Sunday 3 January');
});
