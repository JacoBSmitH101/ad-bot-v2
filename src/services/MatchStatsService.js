import { DomainError } from "../utils/DomainError.js";
import { extractAutodartsMatchId } from "../utils/autodarts.js";

/**
 * Convert value to number or null.
 * @private
 * @param {*} v
 * @returns {(number|null)}
 */
function numOrNull(v) {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
}

/**
 * Convert decimal to percentage or null.
 * @private
 * @param {*} v
 * @returns {(number|null)}
 */
function pctOrNullDecimalToPercent(v) {
    const n = numOrNull(v);
    return n == null ? null : n * 100;
}

/**
 * Align match stats to A-B orientation using scores array.
 * @private
 * @param {{ matchStats: Array.<Object>, scores: Array.<Object>, legsA: number, legsB: number }} params
 * @returns {{A: (Object|null), B: (Object|null), aligned: boolean}}
 * @throws {DomainError} If scores array is missing or malformed.
 */
function alignMatchStatsByScores({ matchStats, scores, legsA, legsB }) {
    const ms0 = matchStats?.[0];
    const ms1 = matchStats?.[1];
    if (!ms0 || !ms1) return { A: ms0 ?? null, B: ms1 ?? null, aligned: false };

    if (!Array.isArray(scores) || scores.length < 2) {
        throw new DomainError(
            "STATS_SHAPE",
            "Stats payload missing scores array or scores[0/1]."
        );
    }

    const s0 = scores[0];
    const s1 = scores[1];
    if (s0 == null || s1 == null) {
        throw new DomainError(
            "STATS_SHAPE",
            "Stats payload scores array missing scores[0] or scores[1]."
        );
    }

    const w0 = Number(s0.legs);
    const w1 = Number(s1.legs);

    const a = Number(legsA);
    const b = Number(legsB);

    // exact match
    if (Number.isFinite(w0) && Number.isFinite(w1)) {
        if (w0 === a && w1 === b) return { A: ms0, B: ms1, aligned: true };
        if (w0 === b && w1 === a) return { A: ms1, B: ms0, aligned: true };

        // partial match
        if (w0 === a) return { A: ms0, B: ms1, aligned: true };
        if (w1 === a) return { A: ms1, B: ms0, aligned: true };

        // if tie (rare / shouldn't happen), keep order
        if (a === b) return { A: ms0, B: ms1, aligned: false };
    }

    // fallback
    return { A: ms0, B: ms1, aligned: false };
}

/**
 * Service for fetching and formatting match statistics from Autodarts.
 * Handles API calls and data alignment.
 */
export class MatchStatsService {
    /**
     * @param {{ internalApi: InternalApiClient, matches: MatchRepository, matchResults: MatchResultRepository }} deps
     * @param {InternalApiClient} deps.internalApi Internal API client instance.
     * @param {MatchRepository} deps.matches Match repository instance.
     * @param {MatchResultRepository} deps.matchResults Match result repository instance.
     */
    constructor({ internalApi, matches, matchResults }) {
        this.internalApi = internalApi;
        this.matches = matches;
        this.matchResults = matchResults;
    }

    /**
     * Fetch and align stats to A–B using scores array.
     * @param {string} proofUrl Autodarts match URL.
     * @param {{ legsA: number, legsB: number }} params - DB match_results legs values.
     * @returns {Promise<{queued: boolean, source: string, keyStats: ({averageA: (number|null), averageB: (number|null), checkoutA: (number|null), checkoutB: (number|null)}|null)}>}
     * @throws {DomainError} If invalid proof URL or stats payload missing.
     */
    async fetchKeyStatsForProofUrl(proofUrl, { legsA, legsB }) {
        const matchId = extractAutodartsMatchId(proofUrl);
        if (!matchId) {
            throw new DomainError(
                "INVALID_PROOF_URL",
                "Proof URL must be a valid Autodarts match link."
            );
        }

        const res = await this.internalApi.getMatchStats(matchId);

        if (res?.queued === true) {
            return { queued: true, source: "queued", keyStats: null };
        }

        const payload = res?.stats ?? res;
        const matchStats =
            payload?.stats?.matchStats ?? payload?.matchStats ?? null;
        const scores = payload?.scores ?? null;

        if (!Array.isArray(matchStats) || matchStats.length < 2) {
            throw new DomainError(
                "STATS_SHAPE",
                "Stats payload missing matchStats[0/1]."
            );
        }

        const aligned = alignMatchStatsByScores({
            matchStats,
            scores,
            legsA,
            legsB,
        });

        if (!aligned.aligned) {
            // not fatal, just helpful for debugging
            console.warn("Could not confidently align matchStats by scores", {
                legsA,
                legsB,
                scores0: scores?.[0]?.legs,
                scores1: scores?.[1]?.legs,
            });
        }

        const averageA = numOrNull(aligned.A?.average);
        const averageB = numOrNull(aligned.B?.average);

        const checkoutA = pctOrNullDecimalToPercent(aligned.A?.checkoutPercent);
        const checkoutB = pctOrNullDecimalToPercent(aligned.B?.checkoutPercent);

        return {
            queued: false,
            source: res?.source ?? "unknown",
            keyStats: { averageA, averageB, checkoutA, checkoutB },
        };
    }

    /**
     * Get full match stats by internal match_id.
     * Fetches match, result, and stats, then aligns everything.
     * @param {string|number} internalMatchId Internal match ID from database.
     * @returns {Promise<{playerA: (Object|null), playerB: (Object|null), aligned: boolean, source: string, queued: boolean}>}
     * @throws {DomainError} If match not found, result not found, or stats payload missing.
     */
    async getMatchStatsByMatchId(internalMatchId) {
        const match = await this.matches.getById(internalMatchId);
        if (!match) {
            throw new DomainError("NO_MATCH", "Match not found.");
        }

        const result = await this.matchResults.getByMatchId(internalMatchId);
        if (!result || !result.proof_url) {
            throw new DomainError(
                "NO_RESULT",
                "Match result not found or missing proof URL."
            );
        }

        const autodartsMatchId = extractAutodartsMatchId(result.proof_url);
        if (!autodartsMatchId) {
            throw new DomainError(
                "INVALID_PROOF_URL",
                "Proof URL must be a valid Autodarts match link."
            );
        }

        const res = await this.internalApi.getMatchStats(autodartsMatchId);

        if (res?.queued === true) {
            return {
                queued: true,
                source: "queued",
                playerA: null,
                playerB: null,
                aligned: false,
            };
        }

        const payload = res?.stats ?? res;
        const matchStats =
            payload?.stats?.matchStats ?? payload?.matchStats ?? null;
        const scores = payload?.scores ?? null;

        if (!Array.isArray(matchStats) || matchStats.length < 2) {
            throw new DomainError(
                "STATS_SHAPE",
                "Stats payload missing matchStats[0/1]."
            );
        }

        const aligned = alignMatchStatsByScores({
            matchStats,
            scores,
            legsA: result.legs_a,
            legsB: result.legs_b,
        });

        return {
            queued: false,
            source: res?.source ?? "unknown",
            playerA: aligned.A,
            playerB: aligned.B,
            aligned: aligned.aligned,
        };
    }

    /**
     * Get stats for a specific player in a match.
     * @param {string|number} internalMatchId Internal match ID from database.
     * @param {string} targetPlayerId Discord user ID of the target player.
     * @returns {Promise<(Object|null)>} Full stat object for target player, or null if not found/queued.
     * @throws {DomainError} If match not found, result not found, or stats payload missing.
     */
    async getPlayerStatsByMatchId(internalMatchId, targetPlayerId) {
        const match = await this.matches.getById(internalMatchId);
        if (!match) {
            throw new DomainError("NO_MATCH", "Match not found.");
        }

        const result = await this.matchResults.getByMatchId(internalMatchId);
        if (!result || !result.proof_url) {
            throw new DomainError(
                "NO_RESULT",
                "Match result not found or missing proof URL."
            );
        }

        const isPlayerA = match.player_a_id === targetPlayerId;
        const isPlayerB = match.player_b_id === targetPlayerId;

        if (!isPlayerA && !isPlayerB) {
            throw new DomainError(
                "NOT_IN_MATCH",
                "Target player is not a player in this match."
            );
        }

        const stats = await this.getMatchStatsByMatchId(internalMatchId);

        if (stats.queued) {
            return null;
        }

        return isPlayerA ? stats.playerA : stats.playerB;
    }

    /**
     * Format key stats as display lines.
     * @param {{averageA: (number|null), averageB: (number|null), checkoutA: (number|null), checkoutB: (number|null)}|null} keyStats
     * @returns {Array.<string>} Formatted stat lines.
     */
    formatKeyStatsLines(keyStats) {
        if (!keyStats) return ["_No stats available._"];

        const aAvg =
            keyStats.averageA == null ? "n/a" : keyStats.averageA.toFixed(1);
        const bAvg =
            keyStats.averageB == null ? "n/a" : keyStats.averageB.toFixed(1);

        const aCo =
            keyStats.checkoutA == null
                ? "n/a"
                : `${keyStats.checkoutA.toFixed(0)}%`;
        const bCo =
            keyStats.checkoutB == null
                ? "n/a"
                : `${keyStats.checkoutB.toFixed(0)}%`;

        return [
            `🎯 **3DA:** **${aAvg}** — **${bAvg}**`,
            `✅ **Checkout:** **${aCo}** — **${bCo}**`,
        ];
    }
}
