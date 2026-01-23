import { DomainError } from "../utils/DomainError.js";
import { extractAutodartsMatchId } from "../utils/autodarts.js";
import { supabase } from "../db/supabase.js";

/**
 * @typedef {Object} PlayerStats
 * @property {number} played
 * @property {number} wins
 * @property {number} losses
 * @property {number} legsFor
 * @property {number} legsAgainst
 * @property {number} legDiff
 * @property {number} points
 * @property {number|null} average
 * @property {number|null} checkoutPercent
 * @property {number|null} highestCheckout
 */

/**
 * @typedef {Object} HeadToHeadRecord
 * @property {number} wins
 * @property {number} losses
 * @property {number} legsFor
 * @property {number} legsAgainst
 * @property {Array.<Object>} recentMatches
 */

/**
 * Service for calculating and retrieving player statistics.
 * Handles overall stats, current season stats, head-to-head records, and recent form.
 */
export class PlayerStatsService {
    /**
     * @param {{ seasons: SeasonRepository, matches: MatchRepository, players: PlayersRepository, matchStats: MatchStatsService }} deps
     * @param {SeasonRepository} deps.seasons Season repository instance.
     * @param {MatchRepository} deps.matches Match repository instance.
     * @param {PlayersRepository} deps.players Players repository instance.
     * @param {MatchStatsService} deps.matchStats Match stats service instance.
     */
    constructor({ seasons, matches, players, matchStats }) {
        this.seasons = seasons;
        this.matches = matches;
        this.players = players;
        this.matchStats = matchStats;
    }

    /**
     * Get overall statistics for a player across all seasons in a guild.
     * @param {{ guildId: string, discordUserId: string }} params
     * @returns {Promise<{stats: PlayerStats, recentMatches: Array.<Object>}>}
     */
    async getOverallStats({ guildId, discordUserId }) {
        const allMatches = await this.matches.listAllConfirmedForPlayerInGuild({
            guildId,
            discordUserId,
        });

        const stats = this.#calculateStatsFromMatches(allMatches, discordUserId);
        const recentMatches = this.#getRecentMatches(allMatches, discordUserId, 5);

        // Try to get average and checkout stats from match stats
        const enhancedStats = await this.#enhanceStatsWithMatchData(
            stats,
            recentMatches,
            discordUserId
        );

        return { stats: enhancedStats, recentMatches };
    }

    /**
     * Get current season statistics for a player.
     * @param {{ guildId: string, discordUserId: string }} params
     * @returns {Promise<{season: Season, stats: PlayerStats}>}
     * @throws {DomainError} If no season found.
     */
    async getCurrentSeasonStats({ guildId, discordUserId }) {
        const season = await this.seasons.getCurrentForGuild(guildId);
        if (!season) throw new DomainError("NO_SEASON", "No season found.");

        const matches = await this.matches.listForPlayerInSeasonWithResults({
            seasonId: season.id,
            discordUserId,
        });

        const confirmedMatches = matches.filter((m) => m.status === "confirmed");
        const stats = this.#calculateStatsFromMatches(
            confirmedMatches,
            discordUserId
        );

        // Try to enhance with match stats
        const recentMatches = this.#getRecentMatches(
            confirmedMatches,
            discordUserId,
            10
        );
        const enhancedStats = await this.#enhanceStatsWithMatchData(
            stats,
            recentMatches,
            discordUserId
        );

        return { season, stats: enhancedStats };
    }

    /**
     * Get head-to-head record between two players.
     * @param {{ guildId: string, playerAId: string, playerBId: string }} params
     * @returns {Promise<{record: HeadToHeadRecord, playerAStats: PlayerStats, playerBStats: PlayerStats}>}
     */
    async getHeadToHead({ guildId, playerAId, playerBId }) {
        const matches = await this.matches.listHeadToHeadMatches({
            guildId,
            playerAId,
            playerBId,
        });

        const record = {
            wins: 0, // wins for playerAId
            losses: 0, // losses for playerAId
            legsFor: 0, // legs for playerAId
            legsAgainst: 0, // legs against playerAId
            recentMatches: [],
        };

        for (const match of matches) {
            const mrRaw = match.match_results;
            const mr = Array.isArray(mrRaw) ? mrRaw[0] : mrRaw;
            if (!mr) continue;

            const isPlayerA = match.player_a_id === playerAId;
            const legsA = Number(mr.legs_a);
            const legsB = Number(mr.legs_b);

            const playerALegs = isPlayerA ? legsA : legsB;
            const playerBLegs = isPlayerA ? legsB : legsA;

            record.legsFor += playerALegs;
            record.legsAgainst += playerBLegs;

            if (playerALegs > playerBLegs) {
                record.wins += 1;
            } else {
                record.losses += 1;
            }

            record.recentMatches.push({
                matchId: match.id,
                seasonId: match.season_id,
                week: match.week,
                playerLegs: playerALegs,
                opponentLegs: playerBLegs,
                won: playerALegs > playerBLegs,
                proofUrl: mr.proof_url,
            });
        }

        // Get overall stats for both players for context
        const playerAMatches = await this.matches.listAllConfirmedForPlayerInGuild({
            guildId,
            discordUserId: playerAId,
        });
        const playerBMatches = await this.matches.listAllConfirmedForPlayerInGuild({
            guildId,
            discordUserId: playerBId,
        });

        const playerAStats = this.#calculateStatsFromMatches(
            playerAMatches,
            playerAId
        );
        const playerBStats = this.#calculateStatsFromMatches(
            playerBMatches,
            playerBId
        );

        return { record, playerAStats, playerBStats };
    }

    /**
     * Calculate basic stats from a list of matches.
     * @private
     * @param {Array.<MatchWithResult>} matches
     * @param {string} playerId
     * @returns {PlayerStats}
     */
    #calculateStatsFromMatches(matches, playerId) {
        const stats = {
            played: 0,
            wins: 0,
            losses: 0,
            legsFor: 0,
            legsAgainst: 0,
            legDiff: 0,
            points: 0,
            average: null,
            checkoutPercent: null,
            highestCheckout: null,
        };

        for (const match of matches) {
            const mrRaw = match.match_results;
            const mr = Array.isArray(mrRaw) ? mrRaw[0] : mrRaw;
            if (!mr) continue;

            const isPlayerA = match.player_a_id === playerId;
            const legsA = Number(mr.legs_a);
            const legsB = Number(mr.legs_b);

            const playerLegs = isPlayerA ? legsA : legsB;
            const opponentLegs = isPlayerA ? legsB : legsA;

            stats.played += 1;
            stats.legsFor += playerLegs;
            stats.legsAgainst += opponentLegs;

            if (playerLegs > opponentLegs) {
                stats.wins += 1;
                stats.points += playerLegs + 2; // 1 per leg + 2 win bonus
            } else {
                stats.losses += 1;
                stats.points += playerLegs; // 1 per leg
            }
        }

        stats.legDiff = stats.legsFor - stats.legsAgainst;

        return stats;
    }

    /**
     * Get recent matches for a player.
     * @private
     * @param {Array.<MatchWithResult>} matches
     * @param {string} playerId
     * @param {number} limit
     * @returns {Array.<Object>}
     */
    #getRecentMatches(matches, playerId, limit) {
        return matches
            .slice(0, limit)
            .map((match) => {
                const mrRaw = match.match_results;
                const mr = Array.isArray(mrRaw) ? mrRaw[0] : mrRaw;
                if (!mr) return null;

                const isPlayerA = match.player_a_id === playerId;
                const opponentId = isPlayerA ? match.player_b_id : match.player_a_id;
                const legsA = Number(mr.legs_a);
                const legsB = Number(mr.legs_b);

                const playerLegs = isPlayerA ? legsA : legsB;
                const opponentLegs = isPlayerA ? legsB : legsA;

                return {
                    matchId: match.id,
                    seasonId: match.season_id,
                    week: match.week,
                    opponentId,
                    playerLegs,
                    opponentLegs,
                    won: playerLegs > opponentLegs,
                    proofUrl: mr.proof_url,
                };
            })
            .filter(Boolean);
    }

    /**
     * Enhance stats with match data (averages, checkout percentages).
     * @private
     * @param {PlayerStats} stats
     * @param {Array.<Object>} recentMatches
     * @param {string} playerId
     * @returns {Promise<PlayerStats>}
     */
    async #enhanceStatsWithMatchData(stats, recentMatches, playerId) {
        const averages = [];
        const checkoutPercents = [];
        let highestCheckout = null;

        // Try to fetch stats for recent matches
        for (const match of recentMatches) {
            if (!match.proofUrl) continue;

            try {
                const matchId = extractAutodartsMatchId(match.proofUrl);
                if (!matchId) continue;

                // Query cache table if available
                const { data, error } = await supabase
                    .from("autodarts_match_stats_cache")
                    .select("stats")
                    .eq("match_id", matchId)
                    .maybeSingle();

                if (error || !data) continue;

                const statsData =
                    typeof data.stats === "string" ? JSON.parse(data.stats) : data.stats;
                const matchStats =
                    statsData?.matchStats ?? statsData?.stats?.matchStats ?? statsData;

                if (!Array.isArray(matchStats) || matchStats.length < 2) continue;

                // Find player's stats by matching legs won
                const playerStats = matchStats.find(
                    (ms) => Number(ms.legsWon) === match.playerLegs
                );

                if (playerStats) {
                    if (
                        playerStats.average != null &&
                        Number.isFinite(Number(playerStats.average))
                    ) {
                        averages.push(Number(playerStats.average));
                    }

                    if (
                        playerStats.checkoutPercent != null &&
                        Number.isFinite(Number(playerStats.checkoutPercent))
                    ) {
                        checkoutPercents.push(Number(playerStats.checkoutPercent) * 100);
                    }

                    if (
                        playerStats.checkoutPoints != null &&
                        Number.isFinite(Number(playerStats.checkoutPoints))
                    ) {
                        const checkout = Number(playerStats.checkoutPoints);
                        if (!highestCheckout || checkout > highestCheckout) {
                            highestCheckout = checkout;
                        }
                    }
                }
            } catch (e) {
                // Silently continue if stats fetch fails
                console.warn(`Failed to fetch stats for match ${match.matchId}:`, e);
            }
        }

        // Calculate averages
        if (averages.length > 0) {
            stats.average =
                averages.reduce((sum, avg) => sum + avg, 0) / averages.length;
        }

        if (checkoutPercents.length > 0) {
            stats.checkoutPercent =
                checkoutPercents.reduce((sum, pct) => sum + pct, 0) /
                checkoutPercents.length;
        }

        stats.highestCheckout = highestCheckout;

        return stats;
    }
}
