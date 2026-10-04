import { randomUUID } from 'node:crypto';
import {
    ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, MessageFlags,
    ModalBuilder, TextInputBuilder, TextInputStyle,
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
        holiday: null, extension: 'Awaiting your response', admin: 'Needs review', messageId: null,
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
                { name: state.revealed ? 'Both answers are now visible' : 'Your answer stays private',
                    value: state.revealed ? 'Changes stay visible. Availability does not award a win or change your deadline.' : 'Both answers appear together once you have both responded. No reply is not a forfeit.' },
            );
        if (state.holiday) embed.addFields({ name: 'Your sample holiday', value: `${state.holiday} days away. Dates would be public; this does not change your weekly answer or grant an extension.` });
        actions = [row(button(state, 'available', 'Available', ButtonStyle.Success),
            button(state, 'unavailable', 'Not this week'), button(state, 'holiday', 'Set holiday')),
        row(button(state, 'opponent', 'Simulate opponent reply', ButtonStyle.Primary), button(state, 'reset', 'Reset sample'))];
    } else if (state.screen === 'extension') {
        embed.setColor(0xfbbf24).setTitle('Player1 requested 3 extra days')
            .setDescription('**You are Player2 in this sample.**\nExample fixture: Player1 vs Player2 · Week 3')
            .addFields({ name: 'Original deadline', value: 'Sunday · 20:00', inline: true },
                { name: 'Proposed deadline', value: 'Wednesday · 20:00', inline: true },
                { name: 'Request status', value: state.extension },
                { name: 'Proposed rule', value: 'First extension of up to 7 days: approved if both agree before the deadline and within the season cutoff. Otherwise an admin reviews it. Example times only.' });
        actions = [row(button(state, 'agree', 'Agree', ButtonStyle.Success), button(state, 'decline', 'Can’t agree'), button(state, 'review', 'Ask admin'))];
    } else {
        embed.setColor(0xfda4af).setTitle('Admin review · Player3 vs Player4')
            .setDescription('**Sample case:** Player3 requested 3 extra days; Player4 could not agree.')
            .addFields({ name: 'Availability', value: 'Player3: Not this week\nPlayer4: Available', inline: true },
                { name: 'Holiday record', value: 'Player3: 4 days away\nDeclared before the deadline', inline: true },
                { name: 'Decision', value: state.admin },
                { name: 'Attendance flag', value: 'Player3 has 3 unresolved fixtures to review. No automatic disqualification or forfeit.' });
        actions = [row(button(state, 'history', 'View history'), button(state, 'approve', 'Approve +3 days', ButtonStyle.Success), button(state, 'keep', 'Keep original deadline'))];
        if (state.history) embed.addFields({ name: 'Sample history', value: 'Mon 09:00 · Holiday declared\nMon 12:00 · Both availability answers revealed\nTue 18:00 · Player3 requested +3 days\nTue 19:00 · Player4 could not agree' });
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
            if (action !== 'holiday-submit') return true;
            const raw = interaction.fields.getTextInputValue('days').trim();
            const days = Number(raw);
            if (!/^\d{1,2}$/.test(raw) || days < 1 || days > 14) {
                await interaction.reply({ content: 'Use a whole number from 1 to 14 days. No holiday was recorded.', flags: MessageFlags.Ephemeral });
                return true;
            }
            state.holiday = days;
            state.screen = 'availability';
            // Component-launched modal submissions update their originating DM.
            await interaction.update(availabilityDemoMessage(state));
            return true;
        }
        if (action === 'holiday') {
            const modal = new ModalBuilder().setCustomId(`${PREFIX}${id}:holiday-submit`).setTitle('Sample holiday · no real booking')
                .addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder()
                    .setCustomId('days').setLabel('Days away (1–14)').setStyle(TextInputStyle.Short)
                    .setRequired(true).setMaxLength(2).setPlaceholder('4')));
            await interaction.showModal(modal);
            return true;
        }
        if (screens.has(action)) state.screen = action;
        else if (action === 'available') state.own = 'Available';
        else if (action === 'unavailable') state.own = 'Not this week';
        else if (action === 'opponent') state.other = state.other === 'Available' ? 'Not this week' : 'Available';
        else if (action === 'reset') Object.assign(state, { own: null, other: null, revealed: false, holiday: null });
        else if (action === 'agree') state.extension = 'Approved in this demo · Wednesday 20:00';
        else if (action === 'decline') state.extension = 'Could not agree · Admin review needed. No win awarded.';
        else if (action === 'review') state.extension = 'Sent to the sample admin queue · Original deadline still applies.';
        else if (action === 'history') state.history = !state.history;
        else if (action === 'approve') state.admin = 'Demo decision: +3 days approved. No real fixture changed.';
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
