import {
    SlashCommandBuilder,
    PermissionFlagsBits,
    MessageFlags,
} from "discord.js";
import { DomainError } from "../../utils/DomainError.js";

/**
 * Discord slash command: /fixturesweek
 * Admin-only command to change which week the published fixtures message displays.
 * Updates the season's fixtures_week field and refreshes the message.
 * @module commands/fixturesweek
 */

export const data = new SlashCommandBuilder()
    .setName("fixturesweek")
    .setDescription("[ADMIN] Set which week the fixtures message shows")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addIntegerOption((opt) =>
        opt.setName("week").setDescription("Week number").setRequired(true)
    );

/**
 * Execute the /fixturesweek command.
 * Validates admin permissions and updates the displayed week for fixtures.
 * @param {Object} interaction - Discord ChatInputCommandInteraction object.
 * @returns {Promise<void>}
 * @throws {DomainError} If no season, invalid state, or invalid week.
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
        const week = interaction.options.getInteger("week", true);

        await interaction.client.services.fixturesPublisher.setWeek({
            client: interaction.client,
            guildId: interaction.guildId,
            week,
        });

        await interaction.editReply(
            `✅ Fixtures display updated to Week **${week}**.`
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
