import { DomainError } from "../utils/DomainError.js";
import { roundRobin } from "../utils/roundRobin.js";

export class ScheduleService {
    constructor({ seasons, divisions, schedules, matches }) {
        this.seasons = seasons;
        this.divisions = divisions;
        this.schedules = schedules;
        this.matches = matches;
    }

    async propose({ guildId, createdBy }) {
        const season = await this.seasons.getCurrentForGuild(guildId);
        if (!season) throw new DomainError("NO_SEASON", "No season found.");
        if (season.status !== "signups_closed") {
            throw new DomainError(
                "INVALID_STATE",
                "Close signups before scheduling."
            );
        }

        const grouped = await this.divisions.listAllDivisionPlayersForSeason(
            season.id
        );
        if (!grouped.length)
            throw new DomainError(
                "NO_DIVISIONS",
                "Create/assign divisions first."
            );

        const payload = {
            season_id: season.id,
            generated_at: new Date().toISOString(),
            divisions: grouped.map((g) => {
                const playerIds = g.players
                    .sort((a, b) => Number(b.seed_avg) - Number(a.seed_avg))
                    .map((p) => p.discord_user_id);

                return {
                    division_id: g.division.id,
                    division_name: g.division.name,
                    weeks: roundRobin(playerIds), // [[a,b], [c,d]] per week
                };
            }),
        };

        const proposal = await this.schedules.createProposal({
            seasonId: season.id,
            createdBy,
            payload,
        });

        return { season, proposal };
    }

    async approveLatest({ guildId }) {
        const season = await this.seasons.getCurrentForGuild(guildId);
        if (!season) throw new DomainError("NO_SEASON", "No season found.");

        const latest = await this.schedules.getLatestProposal(season.id);
        if (!latest)
            throw new DomainError("NO_PROPOSAL", "No schedule proposal found.");

        if (latest.status === "approved") {
            throw new DomainError(
                "ALREADY_APPROVED",
                "Latest proposal is already approved."
            );
        }

        // optional: wipe existing matches so approve is rerunnable
        await this.matches.clearForSeason(season.id);

        const payload = latest.payload;
        const rows = [];

        for (const div of payload.divisions) {
            div.weeks.forEach((pairs, weekIdx) => {
                const week = weekIdx + 1;
                pairs.forEach(([a, b]) => {
                    rows.push({
                        season_id: season.id,
                        division_id: div.division_id,
                        week,
                        player_a_id: a,
                        player_b_id: b,
                        status: "scheduled",
                    });
                });
            });
        }

        await this.matches.insertMany(rows);
        await this.schedules.markApproved(latest.id);

        return { season, createdMatches: rows.length };
    }
    async preview({ guildId, divisionName, week }) {
        const season = await this.seasons.getCurrentForGuild(guildId);
        if (!season) throw new DomainError("NO_SEASON", "No season found.");

        const proposal = await this.schedules.getLatestProposal(season.id);
        if (!proposal)
            throw new DomainError("NO_PROPOSAL", "No schedule proposal found.");

        const div = await this.divisions.getBySeasonAndName(
            season.id,
            divisionName
        );
        if (!div)
            throw new DomainError(
                "BAD_DIVISION",
                `Division not found: ${divisionName}`
            );

        const payloadDiv = proposal.payload.divisions.find(
            (d) => d.division_id === div.id
        );
        if (!payloadDiv)
            throw new DomainError(
                "BAD_DIVISION",
                "Division not present in proposal."
            );

        const weeks = payloadDiv.weeks;
        if (!Number.isInteger(week) || week < 1 || week > weeks.length) {
            throw new DomainError(
                "BAD_WEEK",
                `Week must be 1–${weeks.length}.`
            );
        }

        const pairs = weeks[week - 1]; // [[a,b], [c,d]]
        return {
            season,
            proposal,
            division: { id: div.id, name: payloadDiv.division_name },
            week,
            totalWeeks: weeks.length,
            pairs,
        };
    }
}
