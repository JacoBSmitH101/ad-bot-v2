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
 * Align match stats to A-B orientation using legs won.
 * @private
 * @param {{ matchStats: Array.<Object>, legsA: number, legsB: number }} params
 * @returns {{A: (Object|null), B: (Object|null), aligned: boolean}}
 */
function alignMatchStatsByLegsWon({ matchStats, legsA, legsB }) {
    const ms0 = matchStats?.[0];
    const ms1 = matchStats?.[1];
    if (!ms0 || !ms1) return { A: ms0 ?? null, B: ms1 ?? null, aligned: false };

    const w0 = Number(ms0.legsWon);
    const w1 = Number(ms1.legsWon);

    const a = Number(legsA);
    const b = Number(legsB);

    // exact match
    if (Number.isFinite(w0) && Number.isFinite(w1)) {
        if (w0 === a && w1 === b) return { A: ms0, B: ms1, aligned: true };
        if (w0 === b && w1 === a) return { A: ms1, B: ms0, aligned: true };

        // partial match
        if (w0 === a) return { A: ms0, B: ms1, aligned: true };
        if (w1 === a) return { A: ms1, B: ms0, aligned: true };

        // if tie (rare / shouldn’t happen), keep order
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
     * @param {{ internalApi: InternalApiClient }} deps
     * @param {InternalApiClient} deps.internalApi Internal API client instance.
     */
    constructor({ internalApi }) {
        this.internalApi = internalApi;
    }

    /**
     * Fetch and align stats to A–B using legs won.
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

        if (!Array.isArray(matchStats) || matchStats.length < 2) {
            throw new DomainError(
                "STATS_SHAPE",
                "Stats payload missing matchStats[0/1]."
            );
        }

        const aligned = alignMatchStatsByLegsWon({ matchStats, legsA, legsB });

        if (!aligned.aligned) {
            // not fatal, just helpful for debugging
            console.warn("Could not confidently align matchStats by legsWon", {
                legsA,
                legsB,
                legsWon0: matchStats?.[0]?.legsWon,
                legsWon1: matchStats?.[1]?.legsWon,
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
