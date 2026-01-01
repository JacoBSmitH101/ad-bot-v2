import {
    SlashCommandBuilder,
    EmbedBuilder,
    MessageFlags,
    PermissionFlagsBits,
} from "discord.js";
import { DomainError } from "../../utils/DomainError.js";

/**
 * Discord slash command: /autodarts-refresh
 * Admin-only command to force refresh the Autodarts access token via the internal API.
 * Used for troubleshooting authentication issues with the Autodarts integration.
 * @module commands/autodarts_refresh
 */

export const data = new SlashCommandBuilder()
    .setName("autodarts-refresh")
    .setDescription(
        "[ADMIN] Force refresh Autodarts access token via internal API"
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);

/**
 * Execute the /autodarts-refresh command.
 * Triggers a refresh of the Autodarts access token through the internal API.
 * @param {Object} interaction - Discord ChatInputCommandInteraction object.
 * @returns {Promise<void>}
 * @throws {DomainError} If the refresh fails.
 */
export async function execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
        const res =
            await interaction.client.services.internalApi.refreshAutodarts();

        const embed = new EmbedBuilder()
            .setTitle("🔄 Refresh triggered")
            .setDescription("Internal API refresh endpoint called.")
            .addFields({
                name: "Result",
                value: res?.ok === false ? "⚠️ ok=false" : "OK",
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
        await interaction.editReply("❌ Failed to trigger refresh.");
    }
}
