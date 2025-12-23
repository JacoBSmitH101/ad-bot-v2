import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from "discord.js";
import { DomainError } from "../../utils/DomainError.js";

/**
 * Discord slash command: /mymatches
 * Displays all matches for the current user in the current season, grouped by week.
 * Shows match status (scheduled, reported, confirmed) and opponent information.
 * @module commands/mymatches
 */

export const data = new SlashCommandBuilder()
    .setName("mymatches")
    .setDescription("Show your matches for the current season");

/**
 * Execute the /mymatches command.
 * Fetches and displays the user's matches grouped by week with status indicators.
 * @param {Object} interaction - Discord ChatInputCommandInteraction object.
 * @returns {Promise<void>}
 * @throws {DomainError} If no season or invalid season state.
 */
export async function execute(interaction) {
    try {
        const { season, weeks, next } =
            await interaction.client.services.matches.getMyMatches({
                guildId: interaction.guildId,
                discordUserId: interaction.user.id,
            });

        const embed = new EmbedBuilder()
            .setTitle(`🎯 My Matches — ${season.name}`)
            .setDescription(
                "🗓️ scheduled • 🟠 reported (pending) • 🟢 confirmed\n"
            )
            .setTimestamp();

        if (weeks.length === 0) {
            embed.addFields({
                name: "No matches",
                value: "No fixtures found for you yet.",
                inline: false,
            });
        } else {
            for (const w of weeks) {
                embed.addFields({
                    name: `Week ${w.week}`,
                    value: w.lines.join("\n"),
                    inline: false,
                });
            }
        }

        await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    } catch (err) {
        if (err instanceof DomainError) {
            await interaction.reply({
                content: `❌ ${err.message}`,
                flags: MessageFlags.Ephemeral,
            });
            return;
        }
        console.error(err);
        await interaction.reply({
            content: "❌ Something went wrong.",
            flags: MessageFlags.Ephemeral,
        });
    }
}
