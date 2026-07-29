import { DomainError } from "../utils/DomainError.js";

/**
 * @typedef {Object} MatchWeek
 * @property {number} week
 * @property {Array.<string>} lines - Formatted match lines for display
 * @property {Array.<Object>} [matches] - Structured matches for image-based displays
 */

/**
 * @typedef {Object} MyMatchesResult
 * @property {Season} season
 * @property {Array.<MatchWeek>} weeks
 */

/**
 * @typedef {Object} UnreportedMatchesResult
 * @property {Season} season
 * @property {Array.<MatchWeek>} weeks
 * @property {number} cutoffWeek
 * @property {number} currentWeek
 */

/**
 * Formats a player ID for display.
 * @private
 * @param {string} id
 * @returns {string}
 */
function fmtPlayer(id) {
    return id.startsWith("FAKE_") ? `\`${id}\`` : `<@${id}>`;
}

function statusIcon(status) {
    if (status === "confirmed") return "🟢";
    if (status === "reported") return "🟠";
    return "🗓️";
}

/**
 * Normalizes match result from Supabase response (handles array/object).
 * @private
 * @param {MatchWithResult} match
 * @returns {{legs_a: number, legs_b: number, proof_url: (string|null)}|null}
 */
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

/**
 * Service for querying and formatting match data for display.
 * Handles player match lists and unreported match queries.
 */
export class MatchesService {
    /**
     * @param {{ seasons: SeasonRepository, matches: MatchRepository, divisions: DivisionRepository }} deps
     * @param {SeasonRepository} deps.seasons Season repository instance.
     * @param {MatchRepository} deps.matches Match repository instance.
     * @param {DivisionRepository} deps.divisions Division repository instance.
     */
    constructor({ seasons, matches, divisions }) {
        this.seasons = seasons;
        this.matches = matches;
        this.divisions = divisions;
    }

    /**
     * Get all matches for a player in the current season, grouped by week.
     * Includes results and highlights next match.
     * @param {{ guildId: string, discordUserId: string }} params
     * @returns {Promise<MyMatchesResult>}
     * @throws {DomainError} If no season or invalid season state.
     */
    async getMyMatches({ guildId, discordUserId }) {
        const season = await this.seasons.getCurrentForGuild(guildId);
        if (!season) throw new DomainError("NO_SEASON", "No season found.");

        const allowed = ["active", "signups_closed", "closed"];
        if (!allowed.includes(season.status)) {
            throw new DomainError(
                "INVALID_STATE",
                `Matches not available in this season state (current: ${season.status})`
            );
        }

        const matches = await this.matches.listForPlayerInSeasonWithResults({
            seasonId: season.id,
            discordUserId,
        });

        // ✅ compute nextMatchId BEFORE building weeks (fixes TDZ error)
        const nextMatch = matches
            .filter((m) => m.status !== "confirmed")
            .sort((a, b) => {
                const wa = a.week ?? 0;
                const wb = b.week ?? 0;
                if (wa !== wb) return wa - wb;
                // stable-ish tie-break
                return String(a.id).localeCompare(String(b.id));
            })[0];

        const nextMatchId = nextMatch?.id ?? null;

        // group by week
        const byWeek = new Map();
        for (const m of matches) {
            const week = m.week ?? 0;
            if (!byWeek.has(week)) byWeek.set(week, []);
            byWeek.get(week).push(m);
        }

        // build rows in week order, keep original order inside a week (optional sort by id)
        const weeks = [...byWeek.keys()]
            .sort((a, b) => a - b)
            .map((week) => {
                const ms = byWeek.get(week) ?? [];

                // optional: stable order within week
                ms.sort((a, b) => String(a.id).localeCompare(String(b.id)));

                const lines = ms.flatMap((m) => {
                    const isNext = nextMatchId && m.id === nextMatchId;

                    const opp =
                        m.player_a_id === discordUserId
                            ? m.player_b_id
                            : m.player_a_id;

                    const icon = statusIcon(m.status);
                    const mr = normalizeMatchResult(m);

                    let scorePart = "";
                    let proofPart = "";

                    if (mr) {
                        const youLegs =
                            m.player_a_id === discordUserId
                                ? mr.legs_a
                                : mr.legs_b;
                        const themLegs =
                            m.player_a_id === discordUserId
                                ? mr.legs_b
                                : mr.legs_a;

                        scorePart = ` — **${youLegs}-${themLegs}**`;
                        if (mr.proof_url)
                            proofPart = ` ([Match Link](${mr.proof_url}))`;
                    }

                    const statusText =
                        m.status === "reported"
                            ? "reported"
                            : m.status === "confirmed"
                            ? "confirmed"
                            : "scheduled";

                    const line = `${icon} vs ${fmtPlayer(
                        opp
                    )}${scorePart}${proofPart} _(${statusText})_`;

                    if (!isNext) return [line];

                    return ["👉 **Next up**", line];
                });

                return { week, lines };
            });

        return { season, weeks };
    }

    /**
     * Get unreported matches before a specific week, grouped by week.
     * Excludes confirmed, void, and reported matches.
     * @param {{ guildId: string, week: number }} params
     * @returns {Promise<UnreportedMatchesResult>}
     * @throws {DomainError} If no season or invalid season state.
     */
    async getUnreportedBeforeWeek({ guildId, week = null }) {
        const season = await this.seasons.getCurrentForGuild(guildId);
        if (!season) throw new DomainError("NO_SEASON", "No season found.");

        const allowed = ["active", "signups_closed", "closed"];
        if (!allowed.includes(season.status)) {
            throw new DomainError(
                "INVALID_STATE",
                `Matches not available in this season state (current: ${season.status})`
            );
        }

        const cutoffWeek = Number(week ?? season.current_week ?? 1);
        if (!Number.isInteger(cutoffWeek) || cutoffWeek <= 1) {
            throw new DomainError(
                "INVALID_WEEK",
                "Week must be greater than 1 to check previous weeks."
            );
        }
        const currentWeek = Number(season.current_week ?? cutoffWeek);

        const matches = await this.matches.listUnreportedBeforeWeek({
            seasonId: season.id,
            week: cutoffWeek,
        });

        const divisions = await this.divisions.listForSeason(season.id);
        const divNameById = new Map(divisions.map((d) => [d.id, d.name]));

        const byWeek = new Map();
        for (const m of matches) {
            const w = m.week ?? 0;
            if (!byWeek.has(w)) byWeek.set(w, []);
            byWeek.get(w).push(m);
        }

        const weeks = [...byWeek.keys()]
            .sort((a, b) => a - b)
            .map((w) => {
                const ms = byWeek.get(w) ?? [];
                const displayMatches = ms.map((m) => {
                    const icon = statusIcon(m.status);
                    const a = fmtPlayer(m.player_a_id);
                    const b = fmtPlayer(m.player_b_id);
                    const mr = normalizeMatchResult(m);
                    const divName =
                        divNameById.get(m.division_id) ??
                        `Division ${m.division_id}`;

                    let scorePart = "";
                    if (mr) {
                        scorePart = ` — **${mr.legs_a}-${mr.legs_b}**`;
                    }

                    const statusText =
                        m.status === "reported"
                            ? "reported"
                            : m.status === "confirmed"
                            ? "confirmed"
                            : m.status === "disputed"
                            ? "disputed"
                            : "scheduled";

                    return {
                        id: m.id,
                        week: w,
                        divisionId: m.division_id,
                        divisionName: divName,
                        playerAId: m.player_a_id,
                        playerBId: m.player_b_id,
                        status: m.status,
                        line: `[${divName}] ${icon} ${a} vs ${b}${scorePart} _(${statusText})_`,
                    };
                });

                return {
                    week: w,
                    lines: displayMatches.map((match) => match.line),
                    matches: displayMatches,
                };
            });

        return { season, weeks, cutoffWeek, currentWeek };
    }
}
