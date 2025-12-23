import { DomainError } from "../utils/DomainError.js";

/**
 * Service for managing season lifecycle and state transitions.
 * Handles creation, opening/closing signups, and starting/closing seasons.
 */
export class SeasonService {
    /**
     * @param {{ seasons: SeasonRepository, signups: SignupRepository, matches: MatchRepository }} deps
     * @param {SeasonRepository} deps.seasons Season repository instance.
     * @param {SignupRepository} deps.signups Signup repository instance.
     * @param {MatchRepository} deps.matches Match repository instance.
     */
    constructor({ seasons, signups, matches }) {
        this.seasons = seasons;
        this.signups = signups;
        this.matches = matches;
    }

    /**
     * Start a season (move from signups_closed to active).
     * Requires an approved schedule (matches must exist).
     * @param {{ guildId: string }} params
     * @returns {Promise<Season>}
     * @throws {DomainError} If no season, wrong status, or no schedule approved.
     */
    async startSeason({ guildId }) {
        const season = await this.seasons.getCurrentForGuild(guildId);
        if (!season) throw new DomainError("NO_SEASON", "No season found.");

        if (season.status !== "signups_closed") {
            throw new DomainError(
                "INVALID_STATE",
                `Season must be signups_closed (current: ${season.status})`
            );
        }

        // Make sure matches exist
        const matchCount = await this.matches.countForSeason(season.id);
        if (matchCount === 0) {
            throw new DomainError(
                "NO_SCHEDULE",
                "No schedule found. Approve a schedule first."
            );
        }

        return this.seasons.setSeasonInProgress(season.id);
    }

    /**
     * Create a season in draft state.
     * @param {{ guildId: string, name: string }} input
     * @returns {Promise<Season>}
     * @throws {DomainError} If season name is too short or too long.
     */
    async createSeason({ guildId, name }) {
        const cleanName = (name ?? "").trim();

        if (cleanName.length < 2) {
            throw new DomainError(
                "INVALID_SEASON_NAME",
                "Season name is too short."
            );
        }
        if (cleanName.length > 64) {
            throw new DomainError(
                "INVALID_SEASON_NAME",
                "Season name is too long."
            );
        }

        // Optional guardrail: don’t allow multiple ACTIVE seasons in the same guild.
        // This is a soft rule we can enforce later once we add more repo methods.
        // For now, keep it simple and just create.
        return this.seasons.create({ guildId, name: cleanName });
    }

    /**
     * Open signups for a season (move from draft/signups_closed to signups_open).
     * Optionally set a close timestamp.
     * @param {{ guildId: string, closeAt: (string|null) }} params
     * @returns {Promise<Season>}
     * @throws {DomainError} If no season or invalid state.
     */
    async openSignups({ guildId, closeAt = null }) {
        const season = await this.seasons.getCurrentForGuild(guildId);
        if (!season)
            throw new DomainError("NO_SEASON", "No season exists yet.");

        if (
            !(season.status === "draft" || season.status === "signups_closed")
        ) {
            throw new DomainError(
                "INVALID_STATE",
                `Can't open signups from state: ${season.status}`
            );
        }

        // Optional: set/clear close time
        if (closeAt !== undefined) {
            await this.seasons.setSignupsCloseAt(season.id, closeAt);
        }

        return this.seasons.updateStatus(season.id, "signups_open");
    }

    /**
     * Close signups for a season (move from signups_open to signups_closed).
     * @param {{ guildId: string }} params
     * @returns {Promise<Season>}
     * @throws {DomainError} If no season or signups not open.
     */
    async closeSignups({ guildId }) {
        const season = await this.seasons.getCurrentForGuild(guildId);
        if (!season)
            throw new DomainError("NO_SEASON", "No season exists yet.");

        if (season.status !== "signups_open") {
            throw new DomainError(
                "INVALID_STATE",
                `Signups are not open (current: ${season.status})`
            );
        }

        return this.seasons.updateStatus(season.id, "signups_closed");
    }

    /**
     * Close a season (move from active to closed).
     * @param {{ guildId: string }} params
     * @returns {Promise<Season>}
     * @throws {DomainError} If no season or season not active.
     */
    async closeSeason({ guildId }) {
        const season = await this.seasons.getCurrentForGuild(guildId);
        if (!season) throw new DomainError("NO_SEASON", "No season found.");

        if (season.status !== "active") {
            throw new DomainError(
                "INVALID_STATE",
                `Season must be active to close (current: ${season.status})`
            );
        }

        return this.seasons.updateStatus(season.id, "closed");
    }
}
