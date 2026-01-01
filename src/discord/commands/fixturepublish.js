import {
    SlashCommandBuilder,
    PermissionFlagsBits,
    MessageFlags,
} from "discord.js";
import { DomainError } from "../../utils/DomainError.js";

/**
 * Discord slash command: /fixturespublish
 * Admin-only command to publish weekly fixtures in the current channel.
 * Creates an embed showing scheduled matches for a specific week, which can be refreshed later.
 * @module commands/fixturepublish
 */

export const data = new SlashCommandBuilder()
    .setName("fixturespublish")
    .setDescription("[ADMIN] Publish weekly fixtures message in this channel")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addIntegerOption((opt) =>
        opt
            .setName("week")
            .setDescription(
                "Week number to display (defaults to current_week or 1)"
            )
            .setRequired(false)
    );

/**
 * Execute the /fixturespublish command.
 * Validates admin permissions, publishes fixtures embed, and stores channel/message references.
 * @param {Object} interaction - Discord ChatInputCommandInteraction object.
 * @returns {Promise<void>}
 * @throws {DomainError} If no season, invalid state, bad channel, or invalid week.
 */
export async function execute(interaction) {
    const cfg = interaction.client.services.config;
    const isAdmin =
        (cfg.adminUserId && interaction.user.id === cfg.adminUserId) ||
        (cfg.adminRoleId &&
            interaction.member?.roles?.cache?.has(cfg.adminRoleId));

    if (!isAdmin) {
        await interaction.reply({
            content: "❌ You don’t have permission.",
            flags: MessageFlags.Ephemeral,
        });
        return;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
        const week = interaction.options.getInteger("week");
        const res = await interaction.client.services.fixturesPublisher.publish(
            {
                client: interaction.client,
                guildId: interaction.guildId,
                channelId: interaction.channelId,
                week,
            }
        );

        await interaction.editReply(
            `✅ Published fixtures for **${res.season.name}** (Week **${res.week}**) in this channel.`
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
