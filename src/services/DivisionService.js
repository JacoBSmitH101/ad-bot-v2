import { DomainError } from "../utils/DomainError.js";
import { chunkDivisions } from "../utils/chunkDivisions.js";

/**
 * Service for managing division creation and player assignment.
 * Handles business logic for creating divisions and auto-assigning players
 * based on skill level.
 */
export class DivisionService {
    /**
     * @param {{ seasons: SeasonRepository, signups: SignupRepository, divisions: DivisionRepository }} deps
     * @param {SeasonRepository} deps.seasons Season repository instance.
     * @param {SignupRepository} deps.signups Signup repository instance.
     * @param {DivisionRepository} deps.divisions Division repository instance.
     */
    constructor({ seasons, signups, divisions }) {
        this.seasons = seasons;
        this.signups = signups;
        this.divisions = divisions;
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

        // Ensure high → low
        signups.sort((a, b) => Number(b.avg_3dart) - Number(a.avg_3dart));

        // Clear old assignments so this command is safe to rerun
        await this.divisions.clearPlayersForSeason(season.id);

        // Group into division chunks (Div1 top chunk, Div2 next...)
        const groups = chunkDivisions(signups, divs.length);

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
}
