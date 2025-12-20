// src/services/MatchesService.js
import { DomainError } from "../utils/DomainError.js";

function fmtPlayer(id) {
    return id.startsWith("FAKE_") ? `\`${id}\`` : `<@${id}>`;
}

function statusIcon(status) {
    if (status === "confirmed") return "🟢";
    if (status === "reported") return "🟠";
    return "🗓️";
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

export class MatchesService {
    /**
     * @param {{ seasons: any, matches: any }} deps
     */
    constructor({ seasons, matches }) {
        this.seasons = seasons;
        this.matches = matches;
    }

    async getMyMatches({ guildId, discordUserId }) {
        const season = await this.seasons.getCurrentForGuild(guildId);
        if (!season) throw new DomainError("NO_SEASON", "No season found.");

        // allow during active (and optionally signups_closed if you already generated schedule)
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

        // group by week
        const byWeek = new Map();
        for (const m of matches) {
            const week = m.week ?? 0;
            if (!byWeek.has(week)) byWeek.set(week, []);
            byWeek.get(week).push(m);
        }

        // build rows
        const weeks = [...byWeek.keys()]
            .sort((a, b) => a - b)
            .map((week) => {
                const ms = byWeek.get(week);

                const lines = ms.flatMap((m) => {
                    const isNext = m.id === nextMatchId;

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
                            proofPart = ` ([proof](${mr.proof_url}))`;
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

                    // 👇 highlight next match ABOVE it
                    return ["👉 **Next up**", line];
                });

                return { week, lines };
            });

        const nextMatch = matches
            .filter((m) => m.status !== "confirmed")
            .sort((a, b) => (a.week ?? 0) - (b.week ?? 0))[0];

        const nextMatchId = nextMatch?.id ?? null;

        return { season, weeks };
    }
}
