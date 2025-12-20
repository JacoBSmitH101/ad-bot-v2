// src/services/ResultService.js
import { DomainError } from "../utils/DomainError.js";

export class ResultService {
    /**
     * @param {{ seasons: any, matches: any, matchResults: any, players: any }} deps
     */
    constructor({ seasons, matches, matchResults, players }) {
        this.seasons = seasons;
        this.matches = matches;
        this.matchResults = matchResults;
        this.players = players;
    }

    async submit({
        guildId,
        discordUserId,
        displayName,
        opponentDiscordUserId,
        legsYou,
        legsThem,
        proofUrl,
    }) {
        const season = await this.seasons.getCurrentForGuild(guildId);
        if (!season) throw new DomainError("NO_SEASON", "No season found.");

        if (season.status !== "active") {
            throw new DomainError(
                "INVALID_STATE",
                `Season must be active (current: ${season.status})`
            );
        }

        if (opponentDiscordUserId === discordUserId) {
            throw new DomainError(
                "INVALID_OPPONENT",
                "You can’t submit a result against yourself."
            );
        }

        this.#validateScore(legsYou, legsThem);

        // FK safety for reported_by
        await this.players.upsert({ discordUserId, displayName });

        // find candidate matches between the two players
        const candidates = await this.matches.findOpenMatchesBetweenPlayers({
            seasonId: season.id,
            userA: discordUserId,
            userB: opponentDiscordUserId,
        });

        if (candidates.length === 0) {
            throw new DomainError(
                "NO_MATCH",
                "No open match found between you and that opponent in the current season."
            );
        }

        const match = this.#pickBestCandidate(candidates, discordUserId);

        // don’t allow overwriting someone else’s report
        if (
            match.status === "reported" &&
            match.reported_by &&
            match.reported_by !== discordUserId
        ) {
            throw new DomainError(
                "ALREADY_REPORTED",
                "This match has already been reported by the other player and is awaiting verification."
            );
        }

        // save scoreline
        const result = await this.matchResults.upsert({
            matchId: match.id,
            legsA: legsYou,
            legsB: legsThem,
            proofUrl,
        });

        // set match to reported
        const updatedMatch = await this.matches.update(match.id, {
            status: "reported",
            reported_by: discordUserId,
            reported_at: new Date().toISOString(),
            confirmed_by: null,
            confirmed_at: null,
            disputed_at: null,
        });

        return { season, match: updatedMatch, result };
    }

    async confirm({ guildId, adminDiscordUserId, adminDisplayName, matchId }) {
        const season = await this.seasons.getCurrentForGuild(guildId);
        if (!season) throw new DomainError("NO_SEASON", "No season found.");
        if (season.status !== "active") {
            throw new DomainError(
                "INVALID_STATE",
                `Season must be active (current: ${season.status})`
            );
        }

        const match = await this.matches.getById(matchId);
        if (!match) throw new DomainError("NO_MATCH", "Match not found.");
        if (match.season_id !== season.id)
            throw new DomainError(
                "WRONG_SEASON",
                "Match is not in this season."
            );
        if (match.status !== "reported") {
            throw new DomainError(
                "NOT_REPORTED",
                `Match must be reported (current: ${match.status})`
            );
        }

        const result = await this.matchResults.getByMatchId(matchId);
        if (!result)
            throw new DomainError(
                "NO_RESULT",
                "No scoreline found for this match."
            );

        await this.players.upsert({
            discordUserId: adminDiscordUserId,
            displayName: adminDisplayName,
        });

        const updatedMatch = await this.matches.update(matchId, {
            status: "confirmed",
            confirmed_by: adminDiscordUserId,
            confirmed_at: new Date().toISOString(),
        });

        return { season, match: updatedMatch, result };
    }

    async reject({ guildId, adminDiscordUserId, adminDisplayName, matchId }) {
        const season = await this.seasons.getCurrentForGuild(guildId);
        if (!season) throw new DomainError("NO_SEASON", "No season found.");
        if (season.status !== "active") {
            throw new DomainError(
                "INVALID_STATE",
                `Season must be active (current: ${season.status})`
            );
        }

        const match = await this.matches.getById(matchId);
        if (!match) throw new DomainError("NO_MATCH", "Match not found.");
        if (match.season_id !== season.id)
            throw new DomainError(
                "WRONG_SEASON",
                "Match is not in this season."
            );
        if (match.status !== "reported") {
            throw new DomainError(
                "NOT_REPORTED",
                `Match must be reported (current: ${match.status})`
            );
        }

        await this.players.upsert({
            discordUserId: adminDiscordUserId,
            displayName: adminDisplayName,
        });

        await this.matchResults.deleteByMatchId(matchId);

        const updatedMatch = await this.matches.update(matchId, {
            status: "scheduled",
            reported_by: null,
            reported_at: null,
            confirmed_by: null,
            confirmed_at: null,
            disputed_at: null,
        });

        return { season, match: updatedMatch };
    }

    #pickBestCandidate(candidates, reporterId) {
        const priority = (m) => {
            if (m.status === "scheduled") return 0;
            if (
                m.status === "reported" &&
                (!m.reported_by || m.reported_by === reporterId)
            )
                return 1;
            if (m.status === "disputed") return 2;
            return 9;
        };

        return [...candidates].sort((a, b) => {
            const pa = priority(a);
            const pb = priority(b);
            if (pa !== pb) return pa - pb;
            return (a.week ?? 999) - (b.week ?? 999);
        })[0];
    }

    #validateScore(legsYou, legsThem) {
        const a = Number(legsYou);
        const b = Number(legsThem);

        if (!Number.isInteger(a) || !Number.isInteger(b)) {
            throw new DomainError(
                "INVALID_SCORE",
                "Legs must be whole numbers."
            );
        }
        if (a < 0 || b < 0) {
            throw new DomainError("INVALID_SCORE", "Legs cannot be negative.");
        }
        if (a === b) {
            throw new DomainError("INVALID_SCORE", "Score cannot be a draw.");
        }
        if (a > 10 || b > 10) {
            throw new DomainError("INVALID_SCORE", "Legs look too high.");
        }
        // optional: require someone hits 3/4/5 etc depending on format later
    }
}
