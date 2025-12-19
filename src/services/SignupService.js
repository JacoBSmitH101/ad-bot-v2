import { DomainError } from "../utils/DomainError.js";

export class SignupService {
    constructor({ seasons, players, signups }) {
        this.seasons = seasons;
        this.players = players;
        this.signups = signups;
    }

    parseAvg(input) {
        const num = Number(input);
        if (!Number.isFinite(num)) return null;
        // keep 1 decimal for consistency
        return Math.round(num * 10) / 10;
    }
    async dropout({ guildId, discordUserId }) {
        const season = await this.seasons.getCurrentForGuild(guildId);
        if (!season)
            throw new DomainError("NO_SEASON", "No season exists yet.");

        if (season.status !== "signups_open") {
            throw new DomainError(
                "SIGNUPS_NOT_OPEN",
                "You can only drop out while signups are open."
            );
        }

        const existing = await this.signups.getBySeasonAndUser(
            season.id,
            discordUserId
        );
        if (!existing) {
            throw new DomainError(
                "NOT_SIGNED_UP",
                "You are not signed up for the current season."
            );
        }

        await this.signups.deleteBySeasonAndUser(season.id, discordUserId);

        return { season, previousAvg: Number(existing.avg_3dart) };
    }

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
                "Signups are not open right now."
            );
        }

        const avgNum = this.parseAvg(avg);
        if (avgNum === null)
            throw new DomainError("INVALID_AVG", "Average must be a number.");
        if (avgNum < 10 || avgNum > 120) {
            throw new DomainError(
                "INVALID_AVG",
                "Average must be between 10.0 and 120.0."
            );
        }
        const existing = await this.signups.getBySeasonAndUser(
            season.id,
            discordUserId
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
