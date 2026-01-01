import { SlashCommandBuilder, MessageFlags } from "discord.js";
import { DomainError } from "../../utils/DomainError.js";

/**
 * Discord slash command: /standingspublish
 * Admin-only command to publish division standings in the current channel.
 * Creates one message per division that can be automatically refreshed when results change.
 * @module commands/standingspublish
 */

export const data = new SlashCommandBuilder()
    .setName("standingspublish")
    .setDescription(
        "[ADMIN] Publish standings to this channel and keep them updated"
    );

/**
 * Execute the /standingspublish command.
 * Validates admin permissions and publishes standings embeds for all divisions.
 * @param {Object} interaction - Discord ChatInputCommandInteraction object.
 * @returns {Promise<void>}
 * @throws {DomainError} If no season, invalid state, or bad channel.
 */
export async function execute(interaction) {
    const cfg = interaction.client.services.config;
    const isAdmin =
        (cfg.adminUserId && interaction.user.id === cfg.adminUserId) ||
        (cfg.adminRoleId &&
            interaction.member?.roles?.cache?.has(cfg.adminRoleId));

    if (!isAdmin) {
        await interaction.reply({
            content: "❌ You don’t have permission to do that.",
            flags: MessageFlags.Ephemeral,
        });
        return;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
        const { season } =
            await interaction.client.services.standingsPublisher.publish({
                client: interaction.client,
                guildId: interaction.guildId,
                channelId: interaction.channelId,
            });

        await interaction.editReply(
            `✅ Published standings for **${season.name}** in this channel.`
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
