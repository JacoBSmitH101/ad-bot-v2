import {
    SlashCommandBuilder,
    EmbedBuilder,
    MessageFlags,
    PermissionFlagsBits,
} from "discord.js";
import { DomainError } from "../../utils/DomainError.js";

/**
 * Discord slash command: /admin-opponent-stats
 * Admin-only command to view head-to-head statistics between any two players.
 * @module commands/admin-opponent-stats
 */

export const data = new SlashCommandBuilder()
    .setName("admin-opponent-stats")
    .setDescription("[ADMIN] View head-to-head stats between any two players")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addUserOption((opt) =>
        opt
            .setName("player1")
            .setDescription("First player")
            .setRequired(true)
    )
    .addUserOption((opt) =>
        opt
            .setName("player2")
            .setDescription("Second player")
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
 * Execute the /admin-opponent-stats command.
 * @param {Object} interaction - Discord ChatInputCommandInteraction object.
 * @returns {Promise<void>}
 */
export async function execute(interaction) {
    const cfg = interaction.client.services.config;
    const isAdmin =
        (cfg.adminUserId && interaction.user.id === cfg.adminUserId) ||
        (cfg.adminRoleId &&
            interaction.member?.roles?.cache?.has(cfg.adminRoleId));

    if (!isAdmin) {
        await interaction.reply({
            content: "❌ You don't have permission.",
            flags: MessageFlags.Ephemeral,
        });
        return;
    }

    const player1 = interaction.options.getUser("player1", true);
    const player2 = interaction.options.getUser("player2", true);

    if (player1.id === player2.id) {
        await interaction.reply({
            content: "❌ Players must be different.",
            flags: MessageFlags.Ephemeral,
        });
        return;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
        const { record, playerAStats, playerBStats } =
            await interaction.client.services.playerStats.getHeadToHead({
                guildId: interaction.guildId,
                playerAId: player1.id,
                playerBId: player2.id,
            });

        const player1Stats = playerAStats;
        const player2Stats = playerBStats;

        const player1DisplayName =
            player1.displayName ?? player1.username ?? player1.id;
        const player2DisplayName =
            player2.displayName ?? player2.username ?? player2.id;

        const { season, stats: player1SeasonStats } =
            await interaction.client.services.playerStats.getCurrentSeasonStats({
                guildId: interaction.guildId,
                discordUserId: player1.id,
            }).catch(() => ({ season: null, stats: null }));

        const { stats: player2SeasonStats } =
            await interaction.client.services.playerStats.getCurrentSeasonStats({
                guildId: interaction.guildId,
                discordUserId: player2.id,
            }).catch(() => ({ stats: null }));

        const embed = new EmbedBuilder()
            .setTitle(
                `⚔️ Head-to-Head — ${player1DisplayName} vs ${player2DisplayName}`
            )
            .setColor(0xef4444)
            .setTimestamp();

        // Head-to-head record (from player1's perspective)
        const totalH2H = record.wins + record.losses;
        const h2hWinRate =
            totalH2H > 0 ? ((record.wins / totalH2H) * 100).toFixed(1) : "0.0";
        embed.addFields({
            name: "📊 Head-to-Head Record",
            value: [
                `**Matches:** ${totalH2H} played`,
                `**${player1DisplayName}:** ${record.wins}W - ${record.losses}L (${h2hWinRate}% win rate)`,
                `**${player2DisplayName}:** ${record.losses}W - ${record.wins}L (${(100 - parseFloat(h2hWinRate)).toFixed(1)}% win rate)`,
                `**Legs:** ${record.legsFor} - ${record.legsAgainst} (${player1DisplayName} advantage)`,
            ].join("\n"),
            inline: false,
        });

        // Player 1 stats
        const player1WinRate =
            player1Stats.played > 0
                ? ((player1Stats.wins / player1Stats.played) * 100).toFixed(1)
                : "0.0";
        embed.addFields({
            name: `🎯 ${player1DisplayName} — Overall`,
            value: [
                `**Record:** ${player1Stats.wins}W - ${player1Stats.losses}L (${player1WinRate}% win rate)`,
                `**Matches:** ${player1Stats.played} played`,
                `**Legs:** ${player1Stats.legsFor} for, ${player1Stats.legsAgainst} against`,
                player1Stats.average
                    ? `**Average:** ${formatStat(player1Stats.average)}`
                    : null,
            ]
                .filter(Boolean)
                .join("\n"),
            inline: true,
        });

        // Player 2 stats
        const player2WinRate =
            player2Stats.played > 0
                ? ((player2Stats.wins / player2Stats.played) * 100).toFixed(1)
                : "0.0";
        embed.addFields({
            name: `🎯 ${player2DisplayName} — Overall`,
            value: [
                `**Record:** ${player2Stats.wins}W - ${player2Stats.losses}L (${player2WinRate}% win rate)`,
                `**Matches:** ${player2Stats.played} played`,
                `**Legs:** ${player2Stats.legsFor} for, ${player2Stats.legsAgainst} against`,
                player2Stats.average
                    ? `**Average:** ${formatStat(player2Stats.average)}`
                    : null,
            ]
                .filter(Boolean)
                .join("\n"),
            inline: true,
        });

        // Current season comparison
        if (season && player1SeasonStats && player2SeasonStats) {
            const player1SeasonWinRate =
                player1SeasonStats.played > 0
                    ? (
                          (player1SeasonStats.wins /
                              player1SeasonStats.played) *
                          100
                      ).toFixed(1)
                    : "0.0";
            const player2SeasonWinRate =
                player2SeasonStats.played > 0
                    ? (
                          (player2SeasonStats.wins /
                              player2SeasonStats.played) *
                          100
                      ).toFixed(1)
                    : "0.0";

            embed.addFields({
                name: `📅 Current Season: ${season.name}`,
                value: [
                    `**${player1DisplayName}:** ${player1SeasonStats.wins}W - ${player1SeasonStats.losses}L (${player1SeasonWinRate}%)`,
                    `**${player2DisplayName}:** ${player2SeasonStats.wins}W - ${player2SeasonStats.losses}L (${player2SeasonWinRate}%)`,
                ].join("\n"),
                inline: false,
            });
        }

        // Recent head-to-head matches
        if (record.recentMatches.length > 0) {
            const recentLines = record.recentMatches.slice(0, 5).map((m) => {
                const result = m.won ? "✅" : "❌";
                return `${result} **${m.playerLegs}-${m.opponentLegs}** (Week ${m.week})`;
            });

            embed.addFields({
                name: "📋 Recent Matches",
                value: recentLines.join("\n"),
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
