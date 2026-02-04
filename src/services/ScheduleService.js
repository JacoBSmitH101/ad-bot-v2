import { DomainError } from "../utils/DomainError.js";
import { roundRobin } from "../utils/roundRobin.js";

/**
 * Service for generating and approving match schedules.
 * Creates round-robin schedules per division and manages schedule proposals.
 */
export class ScheduleService {
    /**
     * @param {{ seasons: SeasonRepository, divisions: DivisionRepository, schedules: ScheduleRepository, matches: MatchRepository, players: PlayersRepository }} deps
     * @param {SeasonRepository} deps.seasons Season repository instance.
     * @param {DivisionRepository} deps.divisions Division repository instance.
     * @param {ScheduleRepository} deps.schedules Schedule repository instance.
     * @param {MatchRepository} deps.matches Match repository instance.
     * @param {PlayersRepository} deps.players Players repository instance.
     */
    constructor({ seasons, divisions, schedules, matches, players }) {
        this.seasons = seasons;
        this.divisions = divisions;
        this.schedules = schedules;
        this.matches = matches;
        this.players = players;
    }

    /**
     * Generate a schedule proposal for the current season.
     * Creates round-robin pairings for each division.
     * @param {{ guildId: string, createdBy: string }} params
     * @returns {Promise<{season: Season, proposal: ScheduleProposal}>}
     * @throws {DomainError} If no season, signups not closed, or no divisions exist.
     */
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

    /**
     * Approve the latest schedule proposal and create matches.
     * Clears existing matches before creating new ones.
     * @param {{ guildId: string }} params
     * @returns {Promise<{season: Season, createdMatches: number}>}
     * @throws {DomainError} If no season, no proposal found, or proposal already approved.
     */
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
        const playerIds = new Set();

        for (const div of payload.divisions) {
            div.weeks.forEach((pairs, weekIdx) => {
                const week = weekIdx + 1;
                pairs.forEach(([a, b]) => {
                    playerIds.add(a);
                    playerIds.add(b);
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

        // Ensure all players exist in the players table before creating matches
        // This prevents issues where player IDs show instead of names in fixtures/stats
        for (const playerId of playerIds) {
            if (!playerId.startsWith("FAKE_")) {
                await this.players.upsert({
                    discordUserId: playerId,
                    displayName: null,
                });
            }
        }

        await this.matches.insertMany(rows);
        await this.schedules.markApproved(latest.id);

        return { season, createdMatches: rows.length };
    }

    /**
     * Preview a specific division and week from the latest schedule proposal.
     * @param {{ guildId: string, divisionName: string, week: number }} params
     * @returns {Promise<{season: Season, proposal: ScheduleProposal, division: {id: number, name: string}, week: number, totalWeeks: number, pairs: Array.<Array.<string>>}>}
     * @throws {DomainError} If no season, no proposal, division not found, or invalid week.
     */
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
