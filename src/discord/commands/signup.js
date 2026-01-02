import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from "discord.js";

/**
 * Discord slash command: /signup
 * Allows players to sign up for the current season with their 3-dart average.
 * @module commands/signup
 */

export const data = new SlashCommandBuilder()
    .setName("signup")
    .setDescription("Sign up for the current season")
    .addNumberOption((o) =>
        o.setName("avg").setDescription("Your 3-dart average").setRequired(true)
    );

/**
 * Execute the /signup command.
 * Validates channel restrictions, creates/updates signup, and refreshes published signups.
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

    const avg = interaction.options.getNumber("avg", true);

    const { season, signup, isUpdate, previousAvg } =
        await interaction.client.services.signups.signup({
            guildId: interaction.guildId,
            discordUserId: interaction.user.id,
            displayName:
                interaction.member?.displayName ?? interaction.user.username,
            avg,
        });

    const avatarUrl = interaction.user.displayAvatarURL({ size: 256 });

    const embed = new EmbedBuilder()
        .setTitle(isUpdate ? "🔁 Signup Updated" : "✅ Signup Confirmed")
        .setDescription(`**${season.name}**`)
        .setColor(isUpdate ? 0xf59e0b : 0x57f287)
        .setThumbnail(avatarUrl)
        .addFields(
            {
                name: "Player",
                value: `<@${interaction.user.id}>`,
                inline: true,
            },
            {
                name: "3-Dart Average",
                value: `**${signup.avg_3dart}**`,
                inline: true,
            }
        )
        .setTimestamp();

    if (isUpdate) {
        embed.addFields({
            name: "Previous Average",
            value: `**${previousAvg}** → **${signup.avg_3dart}**`,
            inline: false,
        });
    }

    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });

    // Keep the published signup list updated
    await interaction.client.services.signupsPublisher
        .refresh({ client: interaction.client, guildId: interaction.guildId })
        .catch((err) =>
            console.error("Failed to refresh published signups:", err)
        );
}
