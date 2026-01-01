import { DomainError } from "../utils/DomainError.js";
import { EmbedBuilder } from "discord.js";
import { extractAutodartsMatchId } from "../utils/autodarts.js";
import { supabase } from "../db/supabase.js";

/**
 * Formats a player ID for display.
 * @private
 * @param {string} id
 * @returns {string}
 */
function fmtPlayer(id) {
    return id.startsWith("FAKE_") ? `\`${id}\`` : `<@${id}>`;
}
function medal(i) {
    return i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : "•";
}
function fmtPlayerInline(id) {
    return id.startsWith("FAKE_") ? `\`${id}\`` : `<@${id}>`;
}

function normalizeMatchResult(match) {
    const mrRaw = match.match_results;
    const mr = Array.isArray(mrRaw) ? mrRaw[0] : mrRaw;
    if (!mr) return null;
    return {
        legs_a: Number(mr.legs_a),
        legs_b: Number(mr.legs_b),
        proof_url: mr.proof_url ?? null,
    };
}

function buildRankMap(rows) {
    const map = new Map();
    rows.forEach((r, i) => map.set(r.discordUserId, i + 1));
    return map;
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
 * Format rank movement arrow.
 * @private
 * @param {number} delta
 * @returns {string}
 */
function arrow(delta) {
    if (delta < 0) return `🟢▲${Math.abs(delta)}`;
    if (delta > 0) return `🔴▼${delta}`;
    return "⚪—";
}

/**
 * Build a summary embed for standings.
 * @private
 * @param {{ seasonName: string, divisionName: string, standings: Array.<StandingsRow>, lastUpdateText: (string|null), playerAverages: (Map<string, number>|null) }} params
 * @returns {EmbedBuilder}
 */
function buildSummaryEmbed({
    seasonName,
    divisionName,
    standings,
    lastUpdateText = null,
    playerAverages = null,
}) {
    const lines = standings.map((r, idx) => {
        let avgText = "";
        if (playerAverages) {
            if (playerAverages.has(r.discordUserId)) {
                avgText = ` (${playerAverages
                    .get(r.discordUserId)
                    .toFixed(1)})`;
            } else {
                avgText = " (n/a)";
            }
        }
        const positionText = idx >= 3 ? `**${idx + 1}.** ` : "";
        return `${medal(idx)} ${positionText}**${fmtPlayer(
            r.discordUserId
        )}**${avgText} — **${r.points} pts**`;
    });

    const desc =
        (lastUpdateText ? `${lastUpdateText}\n\n` : "") +
        (lines.join("\n") || "_No players._");

    return new EmbedBuilder()
        .setTitle(`📊 ${seasonName} — ${divisionName}`)
        .setDescription(desc)
        .setTimestamp();
}

/**
 * Service for publishing and refreshing standings messages in Discord.
 * Manages Discord embed creation and message updates for division standings.
 */
export class StandingsPublisherService {
    /**
     * @param {{ seasons: SeasonRepository, standings: StandingsService, matches: MatchRepository }} deps
     * @param {SeasonRepository} deps.seasons Season repository instance.
     * @param {StandingsService} deps.standings Standings service instance.
     * @param {MatchRepository} deps.matches Match repository instance.
     */
    constructor({ seasons, standings, matches }) {
        this.seasons = seasons;
        this.standings = standings;
        this.matches = matches;
    }

    /**
     * Get player season averages from match stats cache.
     * @private
     * @param {string|number} seasonId
     * @param {Array.<StandingsRow>} standings
     * @returns {Promise<Map<string, number>>} Map of discordUserId -> average
     */
    async getPlayerAverages(seasonId, standings) {
        const averages = new Map();

        // Get all player IDs from standings
        const playerIds = standings.map((s) => s.discordUserId);

        // Fetch averages for all players in parallel
        const averagePromises = playerIds.map(async (discordUserId) => {
            try {
                // Get all matches for this player in the season
                const matches =
                    await this.matches.listForPlayerInSeasonWithResults({
                        seasonId,
                        discordUserId,
                    });

                // Filter confirmed matches with proof URLs
                const confirmedMatches = matches.filter(
                    (m) =>
                        m.status === "confirmed" && m.match_results?.proof_url
                );

                if (confirmedMatches.length === 0) {
                    return { discordUserId, average: null };
                }

                // Fetch stats for each match
                const statsPromises = confirmedMatches.map(async (match) => {
                    const mrRaw = match.match_results;
                    const mr = Array.isArray(mrRaw) ? mrRaw[0] : mrRaw;
                    if (!mr?.proof_url) return null;

                    const matchId = extractAutodartsMatchId(mr.proof_url);
                    if (!matchId) return null;

                    // Query public schema cache table
                    const { data, error } = await supabase
                        .from("autodarts_match_stats_cache")
                        .select("stats")
                        .eq("match_id", matchId)
                        .maybeSingle();

                    if (error || !data) return null;

                    // Parse JSON stats
                    const stats =
                        typeof data.stats === "string"
                            ? JSON.parse(data.stats)
                            : data.stats;

                    const matchStats = stats?.matchStats || stats;
                    if (!Array.isArray(matchStats) || matchStats.length < 2) {
                        return null;
                    }

                    // Align stats to correct player using legs won
                    const playerStats = findPlayerStatsByLegsWon({
                        matchStats,
                        legsA: mr.legs_a,
                        legsB: mr.legs_b,
                        playerAId: match.player_a_id,
                        playerBId: match.player_b_id,
                        targetPlayerId: discordUserId,
                    });

                    if (!playerStats) {
                        // If alignment failed, log warning and skip this match
                        console.warn(
                            `Could not align stats for player ${discordUserId} in match ${match.id}`
                        );
                        return null;
                    }

                    return playerStats.average != null
                        ? Number(playerStats.average)
                        : null;
                });

                const matchAverages = (await Promise.all(statsPromises)).filter(
                    (avg) => avg != null && Number.isFinite(avg)
                );

                if (matchAverages.length === 0) {
                    return { discordUserId, average: null };
                }

                // Calculate average: sum of all match averages ÷ number of matches
                const average =
                    matchAverages.reduce((sum, avg) => sum + avg, 0) /
                    matchAverages.length;

                return { discordUserId, average };
            } catch (error) {
                console.error(
                    `Error fetching average for player ${discordUserId}:`,
                    error
                );
                return { discordUserId, average: null };
            }
        });

        const results = await Promise.all(averagePromises);
        results.forEach(({ discordUserId, average }) => {
            if (average != null && Number.isFinite(average)) {
                averages.set(discordUserId, average);
            }
        });

        return averages;
    }

    /**
     * Create (or recreate) standings messages in a channel and store their message IDs.
     * Posts one message per division.
     * @param {{ client: Client, guildId: string, channelId: string }} params
     * @returns {Promise<{season: Season, channelId: string, messageIds: Object}>}
     * @throws {DomainError} If no season, invalid state, or bad channel.
     */
    async publish({ client, guildId, channelId }) {
        const season = await this.seasons.getCurrentForGuild(guildId);
        if (!season) throw new DomainError("NO_SEASON", "No season found.");

        // you can allow publishing earlier if you want, but this is a sane rule
        if (!["active", "closed"].includes(season.status)) {
            throw new DomainError(
                "INVALID_STATE",
                `Standings publish only available when season is active/closed (current: ${season.status})`
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

        const res = await this.standings.getStandingsForCurrentSeason({
            guildId,
        });

        // post one message per division and store IDs keyed by division id
        const messageIds = {};

        for (const d of res.divisions) {
            // Get player averages for this division
            const playerAverages = await this.getPlayerAverages(
                res.season.id,
                d.standings
            );

            const embed = buildSummaryEmbed({
                seasonName: res.season.name,
                divisionName: d.division.name,
                standings: d.standings,
                playerAverages,
            });

            const msg = await channel.send({ embeds: [embed] });

            messageIds[`division:${d.division.id}`] = msg.id;
        }

        await this.seasons.setStandingsChannel(season.id, channelId);
        await this.seasons.setStandingsMessageIds(season.id, messageIds);

        return { season, channelId, messageIds };
    }

    /**
     * Recompute standings and edit existing published messages.
     * Call this after every confirm. Optionally includes movement context.
     * @param {{ client: Client, guildId: string, context: (Object|null) }} params
     * @param {Object|null} [params.context] Optional context with divisionId, beforeStandings, afterStandings, playerAId, playerBId, scoreText, actorName
     * @returns {Promise<{updated: number, skipped: boolean}>}
     * @throws {DomainError} If no season.
     */
    async refresh({ client, guildId, context = null }) {
        const season = await this.seasons.getCurrentForGuild(guildId);
        if (!season) throw new DomainError("NO_SEASON", "No season found.");

        if (!season.standings_channel_id || !season.standings_message_ids) {
            // not published yet; silently skip
            return { updated: 0, skipped: true };
        }

        const channel = await client.channels
            .fetch(season.standings_channel_id)
            .catch(() => null);

        if (!channel || !channel.isTextBased()) {
            return { updated: 0, skipped: true };
        }

        const res = await this.standings.getStandingsForCurrentSeason({
            guildId,
        });
        let beforeDivisionStandings = null;
        let afterDivisionStandings = null;
        let movementText = null;

        if (
            context?.divisionId &&
            context?.beforeStandings &&
            context?.afterStandings
        ) {
            beforeDivisionStandings = context.beforeStandings;
            afterDivisionStandings = context.afterStandings;

            const beforeMap = buildRankMap(beforeDivisionStandings);
            const afterMap = buildRankMap(afterDivisionStandings);

            const ids = [context.playerAId, context.playerBId].filter(Boolean);

            const parts = ids.map((id) => {
                const b = beforeMap.get(id);
                const a = afterMap.get(id);
                if (!b || !a) return `${fmtPlayerInline(id)}: —`;
                const delta = a - b;
                return `${fmtPlayerInline(id)} ${b}→**${a}** (${arrow(delta)})`;
            });

            movementText = parts.length ? parts.join(" • ") : null;
        }
        let updated = 0;

        for (const d of res.divisions) {
            const key = `division:${d.division.id}`;
            const msgId = season.standings_message_ids?.[key];
            if (!msgId) continue;

            const msg = await channel.messages.fetch(msgId).catch(() => null);
            if (!msg) continue;

            let lastUpdateText = null;

            if (context?.divisionId && d.division.id === context.divisionId) {
                // Score line (from stored match result if provided)
                const score = context.scoreText
                    ? ` — ${context.scoreText}`
                    : "";
                const by = context.actorName
                    ? ` (by ${context.actorName})`
                    : "";

                lastUpdateText = `🆕 **Last update:** ${fmtPlayerInline(
                    context.playerAId
                )} vs ${fmtPlayerInline(context.playerBId)}${score}${by}`;
                if (movementText) {
                    lastUpdateText += `\n📈 ${movementText}`;
                }
            }

            // Get player averages for this division
            const playerAverages = await this.getPlayerAverages(
                res.season.id,
                d.standings
            );

            const embed = buildSummaryEmbed({
                seasonName: res.season.name,
                divisionName: d.division.name,
                standings: d.standings,
                lastUpdateText,
                playerAverages,
            });

            await msg.edit({ embeds: [embed] });
            updated += 1;
        }

        return { updated, skipped: false };
    }
}
