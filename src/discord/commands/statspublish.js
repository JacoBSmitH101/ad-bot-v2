import { SlashCommandBuilder, MessageFlags } from "discord.js";
import { DomainError } from "../../utils/DomainError.js";

/**
 * Discord slash command: /statspublish
 * Admin-only command to publish stats leaders in the current channel.
 * Creates an image showing the top 5 players in each stat category and refreshes it when results change.
 * @module commands/statspublish
 */

export const data = new SlashCommandBuilder()
    .setName("statspublish")
    .setDescription(
        "[ADMIN] Publish stat leaders to this channel and keep them updated"
    );

/**
 * Execute the /statspublish command.
 * Validates admin permissions and publishes the stats leaders image.
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
            content: "❌ You don't have permission to do that.",
            flags: MessageFlags.Ephemeral,
        });
        return;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
        const { season } =
            await interaction.client.services.statsLeadersPublisher.publish({
                client: interaction.client,
                guildId: interaction.guildId,
                channelId: interaction.channelId,
            });

        await interaction.editReply(
            `✅ Published stat leaders for **${season.name}** in this channel.`
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
