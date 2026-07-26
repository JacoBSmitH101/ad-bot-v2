import { DomainError } from "../utils/DomainError.js";
import { chunkDivisions } from "../utils/chunkDivisions.js";
import { suggestDivisionGroups } from "../utils/suggestDivisionGroups.js";

/**
 * Service for managing division creation and player assignment.
 * Handles business logic for creating divisions and auto-assigning players
 * based on skill level.
 */
export class DivisionService {
    /**
     * @param {{ seasons: SeasonRepository, signups: SignupRepository, divisions: DivisionRepository, divisionPlayers: DivisionPlayersRepository, matches: MatchRepository }} deps
     * @param {SeasonRepository} deps.seasons Season repository instance.
     * @param {SignupRepository} deps.signups Signup repository instance.
     * @param {DivisionRepository} deps.divisions Division repository instance.
     * @param {DivisionPlayersRepository} deps.divisionPlayers Division players repository instance.
     * @param {MatchRepository} deps.matches Match repository instance.
     */
    constructor({ seasons, signups, divisions, divisionPlayers, matches }) {
        this.seasons = seasons;
        this.signups = signups;
        this.divisions = divisions;
        this.divisionPlayers = divisionPlayers;
        this.matches = matches;
        this.MIN_PER_DIVISION = 7;
        this.MAX_DIVISIONS = 10;
    }

    /**
     * Get current season for guild or throw error.
     * @private
     * @param {string} guildId
     * @returns {Promise<Season>}
     * @throws {DomainError} If no season found.
     */
    async _getSeasonOrThrow(guildId) {
        const season = await this.seasons.getCurrentForGuild(guildId);
        if (!season) throw new DomainError("NO_SEASON", "No season found.");
        return season;
    }

    /**
     * Assert that signups are closed for the season.
     * @private
     * @param {Season} season
     * @throws {DomainError} If signups are not closed.
     */
    _assertSignupsClosed(season) {
        if (season.status !== "signups_closed") {
            throw new DomainError(
                "INVALID_STATE",
                `Signups must be closed first (current: ${season.status}).`
            );
        }
    }

    /**
     * Calculate maximum divisions allowed based on player count.
     * @private
     * @param {number} playerCount
     * @returns {number} Maximum divisions allowed (minimum 1).
     */
    _maxDivisionsAllowed(playerCount) {
        // Enforce min players per division, but never allow 0 divisions
        return Math.max(1, Math.floor(playerCount / this.MIN_PER_DIVISION));
    }

    /**
     * Calculate a final table using the same confirmed-result rules as the site.
     * @private
     * @param {{ seasonId: string|number, division: Division }} input
     * @returns {Promise<Array.<{discordUserId: string}>>}
     */
    async _getFinalTable({ seasonId, division }) {
        const [roster, confirmed] = await Promise.all([
            this.divisionPlayers.listPlayersForDivision(division.id),
            this.matches.listConfirmedWithResultsForDivision({
                seasonId,
                divisionId: division.id,
            }),
        ]);
        const table = new Map();

        roster.forEach((player) => {
            table.set(player.discord_user_id, {
                discordUserId: player.discord_user_id,
                name: player.display_name ?? player.discord_user_id,
                legsFor: 0,
                legsAgainst: 0,
                points: 0,
            });
        });

        confirmed.forEach((match) => {
            const result = Array.isArray(match.match_results)
                ? match.match_results[0]
                : match.match_results;
            const playerA = table.get(match.player_a_id);
            const playerB = table.get(match.player_b_id);
            if (!result || !playerA || !playerB) return;

            const legsA = Number(result.legs_a);
            const legsB = Number(result.legs_b);
            playerA.legsFor += legsA;
            playerA.legsAgainst += legsB;
            playerB.legsFor += legsB;
            playerB.legsAgainst += legsA;
            playerA.points += legsA + (legsA > legsB ? 2 : 0);
            playerB.points += legsB + (legsB > legsA ? 2 : 0);
        });

        return [...table.values()]
            .map((row) => ({
                ...row,
                legDiff: row.legsFor - row.legsAgainst,
            }))
            .sort(
                (a, b) =>
                    b.points - a.points ||
                    b.legDiff - a.legDiff ||
                    b.legsFor - a.legsFor ||
                    String(a.name).localeCompare(String(b.name))
            );
    }

    /**
     * Build automatic groups using last season when its division count matches.
     * Falls back to average-only grouping when there is no comparable season.
     * @private
     * @param {{ guildId: string, season: Season, signups: Array.<Signup>, divisionCount: number }} input
     * @returns {Promise<Array.<Array.<Signup>>>}
     */
    async _buildAutoGroups({ guildId, season, signups, divisionCount }) {
        const averageGroups = () => {
            const sorted = [...signups].sort(
                (a, b) => Number(b.avg_3dart) - Number(a.avg_3dart)
            );
            return chunkDivisions(sorted, divisionCount);
        };

        const previousSeason = await this.seasons.getPreviousForGuild(
            guildId,
            season.created_at
        );
        if (!previousSeason) return averageGroups();

        const previousDivisions = await this.divisions.listBySeason(
            previousSeason.id
        );
        if (previousDivisions.length !== divisionCount) return averageGroups();

        const [previousSignups, finalTables] = await Promise.all([
            this.signups.listBySeason(previousSeason.id),
            Promise.all(
                previousDivisions.map((division) =>
                    this._getFinalTable({
                        seasonId: previousSeason.id,
                        division,
                    })
                )
            ),
        ]);
        const placementsByUser = new Map();

        finalTables.forEach((table, divisionIndex) => {
            const division = previousDivisions[divisionIndex];
            table.forEach((row, rankIndex) => {
                const placements =
                    placementsByUser.get(row.discordUserId) ?? [];
                placements.push({
                    divisionName: division.name,
                    divisionSortOrder: division.sort_order,
                    rank: rankIndex + 1,
                    of: table.length,
                });
                placementsByUser.set(row.discordUserId, placements);
            });
        });

        const signupsInSiteOrder = [...signups].sort((a, b) =>
            String(a.created_at).localeCompare(String(b.created_at))
        );

        return suggestDivisionGroups({
            signups: signupsInSiteOrder,
            previousSignupIds: new Set(
                previousSignups.map((signup) => signup.discord_user_id)
            ),
            previousDivisions,
            placementsByUser,
        });
    }

    /**
     * Create divisions for the current season.
     * Requires signups to be closed and validates player count.
     * @param {{ guildId: string, count: number }} input
     * @returns {Promise<{season: Season, divisions: Array.<Division>}>}
     * @throws {DomainError} If signups not closed, invalid count, too few players, or divisions already exist.
     */
    async createDivisions({ guildId, count }) {
        const season = await this._getSeasonOrThrow(guildId);
        this._assertSignupsClosed(season);

        if (
            !Number.isInteger(count) ||
            count < 1 ||
            count > this.MAX_DIVISIONS
        ) {
            throw new DomainError(
                "INVALID_COUNT",
                `Division count must be 1–${this.MAX_DIVISIONS}.`
            );
        }

        const signups = await this.signups.listBySeason(season.id);
        const playerCount = signups.length;

        if (playerCount < this.MIN_PER_DIVISION) {
            throw new DomainError(
                "TOO_FEW_PLAYERS",
                `Need at least ${this.MIN_PER_DIVISION} players before creating divisions.`
            );
        }

        const maxAllowed = this._maxDivisionsAllowed(playerCount);

        if (count > maxAllowed) {
            throw new DomainError(
                "DIVISION_TOO_SMALL",
                `With ${playerCount} players and a minimum of ${this.MIN_PER_DIVISION} per division, max divisions is ${maxAllowed}.`
            );
        }

        // Optional: prevent duplicates by checking if divisions already exist
        const existing = await this.divisions.listBySeason(season.id);
        if (existing.length) {
            throw new DomainError(
                "DIVISIONS_EXIST",
                "Divisions already exist for this season. (Add a reset command later if you want.)"
            );
        }

        const created = await this.divisions.createMany({
            seasonId: season.id,
            count,
        });
        return { season, divisions: created };
    }

    /**
     * Auto-assign players into divisions by skill grouping.
     * Div 1 gets highest averages, Div 2 next, etc.
     * Clears existing assignments before reassigning.
     * @param {{ guildId: string }} input
     * @returns {Promise<{season: Season, divisions: Array.<Division>, counts: Array.<number>}>}
     * @throws {DomainError} If signups not closed, no divisions exist, or too few players.
     */
    async assignAuto({ guildId }) {
        const season = await this._getSeasonOrThrow(guildId);
        this._assertSignupsClosed(season);

        const divs = await this.divisions.listBySeason(season.id);
        if (!divs.length) {
            throw new DomainError("NO_DIVISIONS", "Create divisions first.");
        }

        const signups = await this.signups.listBySeason(season.id);
        const playerCount = signups.length;

        if (playerCount < this.MIN_PER_DIVISION) {
            throw new DomainError(
                "TOO_FEW_PLAYERS",
                `Need at least ${this.MIN_PER_DIVISION} players before assigning divisions.`
            );
        }

        const maxAllowed = this._maxDivisionsAllowed(playerCount);
        if (divs.length > maxAllowed) {
            throw new DomainError(
                "DIVISION_TOO_SMALL",
                `With ${playerCount} players and min ${this.MIN_PER_DIVISION} per division, max divisions is ${maxAllowed}.`
            );
        }

        const groups = await this._buildAutoGroups({
            guildId,
            season,
            signups,
            divisionCount: divs.length,
        });

        // Clear old assignments only after the replacement groups are ready.
        await this.divisions.clearPlayersForSeason(season.id);

        // Write division_players rows
        const rows = [];
        let seedRank = 1;

        for (let i = 0; i < divs.length; i++) {
            const division = divs[i];
            for (const p of groups[i]) {
                rows.push({
                    division_id: division.id,
                    discord_user_id: p.discord_user_id,
                    seed_avg: Number(p.avg_3dart),
                    seed_rank: seedRank++,
                });
            }
        }

        await this.divisions.addPlayersBulk(rows);

        return {
            season,
            divisions: divs,
            counts: groups.map((g) => g.length),
        };
    }

    /**
     * Manually assign a list of players to a specific division.
     * Removes those players from any other division in the season first.
     * @param {{ guildId: string, divisionName: string, discordUserIds: Array.<string> }} input
     * @returns {Promise<{season: Season, division: Division, count: number}>}
     */
    async assignManual({ guildId, divisionName, discordUserIds }) {
        const season = await this._getSeasonOrThrow(guildId);
        this._assertSignupsClosed(season);

        const ids = Array.from(new Set((discordUserIds ?? []).filter(Boolean)));
        if (!ids.length) {
            throw new DomainError(
                "NO_PLAYERS",
                "Provide at least one player to assign."
            );
        }

        // Allow shorthand: "1" -> "Div 1"
        const normalizedDivisionName =
            /^\d+$/.test(String(divisionName).trim())
                ? `Div ${String(divisionName).trim()}`
                : String(divisionName).trim();

        const division = await this.divisions.getBySeasonAndName(
            season.id,
            normalizedDivisionName
        );
        if (!division) {
            throw new DomainError(
                "NO_DIVISION",
                `Division "${normalizedDivisionName}" not found for this season.`
            );
        }

        // Validate all users are signed up so we can seed_avg consistently
        const signups = await this.signups.listBySeason(season.id);
        const avgByUser = new Map(
            signups.map((s) => [s.discord_user_id, Number(s.avg_3dart)])
        );

        const missing = ids.filter((id) => !avgByUser.has(id));
        if (missing.length) {
            throw new DomainError(
                "NOT_SIGNED_UP",
                `These users are not signed up for the current season: ${missing
                    .map((id) => `<@${id}>`)
                    .join(", ")}`
            );
        }

        // Remove existing memberships for these players across the season
        await this.divisions.removePlayersForSeason(season.id, ids);

        const rows = ids.map((discord_user_id, i) => ({
            division_id: division.id,
            discord_user_id,
            seed_avg: avgByUser.get(discord_user_id) ?? null,
            seed_rank: i + 1,
        }));

        await this.divisions.addPlayersBulk(rows);

        return { season, division, count: ids.length };
    }

    /**
     * Preview auto-assignment without writing to the database.
     * Allows previewing while signups are open.
     * @param {{ guildId: string, count: number }} input
     * @returns {Promise<{season: Season, divisions: Array.<Division>, counts: Array.<number>, warnings: Array.<string>, playerCount: number}>}
     * @throws {DomainError} If invalid count or no signups.
     */
    async previewAuto({ guildId, count }) {
        const season = await this._getSeasonOrThrow(guildId);

        if (
            !Number.isInteger(count) ||
            count < 1 ||
            count > this.MAX_DIVISIONS
        ) {
            throw new DomainError(
                "INVALID_COUNT",
                `Division count must be 1–${this.MAX_DIVISIONS}.`
            );
        }

        const signups = await this.signups.listBySeason(season.id);
        const playerCount = signups.length;

        if (!playerCount) {
            throw new DomainError("NO_SIGNUPS", "No signups yet.");
        }

        const groups = await this._buildAutoGroups({
            guildId,
            season,
            signups,
            divisionCount: count,
        });
        const maxAllowed = this._maxDivisionsAllowed(playerCount);
        const warnings = [];

        if (playerCount < this.MIN_PER_DIVISION) {
            warnings.push(
                `Need at least ${this.MIN_PER_DIVISION} players before creating/assigning divisions.`
            );
        }

        if (count > maxAllowed) {
            warnings.push(
                `With ${playerCount} players and min ${this.MIN_PER_DIVISION} per division, max divisions is ${maxAllowed}.`
            );
        }

        const existing = await this.divisions.listBySeason(season.id);
        const divisions =
            existing.length === count
                ? existing
                : Array.from({ length: count }, (_, i) => ({
                      name: `Div ${i + 1}`,
                      sort_order: i + 1,
                  }));

        return {
            season,
            divisions,
            counts: groups.map((g) => g.length),
            warnings,
            playerCount,
        };
    }
}
