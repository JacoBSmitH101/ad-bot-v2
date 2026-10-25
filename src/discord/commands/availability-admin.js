import { buildAvailabilityAdminModel, renderAvailabilityAdminImages, deliveryReason, availabilityOutcome } from '../../services/AvailabilityAdminImageRenderer.js';
import { SlashCommandBuilder, MessageFlags, PermissionFlagsBits, AttachmentBuilder, escapeMarkdown } from 'discord.js';

export const data = new SlashCommandBuilder().setName('availability-admin').setDescription('[ADMIN] Review availability, extra-time requests and failed DMs')
    .setDMPermission(false).setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addStringOption(option => option.setName('action').setDescription('What to do').setRequired(true).addChoices(
        { name: 'Show weekly status', value: 'status' }, { name: 'Approve extra week', value: 'approve' },
        { name: 'Keep original date', value: 'keep' }, { name: 'Retry failed or unsent DMs only', value: 'retry' }, { name: 'Refresh all existing match cards', value: 'refresh' }, { name: 'View match history', value: 'history' }))
    .addIntegerOption(option => option.setName('week').setDescription('Defaults to the published week').setMinValue(1))
    .addStringOption(option => option.setName('match').setDescription('Match ID, required for approve, keep or history'))
    .addStringOption(option => option.setName('view').setDescription('Status view; defaults to a graphic').addChoices({ name: 'Graphic', value: 'graphic' }, { name: 'Text', value: 'text' }));
function failedSummary(failed) {
    return failed.slice(0, 10).map(message => '<@' + message.user_id + '> — ' + deliveryReason(message.last_error) + ' (' + String(message.last_error ?? 'unknown').slice(0, 30) + ')').join('; ') +
        (failed.length > 10 ? '; and ' + (failed.length - 10) + ' more — see the graphic/details.' : '');
}
export async function execute(interaction) {
    const config = interaction.client.services.config;
    const permitted = interaction.guildId && ((config.adminUserId && config.adminUserId === interaction.user.id) ||
        (config.adminRoleId && interaction.member?.roles?.cache?.has(config.adminRoleId)) || interaction.memberPermissions?.has(PermissionFlagsBits.Administrator));
    if (!permitted) return interaction.reply({ content: 'Only league/server admins can use this command.', flags: MessageFlags.Ephemeral });
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const service = interaction.client.services.availability; service.requireEnabled();
    const action = interaction.options.getString('action', true), matchId = interaction.options.getString('match');
    if (['approve', 'keep', 'history'].includes(action)) {
        if (!matchId) return interaction.editReply('Select a match ID for that action. Use the status view to find it.');
        const context = await service.context(matchId, interaction.user.id, true, interaction.guildId);
        if (action === 'history') {
            const events = await service.availability.history(matchId);
            return interaction.editReply({ content: events.map(event => `${event.created_at} · ${event.action} · ${event.actor_id ?? 'bot'}`).join('\n').slice(0, 1900) || 'No recorded changes.', allowedMentions: { parse: [] } });
        }
        const result = await service.act({ client: interaction.client, matchId, userId: interaction.user.id, action, admin: true, guildId: interaction.guildId, payload: { requestVersion: context.state.request_version } });
        return interaction.editReply('Decision saved. Play by ' + result.state.effective_due_on + '. Both player DMs will update.');
    }
    const season = await interaction.client.repos.seasons.getCurrentForGuild(interaction.guildId);
    if (!season) return interaction.editReply('No season found.');
    const week = interaction.options.getInteger('week') ?? season.fixtures_week ?? season.current_week ?? 1;
    const states = await service.availability.list(interaction.guildId, season.id, week);
    if (!states.length) return interaction.editReply('No availability has been released for this week. Publish its fixtures after starting the season.');
    let messages = await service.availability.messages(states.map(state => state.match_id));
    if (action === 'retry' || action === 'refresh') {
        let attempted = 0;
        const problems = [];
        for (const state of states) {
            const recipients = [state.player_a_id, state.player_b_id].filter(user => !messages.some(message => message.match_id === state.match_id && message.user_id === user && message.status === 'sent'));
            if (action === 'retry' && !recipients.length) continue;
            try {
                const result = await service.syncMatch(interaction.client, state.match_id, action === 'refresh',
                    action === 'retry' ? { recipients, failedOnly: true } : {});
                attempted += result.attempted ?? 0;
            } catch (error) { problems.push(state.match_id + ': ' + error.message); }
        }
        messages = await service.availability.messages(states.map(state => state.match_id));
        const failed = messages.filter(message => message.status === 'failed');
        const pending = states.flatMap(state => [state.player_a_id, state.player_b_id].filter(user => !messages.some(message => message.match_id === state.match_id && message.user_id === user && ['sent', 'failed'].includes(message.status))));
        return interaction.editReply({ content: (action === 'retry' ? 'Failed/unsent DM retry finished. Successful DMs were left alone.' : 'Match-card refresh finished.') +
            '\n' + attempted + ' delivery attempt(s). ' + (failed.length ? 'Still failed: ' + failedSummary(failed) : 'No failed DMs remain.') +
            (pending.length ? '\n' + pending.length + ' delivery/ies are pending or already being processed.' : '') +
            (problems.length ? '\nSome matches could not be processed: ' + problems.join('; ').slice(0, 500) : '') + '\nPlayers can use /availability in the server.',
            allowedMentions: { parse: [] } });
    }
    const ids = [...new Set(states.flatMap(state => [state.player_a_id, state.player_b_id]))];
    const [players, matches, divisions] = await Promise.all([
        service.players.listByDiscordIds({ discordUserIds: ids }),
        service.availability.fixtureMetadata(season.id, week),
        interaction.client.repos.divisions.listBySeason(season.id),
    ]);
    const matchById = new Map(matches.map(match => [String(match.id), match]));
    const lines = states.map(state => {
        const outcome = availabilityOutcome(matchById.get(String(state.match_id)));
        const failures = messages.filter(message => message.match_id === state.match_id && message.status === 'failed');
        const days = side => state[side + '_days']?.length ? state[side + '_days'].join(', ') : 'not chosen';
        return '**' + state.match_id + '**' + (outcome.closed ? '\n' + outcome.label + (outcome.score ? ': ' + outcome.score.join('–') : '') : '') + '\n<@' + state.player_a_id + '>: ' + (state.a_response ?? 'waiting') + ' · <@' + state.player_b_id + '>: ' + (state.b_response ?? 'waiting') +
            '\nDays: ' + days('a') + ' / ' + days('b') + '\nPlay by ' + state.effective_due_on + ' · Extra time: ' + state.extension_status +
            (state.a_note || state.b_note ? '\nNotes (admin only): ' + [state.a_note, state.b_note].map(note => escapeMarkdown(note.slice(0, 300)) || '—').join(' / ') : '') +
            (failures.length ? '\nFailed DMs: ' + failures.map(message => '<@' + message.user_id + '> — ' + deliveryReason(message.last_error) + ' (' + message.last_error + ')').join(', ') : '');
    });
    const failed = messages.filter(message => message.status === 'failed');
    const failureSummary = failed.length ? '**Failed DMs (' + failed.length + '):** ' + failed.map(message => '<@' + message.user_id + '> — ' + deliveryReason(message.last_error) + ' (' + message.last_error + ')').join('; ') : 'No failed DMs recorded.';
    const view = interaction.options.getString('view') ?? 'graphic';
    if (view === 'text') {
        const chunks = [];
        let content = '**Week ' + week + ' availability — admin view**\n' + failureSummary + '\n\n';
        for (const block of lines) for (const line of block.split('\n')) { if (content.length + line.length > 1800) { chunks.push(content); content = ''; } content += line + '\n'; }
        if (content) chunks.push(content);
        for (let i = 0; i < chunks.length; i++) {
            const message = { content: chunks[i], allowedMentions: { parse: [] } };
            if (i === 0) await interaction.editReply(message); else await interaction.followUp({ ...message, flags: MessageFlags.Ephemeral });
        }
        return;
    }
    const model = buildAvailabilityAdminModel({ season, week, states, messages, matches, divisions, players });
    const images = await renderAvailabilityAdminImages(model);
    const nameById = new Map(players.map(player => [player.discord_user_id, player.display_name ?? player.discord_user_id]));
    const details = ['Week ' + week + ' availability — PRIVATE ADMIN VIEW', ...lines].join('\n\n')
        .replace(/<@(\d+)>/g, (_, id) => nameById.get(id) ?? id);
    const files = [...images.map((image, i) => new AttachmentBuilder(image.png, { name: 'availability-week-' + week + '-' + (i + 1) + '.png' })),
        new AttachmentBuilder(Buffer.from(details), { name: 'availability-details.txt' })];
    for (let i = 0; i < files.length; i += 10) {
        const message = { content: i === 0 ? '**Week ' + week + ' availability — admin view**\n' + failureSummary + '\nMatch IDs, full days and private notes are in the attached text file.' : 'Availability graphics continued.',
            files: files.slice(i, i + 10), allowedMentions: { parse: [] } };
        if (i === 0) await interaction.editReply(message); else await interaction.followUp({ ...message, flags: MessageFlags.Ephemeral });
    }
}
