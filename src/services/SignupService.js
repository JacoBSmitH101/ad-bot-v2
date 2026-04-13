import { DomainError } from "../utils/DomainError.js";

/**
 * Service for managing player signups for seasons.
 * Handles signup/dropout logic, validation, and player record management.
 */
export class SignupService {
    /**
     * @param {{ seasons: SeasonRepository, players: PlayersRepository, signups: SignupRepository }} deps
     * @param {SeasonRepository} deps.seasons Season repository instance.
     * @param {PlayersRepository} deps.players Player repository instance.
     * @param {SignupRepository} deps.signups Signup repository instance.
     */
    constructor({ seasons, players, signups }) {
        this.seasons = seasons;
        this.players = players;
        this.signups = signups;
    }

    /**
     * Parse and normalize average input to 1 decimal place.
     * @param {string|number} input
     * @returns {(number|null)} Parsed average or null if invalid.
     */
    parseAvg(input) {
        const num = Number(input);
        if (!Number.isFinite(num)) return null;
        // keep 1 decimal for consistency
        return Math.round(num * 10) / 10;
    }

    /**
     * Remove a player's signup from the current season.
     * Only allowed while signups are open.
     * @param {{ guildId: string, discordUserId: string }} params
     * @returns {Promise<{season: Season, previousAvg: number}>}
     * @throws {DomainError} If no season, signups not open, or player not signed up.
     */
    async dropout({ guildId, discordUserId }) {
        const season = await this.seasons.getCurrentForGuild(guildId);
        if (!season)
            throw new DomainError("NO_SEASON", "No season exists yet.");

        if (season.status !== "signups_open") {
            throw new DomainError(
                "SIGNUPS_NOT_OPEN",
                "You can only drop out while signups are open.",
            );
        }

        const existing = await this.signups.getBySeasonAndUser(
            season.id,
            discordUserId,
        );
        if (!existing) {
            throw new DomainError(
                "NOT_SIGNED_UP",
                "You are not signed up for the current season.",
            );
        }

        await this.signups.deleteBySeasonAndUser(season.id, discordUserId);

        return { season, previousAvg: Number(existing.avg_3dart) };
    }

    /**
     * Sign up a player for the current season or update their existing signup.
     * Validates average (10.0-120.0) and ensures player record exists.
     * @param {{ guildId: string, discordUserId: string, displayName: (string|null), avg: string|number }} params
     * @returns {Promise<{season: Season, signup: Signup, isUpdate: boolean, previousAvg: (number|null)}>}
     * @throws {DomainError} If no season, signups closed/not open, invalid average, or signups past close time.
     */
    async signup({ guildId, discordUserId, displayName, avg }) {
        const season = await this.seasons.getCurrentForGuild(guildId);
        if (!season)
            throw new DomainError("NO_SEASON", "No season exists yet.");

        // Lazy auto-close
        if (
            season.status === "signups_open" &&
            season.signups_close_at &&
            new Date() > new Date(season.signups_close_at)
        ) {
            // IMPORTANT: for now we just block and tell you signups closed.
            // Later we’ll add SeasonService.closeSignups() + repo updateStatus().
            throw new DomainError("SIGNUPS_CLOSED", "Signups are closed.");
        }

        if (season.status !== "signups_open") {
            throw new DomainError(
                "SIGNUPS_NOT_OPEN",
                "Signups are not open right now.",
            );
        }

        const avgNum = this.parseAvg(avg);
        if (avgNum === null)
            throw new DomainError("INVALID_AVG", "Average must be a number.");
        if (avgNum < 10 || avgNum > 120) {
            throw new DomainError(
                "INVALID_AVG",
                "Average must be between 10.0 and 120.0.",
            );
        }
        const existing = await this.signups.getBySeasonAndUser(
            season.id,
            discordUserId,
        );

        // Ensure player exists
        await this.players.upsert({ discordUserId, displayName });

        // Upsert signup (allows updating average)
        const signup = await this.signups.upsertSignup({
            seasonId: season.id,
            discordUserId,
            avg3dart: avgNum,
        });

        const isUpdate = !!existing;
        const previousAvg = existing ? Number(existing.avg_3dart) : null;

        return { season, signup, isUpdate, previousAvg };
    }
}
