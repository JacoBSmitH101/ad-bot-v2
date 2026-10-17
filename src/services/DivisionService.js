import { DomainError } from "../utils/DomainError.js";
import { buildDivisionProposal } from "../utils/buildDivisionProposal.js";

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
                hasConfirmedResults: confirmed.length > 0,
            }))
            .sort(
                (a, b) =>
                    b.points - a.points ||
                    b.legDiff - a.legDiff ||
                    b.legsFor - a.legsFor ||
                    String(a.name).localeCompare(String(b.name))
            );
    }

    /** Shared read-only planner for graphic previews and explicit assignments. */
    async _buildProposal({ guildId, season, signups, divisionCount }) {
        const previousSeason = await this.seasons.getPreviousForGuild(guildId, season.created_at);
        const previousDivisions = previousSeason && ['active', 'closed'].includes(previousSeason.status)
            ? [...await this.divisions.listBySeason(previousSeason.id)].sort((a, b) => a.sort_order - b.sort_order) : [];
        const placementsByUser = new Map();
        const warnings = [];
        let previousSignups = [];
        if (previousDivisions.length) {
            const results = await Promise.all([
                this.signups.listBySeason(previousSeason.id),
                Promise.all(previousDivisions.map(division => this._getFinalTable({ seasonId: previousSeason.id, division }))),
            ]);
            previousSignups = results[0];
            results[1].forEach((table, i) => {
                const division = previousDivisions[i];
                if (!table.some(row => row.hasConfirmedResults)) warnings.push(division.name + ' has no confirmed results; roster continuity is used without promotion/relegation.');
                table.forEach((row, rank) => {
                    const placements = placementsByUser.get(row.discordUserId) ?? [];
                    placements.push({ divisionName: division.name, divisionSortOrder: division.sort_order,
                        rank: row.hasConfirmedResults ? rank + 1 : null, of: table.length });
                    placementsByUser.set(row.discordUserId, placements);
                });
            });
            if (previousSeason.status !== 'closed') warnings.push('The previous season is not closed. Movements are provisional, using confirmed results so far.');
        }
        const proposal = buildDivisionProposal({ signups, count: divisionCount, previousDivisions,
            placementsByUser, previousSignupIds: new Set(previousSignups.map(player => player.discord_user_id)) });
        proposal.warnings.push(...warnings);
        return proposal;
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
     * Auto-assign from the same protected-place proposal as the graphic preview.
     * Clears existing assignments before reassigning.
     * @param {{ guildId: string }} input
     * @returns {Promise<{season: Season, divisions: Array.<Division>, counts: Array.<number>}>}
     * @throws {DomainError} If signups not closed, no divisions exist, or too few players.
     */
    async assignAuto({ guildId }) {
        const season = await this._getSeasonOrThrow(guildId);
        this._assertSignupsClosed(season);

        const divs = [...await this.divisions.listBySeason(season.id)].sort((a, b) => a.sort_order - b.sort_order);
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

        const proposal = await this._buildProposal({
            guildId,
            season,
            signups,
            divisionCount: divs.length,
        });

        if (proposal.conflicts.length) throw new DomainError('PROPOSAL_CONFLICT', 'The proposed split has protected-place or movement conflicts. Review /divisions preview-auto before assigning.');
        const groups = proposal.groups;
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

        const proposal = await this._buildProposal({
            guildId,
            season,
            signups,
            divisionCount: count,
        });
        const maxAllowed = this._maxDivisionsAllowed(playerCount);
        const warnings = [...proposal.warnings];

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

        const existing = [...await this.divisions.listBySeason(season.id)].sort((a, b) => a.sort_order - b.sort_order);
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
            playerCount,
            ...proposal,
            warnings,
        };
    }
}
