import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, MessageFlags, TextInputBuilder, TextInputStyle, escapeMarkdown } from 'discord.js';

export const AVAILABILITY_PREFIX = 'league-avail:';
export const londonDate = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
export const displayDate = day => new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(day + 'T00:00:00Z'));
const text = value => new TextDisplayBuilder().setContent(value);
const row = (...buttons) => new ActionRowBuilder().addComponents(...buttons);
const label = name => escapeMarkdown(String(name).slice(0, 80));
const response = value => value === 'available' ? 'Can play' : value === 'unavailable' ? 'Can’t play this week' : 'Not answered yet';
export function availabilitySide(state, userId) {
    if (state.player_a_id === userId) return 'a';
    if (state.player_b_id === userId) return 'b';
    return null;
}
export function availabilityDays(state, today = londonDate()) {
    const result = [];
    const start = new Date((today > state.released_on ? today : state.released_on) + 'T00:00:00Z');
    const end = new Date(state.effective_due_on + 'T00:00:00Z');
    for (let day = start; day <= end && result.length < 15; day.setUTCDate(day.getUTCDate() + 1)) result.push(day.toISOString().slice(0, 10));
    return result;
}
function button(state, action, name, style = ButtonStyle.Secondary, disabled = false) {
    return new ButtonBuilder().setCustomId(`${AVAILABILITY_PREFIX}${state.match_id}:${action}:${state.request_version}`)
        .setLabel(name).setStyle(style).setDisabled(disabled);
}
export function liveAvailabilityMessage(context, userId, { confirmation = false, today = londonDate() } = {}) {
    const { state, match, season, names = new Map() } = context;
    const own = availabilitySide(state, userId);
    if (!own) throw new Error('This is not your match.');
    const other = own === 'a' ? 'b' : 'a';
    const opponentId = own === 'a' ? state.player_b_id : state.player_a_id;
    const opponent = label(names.get(opponentId) ?? 'your opponent');
    const closed = season.status !== 'active' || match.status !== 'scheduled';
    const expired = today > state.effective_due_on;
    const card = new ContainerBuilder().setAccentColor(confirmation ? 0xfbbf24 : 0x22d3ee);
    card.addTextDisplayComponents(text(`## ${confirmation ? 'Ask for another week' : 'Your match this week'}\n${label(season.name)} · Week ${state.week}\nYou’re playing **${opponent}** (<@${opponentId}>).`));
    card.addTextDisplayComponents(text('**Play by**\n' + displayDate(state.effective_due_on)));
    if (confirmation) {
        card.addTextDisplayComponents(text('**Requested date**\n' + displayDate(addWeek(state.original_due_on)) + '\n\nYour opponent needs to agree. Keep the current date until it is approved.'));
        card.addActionRowComponents(row(button(state, 'request', 'Send request', ButtonStyle.Success, closed || state.extension_used || ['pending', 'review'].includes(state.extension_status))));
    } else {
        card.addSeparatorComponents(new SeparatorBuilder());
        card.addTextDisplayComponents(text(closed ? '### This match is no longer open for availability.' : expired ? '### The play-by date has passed. Contact an admin if you need help.'
            : state[own + '_response'] ? '### Answer saved: ' + response(state[own + '_response']).toLowerCase() : '### Can you play by this date?'));
        const yes = state[own + '_response'] === 'available', no = state[own + '_response'] === 'unavailable';
        card.addActionRowComponents(row(button(state, 'available', yes ? '✓ Yes, I can play' : 'Yes, I can play', yes ? ButtonStyle.Primary : ButtonStyle.Success, closed || expired || yes),
            button(state, 'unavailable', no ? '✓ No, I can’t play' : 'No, I can’t play', no ? ButtonStyle.Primary : ButtonStyle.Secondary, closed || expired || no),
            ...(yes ? [button(state, 'days', 'Edit my days', ButtonStyle.Secondary, closed || expired)] : [])));
        card.addTextDisplayComponents(text('**Your answer:** ' + response(state[own + '_response']) + '\n**Opponent’s answer:** ' + (state.revealed_at ? response(state[other + '_response']) : 'Hidden until you both answer')));
        const details = [];
        if (yes) details.push('**Your days:** ' + (state[own + '_days'].map(displayDate).join(', ') || 'Not chosen yet'));
        if (state[own + '_note']) details.push('**Your note:** ' + escapeMarkdown(state[own + '_note']));
        if (state.revealed_at && state[other + '_response'] === 'available') {
            details.push('**Opponent’s days:** ' + (state[other + '_days'].map(displayDate).join(', ') || 'Not chosen yet'));
            if (state[other + '_note']) details.push('**Opponent’s note:** ' + escapeMarkdown(state[other + '_note']));
            if (yes) details.push('**Next step:** Contact your opponent to agree a day and time.');
        }
        if (details.length) card.addTextDisplayComponents(text(details.join('\n\n')));
        if (state.extension_status === 'pending') {
            const requester = state.extension_requested_by === userId;
            card.addSeparatorComponents(new SeparatorBuilder());
            card.addTextDisplayComponents(text(requester ? '### Extra time requested\nWaiting for your opponent to agree. The current date still applies.'
                : `### Your opponent needs another week\n**Proposed date:** ${displayDate(state.extension_proposed_on)}\nIs this date okay for you?`));
            if (!requester) card.addActionRowComponents(row(button(state, 'agree', 'Yes, that’s fine', ButtonStyle.Success, closed), button(state, 'decline', 'No, ask an admin', ButtonStyle.Secondary, closed), button(state, 'help', 'Ask for help', ButtonStyle.Secondary, closed)));
        } else if (state.extension_status === 'review') card.addTextDisplayComponents(text('### Extra time needs admin review\nThe current play-by date still applies.'));
        else if (state.extension_status === 'approved') card.addTextDisplayComponents(text('### Extra week agreed\nPlay by ' + displayDate(state.effective_due_on)));
        else if (state.extension_status === 'declined') card.addTextDisplayComponents(text('**Admin decision:** Keep the original date.'));
        if (!closed && !state.extension_used && !['pending', 'review'].includes(state.extension_status) && today <= addWeek(state.original_due_on)) {
            card.addActionRowComponents(row(button(state, 'ask', state.extension_status === 'declined' ? 'Ask admin for extra time' : 'Ask for another week')));
        }
    }
    return { flags: MessageFlags.IsComponentsV2, components: [card], allowedMentions: { parse: [] } };
}
export function addWeek(day) { const date = new Date(day + 'T00:00:00Z'); date.setUTCDate(date.getUTCDate() + 7); return date.toISOString().slice(0, 10); }
export function liveAvailabilityForm(context, userId, available) {
    const state = context.state, side = availabilitySide(state, userId);
    if (!side) throw new Error('This is not your match.');
    const components = [];
    if (available) {
        const days = availabilityDays(state);
        if (!days.length) throw new Error('The play-by date has passed. Contact an admin.');
        for (let i = 0; i < days.length; i += 10) components.push({ type: 18, label: i ? 'More days' : 'Which days can you play?', description: 'Tick any days that suit you, or leave blank.',
            component: { type: 22, custom_id: 'days-' + i / 10, required: false, min_values: 0, max_values: Math.min(10, days.length - i),
                options: days.slice(i, i + 10).map(day => ({ value: day, label: displayDate(day), default: state[side + '_days'].includes(day) })) } });
    }
    const note = new TextInputBuilder().setCustomId('note').setStyle(TextInputStyle.Paragraph).setRequired(false).setMaxLength(300);
    const previous = state[side + '_response'] === (available ? 'available' : 'unavailable') ? state[side + '_note'] : '';
    if (previous) note.setValue(previous);
    components.push({ type: 18, label: available ? 'Anything else? (optional)' : 'Reason (optional)', component: note.toJSON() });
    return { custom_id: `${AVAILABILITY_PREFIX}${state.match_id}:${available ? 'submit-yes' : 'submit-no'}:${state.request_version}`,
        title: available ? 'When can you play?' : 'Not available this week', components };
}
