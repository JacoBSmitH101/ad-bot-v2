import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from "discord.js";
import { DomainError } from "../../utils/DomainError.js";

/**
 * Discord slash command: /mystats
 * Displays personal statistics dashboard for the current user.
 * Shows overall stats, current season stats, recent matches, and personal bests.
 * @module commands/mystats
 */

export const data = new SlashCommandBuilder()
    .setName("mystats")
    .setDescription("View your personal statistics dashboard");

/**
 * Format a stat value for display.
 * @private
 * @param {number|null} value
 * @param {string} format - "decimal", "percent", "integer"
 * @returns {string}
 */
function formatStat(value, format = "decimal") {
    if (value == null) return "N/A";
    if (format === "percent") return `${value.toFixed(1)}%`;
    if (format === "integer") return value.toString();
    return value.toFixed(1);
}

/**
 * Execute the /mystats command.
 * @param {Object} interaction - Discord ChatInputCommandInteraction object.
 * @returns {Promise<void>}
 */
export async function execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
        const { stats: overallStats, recentMatches } =
            await interaction.client.services.playerStats.getOverallStats({
                guildId: interaction.guildId,
                discordUserId: interaction.user.id,
            });

        const { season, stats: seasonStats } =
            await interaction.client.services.playerStats.getCurrentSeasonStats({
                guildId: interaction.guildId,
                discordUserId: interaction.user.id,
            }).catch(() => ({ season: null, stats: null }));

        const embed = new EmbedBuilder()
            .setTitle(`📊 Statistics — ${interaction.user.displayName ?? interaction.user.username}`)
            .setColor(0x5865f2)
            .setTimestamp();

        // Overall stats
        const winRate =
            overallStats.played > 0
                ? ((overallStats.wins / overallStats.played) * 100).toFixed(1)
                : "0.0";
        embed.addFields({
            name: "🎯 Overall Stats (Since Season 6)",
            value: [
                `**Matches:** ${overallStats.played} played`,
                `**Record:** ${overallStats.wins}W - ${overallStats.losses}L (${winRate}% win rate)`,
                `**Legs:** ${overallStats.legsFor} for, ${overallStats.legsAgainst} against (${overallStats.legDiff > 0 ? "+" : ""}${overallStats.legDiff} diff)`,
                `**Points:** ${overallStats.points}`,
                overallStats.average
                    ? `**Average:** ${formatStat(overallStats.average)}`
                    : null,
                overallStats.checkoutPercent
                    ? `**Checkout %:** ${formatStat(overallStats.checkoutPercent, "percent")}`
                    : null,
                overallStats.highestCheckout
                    ? `**Highest Checkout:** ${overallStats.highestCheckout}`
                    : null,
            ]
                .filter(Boolean)
                .join("\n"),
            inline: false,
        });

        // Current season stats
        if (season && seasonStats) {
            const seasonWinRate =
                seasonStats.played > 0
                    ? ((seasonStats.wins / seasonStats.played) * 100).toFixed(1)
                    : "0.0";
            embed.addFields({
                name: `📅 Current Season: ${season.name}`,
                value: [
                    `**Matches:** ${seasonStats.played} played`,
                    `**Record:** ${seasonStats.wins}W - ${seasonStats.losses}L (${seasonWinRate}% win rate)`,
                    `**Legs:** ${seasonStats.legsFor} for, ${seasonStats.legsAgainst} against (${seasonStats.legDiff > 0 ? "+" : ""}${seasonStats.legDiff} diff)`,
                    `**Points:** ${seasonStats.points}`,
                    seasonStats.average
                        ? `**Average:** ${formatStat(seasonStats.average)}`
                        : null,
                    seasonStats.checkoutPercent
                        ? `**Checkout %:** ${formatStat(seasonStats.checkoutPercent, "percent")}`
                        : null,
                ]
                    .filter(Boolean)
                    .join("\n"),
                inline: false,
            });
        }

        // Recent matches
        if (recentMatches.length > 0) {
            const recentLines = recentMatches.slice(0, 5).map((m) => {
                const result = m.won ? "✅" : "❌";
                const opponent = m.opponentId.startsWith("FAKE_")
                    ? `\`${m.opponentId}\``
                    : `<@${m.opponentId}>`;
                return `${result} vs ${opponent}: **${m.playerLegs}-${m.opponentLegs}**`;
            });

            embed.addFields({
                name: "📋 Recent Matches",
                value: recentLines.join("\n") || "No recent matches",
                inline: false,
            });
        }

        await interaction.editReply({ embeds: [embed] });
    } catch (err) {
        if (err instanceof DomainError) {
            await interaction.editReply(`❌ ${err.message}`);
            return;
        }
        console.error(err);
        await interaction.editReply("❌ Something went wrong.");
    }
}
