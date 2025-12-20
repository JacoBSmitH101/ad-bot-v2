import { DomainError } from "../utils/DomainError.js";

export class SeasonService {
    /**
     * @param {{ seasons: any }} deps
     */
    constructor({ seasons, signups, matches }) {
        this.seasons = seasons;
        this.signups = signups;
        this.matches = matches;
    }

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
     * Create a season in draft state
     * @param {{ guildId: string, name: string }} input
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
}
