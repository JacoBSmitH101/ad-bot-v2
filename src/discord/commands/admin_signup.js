import {
    SlashCommandBuilder,
    EmbedBuilder,
    MessageFlags,
    PermissionFlagsBits,
} from "discord.js";
import { DomainError } from "../../utils/DomainError.js";

/**
 * Discord slash command: /admin-signup
 * Admin-only command to sign up another user for the current season with their 3-dart average.
 * @module commands/admin_signup
 */

export const data = new SlashCommandBuilder()
    .setName("admin-signup")
    .setDescription("[ADMIN] Sign up another user for the current season")
    .addUserOption((opt) =>
        opt
            .setName("user")
            .setDescription("The user to sign up")
            .setRequired(true)
    )
    .addNumberOption((opt) =>
        opt
            .setName("avg")
            .setDescription("Their 3-dart average")
            .setRequired(true)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);

/**
 * Execute the /admin-signup command.
 * Validates admin permissions, creates/updates signup for the specified user, and refreshes published signups.
 * @param {Object} interaction - Discord ChatInputCommandInteraction object.
 * @returns {Promise<void>}
 */
export async function execute(interaction) {
    // Check if user is admin
    const cfg = interaction.client.services.config;
    const isAdmin =
        (cfg.adminUserId && interaction.user.id === cfg.adminUserId) ||
        (cfg.adminRoleId &&
            interaction.member?.roles?.cache?.has(cfg.adminRoleId));

    if (!isAdmin) {
        await interaction.reply({
            content: "❌ You don't have permission to do that.",
            flags: MessageFlags.Ephemeral,
        });
        return;
    }

    const targetUser = interaction.options.getUser("user", true);
    const avg = interaction.options.getNumber("avg", true);

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
        // Get the target user's member info for display name
        let targetDisplayName = targetUser.username;
        try {
            const targetMember =
                await interaction.guild.members.fetch(targetUser.id);
            targetDisplayName = targetMember?.displayName ?? targetUser.username;
        } catch (err) {
            // If fetch fails, just use username
            console.warn(
                `Could not fetch member info for ${targetUser.id}:`,
                err.message
            );
        }

        const { season, signup, isUpdate, previousAvg } =
            await interaction.client.services.signups.signup({
                guildId: interaction.guildId,
                discordUserId: targetUser.id,
                displayName: targetDisplayName,
                avg,
            });

        const avatarUrl = targetUser.displayAvatarURL({ size: 256 });

        const embed = new EmbedBuilder()
            .setTitle(isUpdate ? "🔁 Signup Updated (Admin)" : "✅ Signup Confirmed (Admin)")
            .setDescription(`**${season.name}**`)
            .setColor(isUpdate ? 0xf59e0b : 0x57f287)
            .setThumbnail(avatarUrl)
            .addFields(
                {
                    name: "Player",
                    value: `<@${targetUser.id}>`,
                    inline: true,
                },
                {
                    name: "3-Dart Average",
                    value: `**${signup.avg_3dart}**`,
                    inline: true,
                },
                {
                    name: "Signed up by",
                    value: `<@${interaction.user.id}>`,
                    inline: false,
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

        await interaction.editReply({ embeds: [embed] });

        // Keep the published signup list updated
        await interaction.client.services.signupsPublisher
            .refresh({ client: interaction.client, guildId: interaction.guildId })
            .catch((err) =>
                console.error("Failed to refresh published signups:", err)
            );
    } catch (err) {
        if (err instanceof DomainError) {
            await interaction.editReply(`❌ ${err.message}`);
            return;
        }
        console.error(err);
        await interaction.editReply("❌ Something went wrong.");
    }
}

