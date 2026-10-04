import { demoDeadlines } from './demoDeadlines.js';
import { randomUUID } from 'node:crypto';
import {
    ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, MessageFlags,
    ModalBuilder, TextInputBuilder, TextInputStyle, escapeMarkdown,
} from 'discord.js';

const sessions = new Map();
const TTL = 60 * 60 * 1000;
const PREFIX = 'availability-demo:';
const screens = new Set(['availability', 'extension', 'admin']);
function prune() {
    for (const [id, state] of sessions) if (Date.now() >= state.expires) sessions.delete(id);
}
export function createAvailabilityDemo(ownerId, screen = 'availability') {
    prune();
    if (sessions.size >= 200) throw new Error('Too many active demos. Try again later.');
    const state = {
        id: randomUUID(), ownerId, screen: screens.has(screen) ? screen : 'availability',
        expires: Date.now() + TTL, own: null, other: null, revealed: false,
        holiday: null, holidayReason: '', unavailableReason: '', dates: demoDeadlines(), extension: 'Awaiting your response', admin: 'Needs review', messageId: null,
    };
    sessions.set(state.id, state);
    return state;
}
export function discardAvailabilityDemo(id) { sessions.delete(id); }
const button = (state, action, label, style = ButtonStyle.Secondary) => new ButtonBuilder()
    .setCustomId(`${PREFIX}${state.id}:${action}`).setLabel(label).setStyle(style);
const row = (...buttons) => new ActionRowBuilder().addComponents(...buttons);

export function availabilityDemoMessage(state) {
    const embed = new EmbedBuilder().setColor(0x22d3ee)
        .setAuthor({ name: 'League Bot · Interactive demo' })
        .setFooter({ text: 'SAMPLE DATA ONLY • Nothing is saved to the league • Demo expires after 1 hour' });
    let actions;
    if (state.screen === 'availability') {
        const visibleOther = state.revealed ? state.other : 'Hidden until both players respond';
        embed.setTitle('Week 3 · Your opponent: Player2')
            .setDescription('**Season 9 · Division 1**\nCan you play your fixture this week?')
            .addFields(
                { name: 'You · Player1', value: state.own ?? 'Not answered', inline: true },
                { name: 'Player2', value: visibleOther, inline: true },
                { name: 'Play by', value: state.dates.original },
            );
        if (state.holiday) embed.addFields({ name: 'Your sample holiday', value: `${state.holiday} days away. Dates would be public; this does not change your weekly answer or grant an extension.` });
        if (state.unavailableReason) embed.addFields({ name: 'Your unavailable reason', value: escapeMarkdown(state.unavailableReason) });
        if (state.holidayReason) embed.addFields({ name: 'Your holiday reason', value: escapeMarkdown(state.holidayReason) });
        actions = [row(button(state, 'available', 'Available', ButtonStyle.Success),
            button(state, 'unavailable', 'Not this week'), button(state, 'holiday', 'Set holiday')),
        row(button(state, 'opponent', 'Simulate opponent reply', ButtonStyle.Primary), button(state, 'reset', 'Reset sample'))];
    } else if (state.screen === 'extension') {
        embed.setColor(0xfbbf24).setTitle('Player1 requested a one-week extension')
            .setDescription('**You are Player2 in this sample.**\nExample fixture: Player1 vs Player2 · Week 3')
            .addFields({ name: 'Fixture release', value: state.dates.released },
                { name: 'Original deadline', value: state.dates.original, inline: true },
                { name: 'Proposed deadline', value: state.dates.extended, inline: true },
                { name: 'Request status', value: state.extension },
                { name: 'Proposed rule', value: 'The standard deadline is the Sunday after fixture release. An extension adds one week. This demo still uses mutual agreement; exceptions go to an admin.' });
        actions = [row(button(state, 'agree', 'Agree', ButtonStyle.Success), button(state, 'decline', 'Can’t agree'), button(state, 'review', 'Ask admin'))];
    } else {
        embed.setColor(0xfda4af).setTitle('Admin review · Player3 vs Player4')
            .setDescription('**Sample case:** Player3 requested a one-week extension; Player4 could not agree.')
            .addFields({ name: 'Availability', value: 'Player3: Not this week\nPlayer4: Available', inline: true },
                { name: 'Holiday record', value: 'Player3: 4 days away\nDeclared before the deadline', inline: true },
                { name: 'Original deadline', value: state.dates.original, inline: true },
                { name: 'Extended deadline', value: state.dates.extended, inline: true },
                { name: 'Decision', value: state.admin },
                { name: 'Attendance flag', value: 'Player3 has 3 unresolved fixtures to review. No automatic disqualification or forfeit.' });
        actions = [row(button(state, 'history', 'View history'), button(state, 'approve', 'Approve +1 week', ButtonStyle.Success), button(state, 'keep', 'Keep original deadline'))];
        if (state.history) embed.addFields({ name: 'Sample history', value: 'Holiday declared\nBoth availability answers revealed\nPlayer3 requested +1 week\nPlayer4 could not agree' });
    }
    return { embeds: [embed], components: [...actions, row(
        button(state, 'availability', 'Weekly DM'), button(state, 'extension', 'Extension request'), button(state, 'admin', 'Admin review'))], allowedMentions: { parse: [] } };
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
            const input = new TextInputBuilder().setCustomId('reason').setLabel('Reason (optional)')
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
            const modal = new ModalBuilder().setCustomId(`${PREFIX}${id}:holiday-submit`).setTitle('Sample holiday · no real booking')
                .addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder()
                    .setCustomId('days').setLabel('Days away (1–14)').setStyle(TextInputStyle.Short)
                    .setRequired(true).setMaxLength(2).setPlaceholder('4')), reasonInput(state.holidayReason));
            await interaction.showModal(modal);
            return true;
        }
        if (screens.has(action)) state.screen = action;
        else if (action === 'available') { state.own = 'Available'; state.unavailableReason = ''; }
        else if (action === 'opponent') state.other = state.other === 'Available' ? 'Not this week' : 'Available';
        else if (action === 'reset') Object.assign(state, { own: null, other: null, revealed: false, holiday: null, holidayReason: '', unavailableReason: '' });
        else if (action === 'agree') state.extension = `Approved in this demo · ${state.dates.extended}`;
        else if (action === 'decline') state.extension = 'Could not agree · Admin review needed. No win awarded.';
        else if (action === 'review') state.extension = 'Sent to the sample admin queue · Original deadline still applies.';
        else if (action === 'history') state.history = !state.history;
        else if (action === 'approve') state.admin = `Demo decision: approved until ${state.dates.extended}. No real fixture changed.`;
        else if (action === 'keep') state.admin = 'Demo decision: original deadline kept. No result or forfeit recorded.';
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
