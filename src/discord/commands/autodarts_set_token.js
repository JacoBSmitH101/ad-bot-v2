// src/discord/commands/autodarts_set_token.js
import {
    SlashCommandBuilder,
    EmbedBuilder,
    MessageFlags,
    PermissionFlagsBits,
} from "discord.js";
import { DomainError } from "../../utils/DomainError.js";

export const data = new SlashCommandBuilder()
    .setName("autodarts-set-token")
    .setDescription(
        "[ADMIN] Set the Autodarts refresh token on the internal API"
    )
    .addStringOption((opt) =>
        opt
            .setName("refresh_token")
            .setDescription("Autodarts refresh token (kept private)")
            .setRequired(true)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);

export async function execute(interaction) {
    const refreshToken = interaction.options
        .getString("refresh_token", true)
        .trim();

    // Extra guard: never allow in public channels by accident (optional but recommended)
    // If you want to allow it anywhere, delete this block.
    if (interaction.channel && interaction.channel.isTextBased()) {
        // still allow, but we will reply ephemeral
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
        // Call internal API (bot never stores token, never logs token)
        const res =
            await interaction.client.services.internalApi.setRefreshToken(
                refreshToken
            );

        const embed = new EmbedBuilder()
            .setTitle("✅ Refresh token updated")
            .setDescription(
                "Internal API refresh token has been updated. You can now run `/autodarts-refresh` to test refresh."
            )
            .addFields({
                name: "API response",
                value:
                    res?.ok === false
                        ? "⚠️ Updated, but API returned ok=false"
                        : "OK",
                inline: true,
            })
            .setTimestamp();

        await interaction.editReply({ embeds: [embed] });
    } catch (err) {
        if (err instanceof DomainError) {
            await interaction.editReply(`❌ ${err.message}`);
            return;
        }
        console.error(err);
        await interaction.editReply("❌ Failed to set refresh token.");
    }
}
