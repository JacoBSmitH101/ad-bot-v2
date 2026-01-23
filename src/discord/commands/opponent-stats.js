import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from "discord.js";
import { DomainError } from "../../utils/DomainError.js";

/**
 * Discord slash command: /opponent-stats
 * View another player's statistics in the same format as /mystats.
 * Takes one player and shows their overall stats, current season, and recent matches.
 * @module commands/opponent-stats
 */

export const data = new SlashCommandBuilder()
    .setName("opponent-stats")
    .setDescription("View another player's statistics")
    .addUserOption((opt) =>
        opt
            .setName("player")
            .setDescription("Player to view stats for")
            .setRequired(true)
    );

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
 * Execute the /opponent-stats command.
 * @param {Object} interaction - Discord ChatInputCommandInteraction object.
 * @returns {Promise<void>}
 */
export async function execute(interaction) {
    const player = interaction.options.getUser("player", true);

    if (player.id === interaction.user.id) {
        await interaction.reply({
            content: "❌ Use `/mystats` to view your own stats.",
            flags: MessageFlags.Ephemeral,
        });
        return;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
        const { stats: overallStats, recentMatches } =
            await interaction.client.services.playerStats.getOverallStats({
                guildId: interaction.guildId,
                discordUserId: player.id,
            });

        const { season, stats: seasonStats } =
            await interaction.client.services.playerStats.getCurrentSeasonStats({
                guildId: interaction.guildId,
                discordUserId: player.id,
            }).catch(() => ({ season: null, stats: null }));

        const displayName = player.displayName ?? player.username ?? player.id;

        const embed = new EmbedBuilder()
            .setTitle(`📊 Statistics — ${displayName}`)
            .setColor(0x5865f2)
            .setThumbnail(player.displayAvatarURL())
            .setTimestamp();

        // Overall stats (same format as mystats)
        const winRate =
            overallStats.played > 0
                ? ((overallStats.wins / overallStats.played) * 100).toFixed(1)
                : "0.0";
        embed.addFields({
            name: "🎯 Overall Stats (All Seasons)",
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

        // Current season stats (same format as mystats)
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

        // Recent matches (same format as mystats)
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
