import { demoDeadlines } from './demoDeadlines.js';
import { randomUUID } from 'node:crypto';
import {
    ActionRowBuilder, ButtonBuilder, ButtonStyle, ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, MessageFlags,
    ModalBuilder, TextInputBuilder, TextInputStyle, escapeMarkdown,
} from 'discord.js';

const sessions = new Map();
const TTL = 60 * 60 * 1000;
const PREFIX = 'availability-demo:';
const screens = new Set(['availability', 'extension', 'extension-request', 'admin']);
function prune() {
    for (const [id, state] of sessions) if (Date.now() >= state.expires) sessions.delete(id);
}
export function createAvailabilityDemo(ownerId, screen = 'availability') {
    prune();
    if (sessions.size >= 200) throw new Error('Too many active demos. Try again later.');
    const state = {
        id: randomUUID(), ownerId, screen: screens.has(screen) ? screen : 'availability',
        expires: Date.now() + TTL, own: null, other: null, revealed: false,
        extensionRequested: false, extensionChoice: null, adminChoice: null, holiday: null, holidayReason: '', unavailableReason: '', dates: demoDeadlines(), extension: 'Awaiting your response', admin: 'Needs review', messageId: null,
    };
    sessions.set(state.id, state);
    return state;
}
export function discardAvailabilityDemo(id) { sessions.delete(id); }
const button = (state, action, label, style = ButtonStyle.Secondary) => new ButtonBuilder()
    .setCustomId(`${PREFIX}${state.id}:${action}`).setLabel(label).setStyle(style);
const choiceButton = (state, action, label, selected, style = ButtonStyle.Secondary) =>
    button(state, action, selected ? '✓ ' + label : label, selected ? ButtonStyle.Primary : style).setDisabled(selected);
const row = (...buttons) => new ActionRowBuilder().addComponents(...buttons);

export function availabilityDemoMessage(state) {
    const card = new ContainerBuilder().setAccentColor(0x22d3ee);
    const text = content => new TextDisplayBuilder().setContent(content);
    const divider = () => card.addSeparatorComponents(new SeparatorBuilder());
    if (state.screen === 'availability') {
        const other = state.revealed ? state.other : 'Hidden until you both answer';
        card.addTextDisplayComponents(text('## Your match this week\nYou’re playing **Player2**.'));
        card.addTextDisplayComponents(text('**Play by**\n' + state.dates.original));
        divider();
        card.addTextDisplayComponents(text(state.own ? '### Answer saved: ' + (state.own === 'Available' ? 'you can play' : 'you can’t play this week') : '### Can you play by this date?'));
        card.addActionRowComponents(row(
            choiceButton(state, 'available', 'Yes, I can play', state.own === 'Available', ButtonStyle.Success),
            choiceButton(state, 'unavailable', 'No, I can’t play', state.own === 'Not this week')));
        card.addActionRowComponents(row(button(state, 'holiday', state.holiday ? 'Holiday saved: ' + state.holiday + ' days' : 'I’m on holiday', state.holiday ? ButtonStyle.Primary : ButtonStyle.Secondary),
            button(state, 'extension-request', state.extensionRequested ? 'View your request' : 'Ask for another week')));
        divider();
        card.addTextDisplayComponents(text('**Your answer:** ' + (state.own ?? 'Not answered yet') +
            '\n**Player2’s answer:** ' + other));
        const notes = [];
        if (state.extensionRequested) notes.push('### Extra time requested\nWaiting for Player2 to agree. Keep the original date for now.');
        if (state.holiday) notes.push('**Your holiday:** ' + state.holiday +
            ' days away. You still need to answer for this match. This does not add extra time.');
        if (state.unavailableReason) notes.push('**Your reason:** ' + escapeMarkdown(state.unavailableReason));
        if (state.holidayReason) notes.push('**Holiday reason:** ' + escapeMarkdown(state.holidayReason));
        if (notes.length) card.addTextDisplayComponents(text(notes.join('\n\n')));
    } else if (state.screen === 'extension-request') {
        card.setAccentColor(0xfbbf24);
        card.addTextDisplayComponents(text('## Ask for another week\nYour match against **Player2**.'));
        card.addTextDisplayComponents(text('**Current date**\n' + state.dates.original +
            '\n\n**Requested date**\n' + state.dates.extended));
        divider();
        card.addTextDisplayComponents(text(state.extensionRequested
            ? '### Request sent\nWaiting for Player2 to agree. Keep the original date for now.'
            : 'Player2 needs to agree to the new date.'));
        card.addActionRowComponents(row(choiceButton(state, 'send-extension', state.extensionRequested ? 'Request sent' : 'Send request',
            state.extensionRequested, ButtonStyle.Success), button(state, 'availability', 'Back to your match')));
    } else if (state.screen === 'extension') {
        card.setAccentColor(0xfbbf24);
        card.addTextDisplayComponents(text('## A little more time\nPlayer2 needs another week to play your match.'));
        card.addTextDisplayComponents(text('**Current date**\n' + state.dates.original +
            '\n\n**With an extra week**\n' + state.dates.extended));
        divider();
        card.addTextDisplayComponents(text(state.extensionChoice ? '### ' + state.extension : '### Is the new date okay for you?'));
        card.addActionRowComponents(row(choiceButton(state, 'agree', 'Yes, that’s fine', state.extensionChoice === 'agree', ButtonStyle.Success),
            choiceButton(state, 'decline', 'No, I can’t', state.extensionChoice === 'decline'), choiceButton(state, 'review', 'Ask for help', state.extensionChoice === 'review')));
        divider();
        card.addTextDisplayComponents(text('**Your answer:** ' + state.extension));
    } else {
        card.setAccentColor(0xfda4af);
        card.addTextDisplayComponents(text('## Admin review\n**Player3 vs Player4**\nPlayer3 requested another week. Player4 could not agree.'));
        divider();
        card.addTextDisplayComponents(text('**Players’ answers**\nPlayer3: Not this week\nPlayer4: Available\n\n' +
            '**Holiday**\nPlayer3: 4 days away, declared before the deadline.'));
        card.addTextDisplayComponents(text('**Current date:** ' + state.dates.original +
            '\n**With another week:** ' + state.dates.extended));
        card.addTextDisplayComponents(text('**Needs attention**\nPlayer3 has 3 unresolved matches to review.'));
        if (state.history) card.addTextDisplayComponents(text('**History**\nHoliday declared\nBoth players answered\nPlayer3 requested another week\nPlayer4 could not agree'));
        divider();
        card.addActionRowComponents(row(choiceButton(state, 'approve', 'Allow another week', state.adminChoice === 'approve', ButtonStyle.Success),
            choiceButton(state, 'keep', 'Keep current date', state.adminChoice === 'keep'), button(state, 'history', state.history ? 'Hide history' : 'View history')));
        card.addTextDisplayComponents(text('**Decision:** ' + state.admin));
    }
    const testing = [text('-# SAMPLE DATA ONLY · Practice message · Lasts 1 hour')];
    if (state.screen === 'availability') testing.push(row(
        button(state, 'opponent', 'Try an opponent answer'), button(state, 'reset', 'Start again')));
    testing.push(row(button(state, 'availability', 'Your match'),
        button(state, 'extension', 'Try receiving a request'), button(state, 'admin', 'Admin example')));
    return { flags: MessageFlags.IsComponentsV2, components: [card, ...testing], allowedMentions: { parse: [] } };
}

/** Demo-only interactions: no repository, database, or real-player messaging. */
export async function handleAvailabilityDemo(interaction) {
    if (!(interaction.isButton() || interaction.isModalSubmit()) || !interaction.customId?.startsWith(PREFIX)) return false;
    try {
        prune();
        const [, id, action] = interaction.customId.split(':');
        const state = sessions.get(id);
        if (!state || state.ownerId !== interaction.user.id ||
            (interaction.isButton() && interaction.message.id !== state.messageId)) {
            await interaction.reply({ content: 'This demo is expired or belongs to someone else. Run /availability-test again in the server.', flags: MessageFlags.Ephemeral });
            return true;
        }
        if (interaction.isModalSubmit()) {
            if (!['holiday-submit', 'unavailable-submit'].includes(action)) return true;
            const reason = interaction.fields.getTextInputValue('reason').trim().slice(0, 300);
            if (action === 'unavailable-submit') {
                state.own = 'Not this week';
                state.unavailableReason = reason;
                state.screen = 'availability';
                if (state.other) state.revealed = true;
                await interaction.update(availabilityDemoMessage(state));
                return true;
            }
            const raw = interaction.fields.getTextInputValue('days').trim();
            const days = Number(raw);
            if (!/^\d{1,2}$/.test(raw) || days < 1 || days > 14) {
                await interaction.reply({ content: 'Use a whole number from 1 to 14 days. No holiday was recorded.', flags: MessageFlags.Ephemeral });
                return true;
            }
            state.holiday = days;
            state.holidayReason = reason;
            state.screen = 'availability';
            // Component-launched modal submissions update their originating DM.
            await interaction.update(availabilityDemoMessage(state));
            return true;
        }
        const reasonInput = (value = '') => {
            const input = new TextInputBuilder().setCustomId('reason').setLabel('Reason — you can leave this blank')
                .setStyle(TextInputStyle.Paragraph).setRequired(false).setMaxLength(300);
            if (value) input.setValue(value);
            return new ActionRowBuilder().addComponents(input);
        };
        if (action === 'unavailable') {
            const modal = new ModalBuilder().setCustomId(`${PREFIX}${id}:unavailable-submit`)
                .setTitle('Not available this week')
                .addComponents(reasonInput(state.unavailableReason));
            await interaction.showModal(modal);
            return true;
        }
        if (action === 'holiday') {
            const modal = new ModalBuilder().setCustomId(`${PREFIX}${id}:holiday-submit`).setTitle('Your holiday (practice)')
                .addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder()
                    .setCustomId('days').setLabel('Days away (1–14)').setStyle(TextInputStyle.Short)
                    .setRequired(true).setMaxLength(2).setPlaceholder('4')), reasonInput(state.holidayReason));
            await interaction.showModal(modal);
            return true;
        }
        if (screens.has(action)) state.screen = action;
        else if (action === 'available') { state.own = 'Available'; state.unavailableReason = ''; }
        else if (action === 'opponent') state.other = state.other === 'Available' ? 'Not this week' : 'Available';
        else if (action === 'reset') Object.assign(state, { own: null, other: null, revealed: false, holiday: null, holidayReason: '', unavailableReason: '', extensionRequested: false, extensionChoice: null, adminChoice: null, extension: 'Awaiting your response', admin: 'Needs review', history: false });
        else if (action === 'send-extension') state.extensionRequested = true;
        else if (action === 'agree') state.extension = `Agreed. Play by ${state.dates.extended}`;
        else if (action === 'decline') state.extension = 'You couldn’t agree. An admin will need to help.';
        else if (action === 'review') state.extension = 'You’ve asked for help. Keep the original date for now.';
        else if (action === 'history') state.history = !state.history;
        else if (action === 'approve') state.admin = `Demo decision: approved until ${state.dates.extended}. No real fixture changed.`;
        else if (action === 'keep') state.admin = 'Demo decision: original deadline kept. No result or forfeit recorded.';
        if (['agree', 'decline', 'review'].includes(action)) state.extensionChoice = action;
        if (['approve', 'keep'].includes(action)) state.adminChoice = action;
        if (state.own && state.other) state.revealed = true;
        await interaction.update(availabilityDemoMessage(state));
    } catch (error) {
        console.error('Availability demo interaction failed:', error);
        const payload = { content: 'The demo could not update. No league data was changed. Try /availability-test again.', flags: MessageFlags.Ephemeral };
        if (interaction.replied || interaction.deferred) await interaction.followUp(payload).catch(() => {});
        else await interaction.reply(payload).catch(() => {});
    }
    return true;
}
