import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from "discord.js";

/**
 * Discord slash command: /dropout
 * Allows players to unregister from the current season.
 * Only works when signups are open. Refreshes the published signup list automatically.
 * @module commands/dropout
 */

export const data = new SlashCommandBuilder()
    .setName("dropout")
    .setDescription(
        "Unregister from the current season (signups must be open)"
    );

/**
 * Execute the /dropout command.
 * Validates channel restrictions, removes the player's signup, and refreshes published signups.
 * @param {Object} interaction - Discord ChatInputCommandInteraction object.
 * @returns {Promise<void>}
 */
export async function execute(interaction) {
    const seasonConfig =
        await interaction.client.repos.seasons.getCurrentForGuild(
            interaction.guildId
        );

    // Check if user is admin
    const cfg = interaction.client.services.config;
    const isAdmin =
        (cfg.adminUserId && interaction.user.id === cfg.adminUserId) ||
        (cfg.adminRoleId &&
            interaction.member?.roles?.cache?.has(cfg.adminRoleId));

    // Enforce channel restriction only for non-admins
    if (
        !isAdmin &&
        seasonConfig?.signups_channel_id &&
        interaction.channelId !== seasonConfig.signups_channel_id
    ) {
        await interaction.reply({
            content: `❌ Please use this command in <#${seasonConfig.signups_channel_id}>.`,
            flags: MessageFlags.Ephemeral,
        });
        return;
    }

    const { season, previousAvg } =
        await interaction.client.services.signups.dropout({
            guildId: interaction.guildId,
            discordUserId: interaction.user.id,
        });

    const displayName =
        interaction.member?.displayName ?? interaction.user.username;
    console.log(
        `[DROPOUT] ${displayName} (${interaction.user.id}) dropped out of ${season.name} (avg: ${previousAvg})`
    );

    const avatarUrl = interaction.user.displayAvatarURL({ size: 256 });

    const embed = new EmbedBuilder()
        .setTitle("🗑️ Signup Removed")
        .setDescription(`You have been removed from **${season.name}**`)
        .setThumbnail(avatarUrl)
        //purple
        .setColor(0x800080)
        .addFields(
            {
                name: "Player",
                value: `<@${interaction.user.id}>`,
                inline: true,
            },
            {
                name: "Previous Average",
                value: `**${previousAvg}**`,
                inline: true,
            }
        )
        .setTimestamp();

    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });

    // keep the published signup list in sync
    await interaction.client.services.signupsPublisher
        .refresh({ client: interaction.client, guildId: interaction.guildId })
        .catch((err) =>
            console.error("Failed to refresh published signups:", err)
        );
}
