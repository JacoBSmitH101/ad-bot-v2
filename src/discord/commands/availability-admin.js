import { SlashCommandBuilder, MessageFlags, PermissionFlagsBits, escapeMarkdown } from 'discord.js';

export const data = new SlashCommandBuilder().setName('availability-admin').setDescription('[ADMIN] Review availability, extra-time requests and failed DMs')
    .setDMPermission(false).setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addStringOption(option => option.setName('action').setDescription('What to do').setRequired(true).addChoices(
        { name: 'Show weekly status', value: 'status' }, { name: 'Approve extra week', value: 'approve' },
        { name: 'Keep original date', value: 'keep' }, { name: 'Retry or update DMs', value: 'retry' }, { name: 'View match history', value: 'history' }))
    .addIntegerOption(option => option.setName('week').setDescription('Defaults to the published week').setMinValue(1))
    .addStringOption(option => option.setName('match').setDescription('Match ID, required for approve, keep or history'));
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
    if (action === 'retry') {
        let failures = 0;
        for (const state of states) failures += (await service.syncMatch(interaction.client, state.match_id, true)).failures;
        return interaction.editReply(`DM update/retry finished. ${failures} delivery problem(s) remain. Players with closed DMs can use /availability.`);
    }
    const messages = await service.availability.messages(states.map(state => state.match_id));
    const lines = states.map(state => {
        const failures = messages.filter(message => message.match_id === state.match_id && message.status === 'failed');
        return `**${state.match_id}**\n<@${state.player_a_id}>: ${state.a_response ?? 'waiting'} · <@${state.player_b_id}>: ${state.b_response ?? 'waiting'}\nPlay by ${state.effective_due_on} · Extra time: ${state.extension_status}` +
            (state.a_note || state.b_note ? '\nNotes (admin only): ' + [state.a_note, state.b_note].map(note => escapeMarkdown(note.slice(0, 100)) || '—').join(' / ') : '') +
            (failures.length ? '\nFailed DMs: ' + failures.map(message => `<@${message.user_id}> (${message.last_error})`).join(', ') : '');
    });
    let content = `**Week ${week} availability — admin view**\n`;
    const chunks = [];
    for (const line of lines) { if (content.length + line.length > 1800) { chunks.push(content); content = ''; } content += line + '\n\n'; }
    if (content) chunks.push(content);
    for (let i = 0; i < chunks.length; i++) {
        const message = { content: chunks[i], allowedMentions: { parse: [] } };
        if (i === 0) await interaction.editReply(message); else await interaction.followUp({ ...message, flags: MessageFlags.Ephemeral });
    }
}
