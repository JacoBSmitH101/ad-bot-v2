import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import { liveAvailabilityMessage } from '../handlers/availabilityViews.js';

export const data = new SlashCommandBuilder().setName('availability').setDescription('Answer for your real league match, including if your DMs are closed')
    .setDMPermission(false).addIntegerOption(option => option.setName('week').setDescription('Fixture week; defaults to the published week').setMinValue(1));
export async function execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const service = interaction.client.services.availability;
    service.requireEnabled();
    const season = await interaction.client.repos.seasons.getCurrentForGuild(interaction.guildId);
    if (!season) return interaction.editReply('No season found.');
    const week = interaction.options.getInteger('week') ?? season.fixtures_week ?? season.current_week ?? 1;
    const states = await service.availability.list(interaction.guildId, season.id, week, interaction.user.id);
    if (!states.length) return interaction.editReply('No availability card for this week yet. You may have a bye, or the fixtures have not been released.');
    for (let i = 0; i < states.length; i++) {
        const context = await service.context(states[i].match_id, interaction.user.id, false, interaction.guildId);
        const message = liveAvailabilityMessage(context, interaction.user.id);
        if (i === 0) await interaction.editReply(message);
        else await interaction.followUp({ ...message, flags: message.flags | MessageFlags.Ephemeral });
    }
}
