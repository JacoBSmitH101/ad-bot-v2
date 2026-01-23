import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from "discord.js";
import { DomainError } from "../../utils/DomainError.js";

/**
 * Discord slash command: /opponent-stats
 * View opponent statistics and head-to-head record.
 * Shows opponent's current season stats, overall stats, and your record against them.
 * @module commands/opponent-stats
 */

export const data = new SlashCommandBuilder()
    .setName("opponent-stats")
    .setDescription("View opponent statistics and head-to-head record")
    .addUserOption((opt) =>
        opt
            .setName("opponent")
            .setDescription("Opponent to scout")
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
    const opponent = interaction.options.getUser("opponent", true);

    if (opponent.id === interaction.user.id) {
        await interaction.reply({
            content: "❌ You can't scout yourself! Use `/mystats` instead.",
            flags: MessageFlags.Ephemeral,
        });
        return;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
        const { record, playerAStats, playerBStats } =
            await interaction.client.services.playerStats.getHeadToHead({
                guildId: interaction.guildId,
                playerAId: interaction.user.id,
                playerBId: opponent.id,
            });

        // Determine which stats are for the opponent
        // The record is calculated from the user's perspective (playerAId = user)
        // So playerAStats is the user's stats, playerBStats is the opponent's stats
        const opponentStats = playerBStats;

        const { season, stats: opponentSeasonStats } =
            await interaction.client.services.playerStats.getCurrentSeasonStats({
                guildId: interaction.guildId,
                discordUserId: opponent.id,
            }).catch(() => ({ season: null, stats: null }));

        const opponentDisplayName =
            opponent.displayName ?? opponent.username ?? opponent.id;

        const embed = new EmbedBuilder()
            .setTitle(`🔍 Opponent Scouting — ${opponentDisplayName}`)
            .setColor(0xf59e0b)
            .setThumbnail(opponent.displayAvatarURL())
            .setTimestamp();

        // Head-to-head record
        const totalH2H = record.wins + record.losses;
        const h2hWinRate =
            totalH2H > 0 ? ((record.wins / totalH2H) * 100).toFixed(1) : "0.0";
        embed.addFields({
            name: "⚔️ Head-to-Head Record",
            value: [
                `**Matches:** ${totalH2H} played`,
                `**Your Record:** ${record.wins}W - ${record.losses}L (${h2hWinRate}% win rate)`,
                `**Legs:** ${record.legsFor} for, ${record.legsAgainst} against (${record.legsFor - record.legsAgainst > 0 ? "+" : ""}${record.legsFor - record.legsAgainst} diff)`,
            ].join("\n"),
            inline: false,
        });

        // Opponent's current season stats
        if (season && opponentSeasonStats) {
            const opponentWinRate =
                opponentSeasonStats.played > 0
                    ? (
                          (opponentSeasonStats.wins /
                              opponentSeasonStats.played) *
                          100
                      ).toFixed(1)
                    : "0.0";
            embed.addFields({
                name: `📅 ${opponentDisplayName}'s Current Season`,
                value: [
                    `**Matches:** ${opponentSeasonStats.played} played`,
                    `**Record:** ${opponentSeasonStats.wins}W - ${opponentSeasonStats.losses}L (${opponentWinRate}% win rate)`,
                    `**Legs:** ${opponentSeasonStats.legsFor} for, ${opponentSeasonStats.legsAgainst} against`,
                    `**Points:** ${opponentSeasonStats.points}`,
                    opponentSeasonStats.average
                        ? `**Average:** ${formatStat(opponentSeasonStats.average)}`
                        : null,
                    opponentSeasonStats.checkoutPercent
                        ? `**Checkout %:** ${formatStat(opponentSeasonStats.checkoutPercent, "percent")}`
                        : null,
                ]
                    .filter(Boolean)
                    .join("\n"),
                inline: false,
            });
        }

        // Opponent's overall stats
        const overallWinRate =
            opponentStats.played > 0
                ? ((opponentStats.wins / opponentStats.played) * 100).toFixed(1)
                : "0.0";
        embed.addFields({
            name: `🎯 ${opponentDisplayName}'s Overall Stats`,
            value: [
                `**Matches:** ${opponentStats.played} played`,
                `**Record:** ${opponentStats.wins}W - ${opponentStats.losses}L (${overallWinRate}% win rate)`,
                `**Legs:** ${opponentStats.legsFor} for, ${opponentStats.legsAgainst} against`,
                opponentStats.average
                    ? `**Average:** ${formatStat(opponentStats.average)}`
                    : null,
                opponentStats.checkoutPercent
                    ? `**Checkout %:** ${formatStat(opponentStats.checkoutPercent, "percent")}`
                    : null,
            ]
                .filter(Boolean)
                .join("\n"),
            inline: false,
        });

        // Recent head-to-head matches
        if (record.recentMatches.length > 0) {
            const recentLines = record.recentMatches.slice(0, 5).map((m) => {
                const result = m.won ? "✅" : "❌";
                return `${result} **${m.playerLegs}-${m.opponentLegs}** (Week ${m.week})`;
            });

            embed.addFields({
                name: "📋 Recent Matches vs This Opponent",
                value: recentLines.join("\n") || "No recent matches",
                inline: false,
            });
        } else {
            embed.addFields({
                name: "📋 Recent Matches",
                value: "No head-to-head matches yet",
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
