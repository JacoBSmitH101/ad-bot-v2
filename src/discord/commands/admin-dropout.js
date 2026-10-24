import { MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { DomainError } from '../../utils/DomainError.js';

export const data = new SlashCommandBuilder()
    .setName('admin-dropout')
    .setDescription('[ADMIN] Remove someone from the current season signup list')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .setDMPermission(false)
    .addUserOption(option => option.setName('user').setDescription('The player to remove from signups').setRequired(true));

export async function execute(interaction) {
    const config = interaction.client.services.config;
    const permitted = interaction.guildId && (
        (config.adminUserId && interaction.user.id === config.adminUserId) ||
        (config.adminRoleId && interaction.member?.roles?.cache?.has(config.adminRoleId)) ||
        interaction.memberPermissions?.has(PermissionFlagsBits.Administrator));
    if (!permitted) {
        await interaction.reply({ content: "You don't have permission to remove someone from signups.", flags: MessageFlags.Ephemeral });
        return;
    }
    const target = interaction.options.getUser('user', true);
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    let result;
    try {
        result = await interaction.client.services.signups.dropout({ guildId: interaction.guildId, discordUserId: target.id });
    } catch (error) {
        const message = error instanceof DomainError
            ? error.code === 'NOT_SIGNED_UP' ? 'That player is not signed up for the current season.'
                : error.code === 'SIGNUPS_NOT_OPEN' ? 'Signups must be open to remove a player from the signup list.' : error.message
            : 'The signup could not be removed. Please check the bot logs.';
        if (!(error instanceof DomainError)) console.error('Admin dropout failed:', error);
        await interaction.editReply({ content: message, allowedMentions: { parse: [] } });
        return;
    }
    console.log(`[ADMIN DROPOUT] ${interaction.user.id} removed ${target.id} from ${result.season.id} (previous avg: ${result.previousAvg})`);
    const success = `Removed <@${target.id}> from **${result.season.name}** signups.`;
    await interaction.editReply({ content: success, allowedMentions: { parse: [] } });
    try {
        await interaction.client.services.signupsPublisher.refresh({ client: interaction.client, guildId: interaction.guildId });
    } catch (error) {
        console.error('Signup removed, but the published signup list could not refresh:', error);
        await interaction.editReply({ content: success + '\nThe published list could not refresh. Run /signups publish to update it.', allowedMentions: { parse: [] } });
    }
}
