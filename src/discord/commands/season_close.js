import {
    SlashCommandBuilder,
    EmbedBuilder,
    MessageFlags,
    PermissionFlagsBits,
} from "discord.js";
import { DomainError } from "../../utils/DomainError.js";

/**
 * Discord slash command: /season-close
 * Admin-only command to close the current season, locking it from further changes.
 * Refreshes standings and fixtures after closing.
 * @module commands/season_close
 */

export const data = new SlashCommandBuilder()
    .setName("season-close")
    .setDescription("[ADMIN] Close the current season (locks it)")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);

/**
 * Execute the /season-close command.
 * Closes the season and refreshes published messages.
 * @param {Object} interaction - Discord ChatInputCommandInteraction object.
 * @returns {Promise<void>}
 * @throws {DomainError} If no season, invalid state, or close fails.
 */
export async function execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
        const season = await interaction.client.services.seasons.closeSeason({
            guildId: interaction.guildId,
        });

        const embed = new EmbedBuilder()
            .setTitle("🔒 Season closed")
            .setDescription(`Season **${season.name}** is now **closed**.`)
            .addFields({
                name: "Status",
                value: `**${season.status}**`,
                inline: true,
            })
            .setTimestamp();

        await interaction.editReply({ embeds: [embed] });

        // optional: refresh published messages once on close
        await interaction.client.services.standingsPublisher?.refresh?.({
            client: interaction.client,
            guildId: interaction.guildId,
        });
        await interaction.client.services.fixturesPublisher?.refresh?.({
            client: interaction.client,
            guildId: interaction.guildId,
        });
    } catch (err) {
        if (err instanceof DomainError) {
            await interaction.editReply(`❌ ${err.message}`);
            return;
        }
        console.error(err);
        await interaction.editReply("❌ Something went wrong.");
    }
}
