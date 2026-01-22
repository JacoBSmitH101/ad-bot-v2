import { DomainError } from "../utils/DomainError.js";
import { EmbedBuilder } from "discord.js";
import { extractAutodartsMatchId } from "../utils/autodarts.js";
import { supabase } from "../db/supabase.js";

/**
 * Formats a player ID for display.
 * @private
 * @param {string} id
 * @param {Map<string, string>} [nameById]
 * @returns {string}
 */
function fmtPlayer(id, nameById) {
    if (id.startsWith("FAKE_")) return `\`${id}\``;
    if (nameById?.has(id)) return `\`${nameById.get(id)}\``;
    return `\`${id}\``;
}

function medal(i) {
    return i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : "•";
}

/**
 * Align match stats to find the correct player's stats using legs won.
 * @private
 * @param {{ matchStats: Array.<Object>, legsA: number, legsB: number, playerAId: string, playerBId: string, targetPlayerId: string }} params
 * @returns {(Object|null)} The stats for the target player, or null if not found
 */
function findPlayerStatsByLegsWon({
    matchStats,
    legsA,
    legsB,
    playerAId,
    playerBId,
    targetPlayerId,
}) {
    const ms0 = matchStats?.[0];
    const ms1 = matchStats?.[1];
    if (!ms0 || !ms1) return null;

    const w0 = Number(ms0.legsWon);
    const w1 = Number(ms1.legsWon);

    const a = Number(legsA);
    const b = Number(legsB);

    // Determine which player we're looking for
    const isPlayerA = targetPlayerId === playerAId;
    const targetLegs = isPlayerA ? a : b;

    // Try to match by legs won
    if (Number.isFinite(w0) && Number.isFinite(w1)) {
        // Check if w0 matches target player's legs
        if (w0 === targetLegs) {
            return ms0;
        }
        // Check if w1 matches target player's legs
        if (w1 === targetLegs) {
            return ms1;
        }

        // If we can match the other player, return the opposite stat
        const otherLegs = isPlayerA ? b : a;
        if (w0 === otherLegs) {
            // ms0 is the other player, so ms1 must be the target
            return ms1;
        }
        if (w1 === otherLegs) {
            // ms1 is the other player, so ms0 must be the target
            return ms0;
        }
    }

    // If we can't align by legs won, return null to avoid incorrect assignment
    return null;
}

/**
 * Service for publishing and refreshing stats leaders messages in Discord.
 * Manages Discord embed creation and message updates for season stat leaders.
 */
export class StatsLeadersPublisherService {
    /**
     * @param {{ seasons: SeasonRepository, matches: MatchRepository, players: PlayersRepository }} deps
     * @param {SeasonRepository} deps.seasons Season repository instance.
     * @param {MatchRepository} deps.matches Match repository instance.
     * @param {PlayersRepository} deps.players Players repository instance.
     */
    constructor({ seasons, matches, players }) {
        this.seasons = seasons;
        this.matches = matches;
        this.players = players;
    }

    /**
     * Get all player stats for a season.
     * Aggregates stats from all confirmed matches.
     * @private
     * @param {string|number} seasonId
     * @returns {Promise<Map<string, {average: number, checkoutPercent: number, highestCheckout: number, first9Average: number, matchCount: number}>>}
     */
    async getAllPlayerStats(seasonId) {
        const statsMap = new Map();

        // Get all confirmed matches for the season with results
        const matches = await this.matches.listConfirmedForSeasonWithResults(
            seasonId
        );

        if (!matches || matches.length === 0) return statsMap;

        // Get all unique player IDs
        const playerIds = new Set();
        for (const m of matches) {
            if (m.player_a_id && !m.player_a_id.startsWith("FAKE_")) {
                playerIds.add(m.player_a_id);
            }
            if (m.player_b_id && !m.player_b_id.startsWith("FAKE_")) {
                playerIds.add(m.player_b_id);
            }
        }

        // Initialize stats for all players
        for (const playerId of playerIds) {
            statsMap.set(playerId, {
                averages: [],
                checkoutPercents: [],
                highestCheckout: 0,
                first9Averages: [],
                matchCount: 0,
            });
        }

        // Process each match
        for (const match of matches) {
            const mrRaw = match.match_results;
            const mr = Array.isArray(mrRaw) ? mrRaw[0] : mrRaw;
            if (!mr?.proof_url) continue;

            const matchId = extractAutodartsMatchId(mr.proof_url);
            if (!matchId) continue;

            // Query public schema cache table
            const { data: cacheData, error: cacheError } = await supabase
                .from("autodarts_match_stats_cache")
                .select("stats")
                .eq("match_id", matchId)
                .maybeSingle();

            if (cacheError || !cacheData) continue;

            // Parse JSON stats
            const stats =
                typeof cacheData.stats === "string"
                    ? JSON.parse(cacheData.stats)
                    : cacheData.stats;

            const matchStats = stats?.matchStats || stats;
            if (!Array.isArray(matchStats) || matchStats.length < 2) continue;

            // Process stats for both players
            for (const playerId of [match.player_a_id, match.player_b_id]) {
                if (!playerId || playerId.startsWith("FAKE_")) continue;

                const playerStats = findPlayerStatsByLegsWon({
                    matchStats,
                    legsA: mr.legs_a,
                    legsB: mr.legs_b,
                    playerAId: match.player_a_id,
                    playerBId: match.player_b_id,
                    targetPlayerId: playerId,
                });

                if (!playerStats) continue;

                const playerData = statsMap.get(playerId);
                if (!playerData) continue;

                // Collect averages
                if (
                    playerStats.average != null &&
                    Number.isFinite(Number(playerStats.average))
                ) {
                    playerData.averages.push(Number(playerStats.average));
                }

                // Collect checkout percentages (convert from decimal to percent)
                if (
                    playerStats.checkoutPercent != null &&
                    Number.isFinite(Number(playerStats.checkoutPercent))
                ) {
                    playerData.checkoutPercents.push(
                        Number(playerStats.checkoutPercent) * 100
                    );
                }

                // Track highest checkout
                if (
                    playerStats.checkoutPoints != null &&
                    Number.isFinite(Number(playerStats.checkoutPoints))
                ) {
                    const checkout = Number(playerStats.checkoutPoints);
                    if (checkout > playerData.highestCheckout) {
                        playerData.highestCheckout = checkout;
                    }
                }

                // Collect first 9 averages
                if (
                    playerStats.first9Average != null &&
                    Number.isFinite(Number(playerStats.first9Average))
                ) {
                    playerData.first9Averages.push(
                        Number(playerStats.first9Average)
                    );
                }

                playerData.matchCount += 1;
            }
        }

        // Calculate aggregated stats
        const aggregated = new Map();
        for (const [playerId, data] of statsMap.entries()) {
            if (data.matchCount === 0) continue;

            const avg =
                data.averages.length > 0
                    ? data.averages.reduce((sum, a) => sum + a, 0) /
                      data.averages.length
                    : null;

            const checkoutPercent =
                data.checkoutPercents.length > 0
                    ? data.checkoutPercents.reduce((sum, c) => sum + c, 0) /
                      data.checkoutPercents.length
                    : null;

            const first9Avg =
                data.first9Averages.length > 0
                    ? data.first9Averages.reduce((sum, f) => sum + f, 0) /
                      data.first9Averages.length
                    : null;

            aggregated.set(playerId, {
                average: avg,
                checkoutPercent: checkoutPercent,
                highestCheckout:
                    data.highestCheckout > 0 ? data.highestCheckout : null,
                first9Average: first9Avg,
                matchCount: data.matchCount,
            });
        }

        return aggregated;
    }

    /**
     * Create (or recreate) stats leaders message in a channel and store its message ID.
     * @param {{ client: Client, guildId: string, channelId: string }} params
     * @returns {Promise<{season: Season, channelId: string, messageId: string}>}
     * @throws {DomainError} If no season, invalid state, or bad channel.
     */
    async publish({ client, guildId, channelId }) {
        const season = await this.seasons.getCurrentForGuild(guildId);
        if (!season) throw new DomainError("NO_SEASON", "No season found.");

        if (!["active", "closed"].includes(season.status)) {
            throw new DomainError(
                "INVALID_STATE",
                `Stats publish only available when season is active/closed (current: ${season.status})`
            );
        }

        const channel = await client.channels
            .fetch(channelId)
            .catch(() => null);
        if (!channel || !channel.isTextBased()) {
            throw new DomainError(
                "BAD_CHANNEL",
                "That channel is not a text channel."
            );
        }

        // Get all player stats
        const allStats = await this.getAllPlayerStats(season.id);

        // Fetch player names
        const playerIds = [...allStats.keys()];
        const nameById = new Map();
        if (playerIds.length > 0) {
            const players = await this.players.listByDiscordIds({
                discordUserIds: playerIds,
            });
            for (const p of players) {
                const name = p.display_name ?? p.discord_user_id;
                nameById.set(p.discord_user_id, name);
            }
        }

        // Build top 5 lists for each category
        const topAverage = [...allStats.entries()]
            .filter(([_, stats]) => stats.average != null)
            .sort(([_, a], [__, b]) => (b.average ?? 0) - (a.average ?? 0))
            .slice(0, 5);

        const topCheckoutPercent = [...allStats.entries()]
            .filter(([_, stats]) => stats.checkoutPercent != null)
            .sort(
                ([_, a], [__, b]) =>
                    (b.checkoutPercent ?? 0) - (a.checkoutPercent ?? 0)
            )
            .slice(0, 5);

        const topHighestCheckout = [...allStats.entries()]
            .filter(([_, stats]) => stats.highestCheckout != null)
            .sort(
                ([_, a], [__, b]) =>
                    (b.highestCheckout ?? 0) - (a.highestCheckout ?? 0)
            )
            .slice(0, 5);

        const topFirst9Average = [...allStats.entries()]
            .filter(([_, stats]) => stats.first9Average != null)
            .sort(
                ([_, a], [__, b]) =>
                    (b.first9Average ?? 0) - (a.first9Average ?? 0)
            )
            .slice(0, 5);

        // Build embed
        const embed = new EmbedBuilder()
            .setTitle(`📊 Stat Leaders — ${season.name}`)
            .setDescription("All stats shown are **running averages** across all matches played.")
            .setTimestamp();

        // Average field
        if (topAverage.length > 0) {
            const avgLines = topAverage.map(([playerId, stats], idx) => {
                const positionText = idx >= 3 ? `**${idx + 1}.** ` : "";
                return `${medal(idx)} ${positionText}${fmtPlayer(
                    playerId,
                    nameById
                )} — **${stats.average.toFixed(1)}**`;
            });
            embed.addFields({
                name: "🎯 3-Dart Average",
                value: avgLines.join("\n") || "_No data._",
                inline: false,
            });
        }

        // Checkout % field
        if (topCheckoutPercent.length > 0) {
            const coLines = topCheckoutPercent.map(([playerId, stats], idx) => {
                const positionText = idx >= 3 ? `**${idx + 1}.** ` : "";
                return `${medal(idx)} ${positionText}${fmtPlayer(
                    playerId,
                    nameById
                )} — **${stats.checkoutPercent.toFixed(1)}%**`;
            });
            embed.addFields({
                name: "✅ Checkout %",
                value: coLines.join("\n") || "_No data._",
                inline: false,
            });
        }

        // Highest Checkout field
        if (topHighestCheckout.length > 0) {
            const hcLines = topHighestCheckout.map(([playerId, stats], idx) => {
                const positionText = idx >= 3 ? `**${idx + 1}.** ` : "";
                return `${medal(idx)} ${positionText}${fmtPlayer(
                    playerId,
                    nameById
                )} — **${stats.highestCheckout}**`;
            });
            embed.addFields({
                name: "💎 Highest Checkout",
                value: hcLines.join("\n") || "_No data._",
                inline: false,
            });
        }

        // First 9 Average field
        if (topFirst9Average.length > 0) {
            const f9Lines = topFirst9Average.map(([playerId, stats], idx) => {
                const positionText = idx >= 3 ? `**${idx + 1}.** ` : "";
                return `${medal(idx)} ${positionText}${fmtPlayer(
                    playerId,
                    nameById
                )} — **${stats.first9Average.toFixed(1)}**`;
            });
            embed.addFields({
                name: "🎲 First 9 Average",
                value: f9Lines.join("\n") || "_No data._",
                inline: false,
            });
        }

        // If no stats at all, show message
        if (
            topAverage.length === 0 &&
            topCheckoutPercent.length === 0 &&
            topHighestCheckout.length === 0 &&
            topFirst9Average.length === 0
        ) {
            embed.setDescription("_No stats available yet._");
        }

        const msg = await channel.send({ embeds: [embed] });

        await this.seasons.setStatsChannel(season.id, channelId);
        await this.seasons.setStatsMessageId(season.id, msg.id);

        return { season, channelId, messageId: msg.id };
    }

    /**
     * Recompute stats leaders and edit existing published message.
     * Call this after every match confirmation.
     * @param {{ client: Client, guildId: string }} params
     * @returns {Promise<{updated: boolean, skipped: boolean}>}
     * @throws {DomainError} If no season.
     */
    async refresh({ client, guildId }) {
        const season = await this.seasons.getCurrentForGuild(guildId);
        if (!season) throw new DomainError("NO_SEASON", "No season found.");

        if (!season.stats_channel_id || !season.stats_message_id) {
            // not published yet; silently skip
            return { updated: false, skipped: true };
        }

        const channel = await client.channels
            .fetch(season.stats_channel_id)
            .catch(() => null);

        if (!channel || !channel.isTextBased()) {
            return { updated: false, skipped: true };
        }

        const msg = await channel.messages
            .fetch(season.stats_message_id)
            .catch(() => null);
        if (!msg) return { updated: false, skipped: true };

        // Get all player stats
        const allStats = await this.getAllPlayerStats(season.id);

        // Fetch player names
        const playerIds = [...allStats.keys()];
        const nameById = new Map();
        if (playerIds.length > 0) {
            const players = await this.players.listByDiscordIds({
                discordUserIds: playerIds,
            });
            for (const p of players) {
                const name = p.display_name ?? p.discord_user_id;
                nameById.set(p.discord_user_id, name);
            }
        }

        // Build top 5 lists for each category
        const topAverage = [...allStats.entries()]
            .filter(([_, stats]) => stats.average != null)
            .sort(([_, a], [__, b]) => (b.average ?? 0) - (a.average ?? 0))
            .slice(0, 5);

        const topCheckoutPercent = [...allStats.entries()]
            .filter(([_, stats]) => stats.checkoutPercent != null)
            .sort(
                ([_, a], [__, b]) =>
                    (b.checkoutPercent ?? 0) - (a.checkoutPercent ?? 0)
            )
            .slice(0, 5);

        const topHighestCheckout = [...allStats.entries()]
            .filter(([_, stats]) => stats.highestCheckout != null)
            .sort(
                ([_, a], [__, b]) =>
                    (b.highestCheckout ?? 0) - (a.highestCheckout ?? 0)
            )
            .slice(0, 5);

        const topFirst9Average = [...allStats.entries()]
            .filter(([_, stats]) => stats.first9Average != null)
            .sort(
                ([_, a], [__, b]) =>
                    (b.first9Average ?? 0) - (a.first9Average ?? 0)
            )
            .slice(0, 5);

        // Build embed
        const embed = new EmbedBuilder()
            .setTitle(`📊 Stat Leaders — ${season.name}`)
            .setDescription("All stats shown are **running averages** across all matches played.")
            .setTimestamp();

        // Average field
        if (topAverage.length > 0) {
            const avgLines = topAverage.map(([playerId, stats], idx) => {
                const positionText = idx >= 3 ? `**${idx + 1}.** ` : "";
                return `${medal(idx)} ${positionText}${fmtPlayer(
                    playerId,
                    nameById
                )} — **${stats.average.toFixed(1)}**`;
            });
            embed.addFields({
                name: "🎯 3-Dart Average",
                value: avgLines.join("\n") || "_No data._",
                inline: false,
            });
        }

        // Checkout % field
        if (topCheckoutPercent.length > 0) {
            const coLines = topCheckoutPercent.map(([playerId, stats], idx) => {
                const positionText = idx >= 3 ? `**${idx + 1}.** ` : "";
                return `${medal(idx)} ${positionText}${fmtPlayer(
                    playerId,
                    nameById
                )} — **${stats.checkoutPercent.toFixed(1)}%**`;
            });
            embed.addFields({
                name: "✅ Checkout %",
                value: coLines.join("\n") || "_No data._",
                inline: false,
            });
        }

        // Highest Checkout field
        if (topHighestCheckout.length > 0) {
            const hcLines = topHighestCheckout.map(([playerId, stats], idx) => {
                const positionText = idx >= 3 ? `**${idx + 1}.** ` : "";
                return `${medal(idx)} ${positionText}${fmtPlayer(
                    playerId,
                    nameById
                )} — **${stats.highestCheckout}**`;
            });
            embed.addFields({
                name: "💎 Highest Checkout",
                value: hcLines.join("\n") || "_No data._",
                inline: false,
            });
        }

        // First 9 Average field
        if (topFirst9Average.length > 0) {
            const f9Lines = topFirst9Average.map(([playerId, stats], idx) => {
                const positionText = idx >= 3 ? `**${idx + 1}.** ` : "";
                return `${medal(idx)} ${positionText}${fmtPlayer(
                    playerId,
                    nameById
                )} — **${stats.first9Average.toFixed(1)}**`;
            });
            embed.addFields({
                name: "🎲 First 9 Average",
                value: f9Lines.join("\n") || "_No data._",
                inline: false,
            });
        }

        // If no stats at all, show message
        if (
            topAverage.length === 0 &&
            topCheckoutPercent.length === 0 &&
            topHighestCheckout.length === 0 &&
            topFirst9Average.length === 0
        ) {
            embed.setDescription("_No stats available yet._");
        }

        await msg.edit({ embeds: [embed] });

        return { updated: true, skipped: false };
    }
}
