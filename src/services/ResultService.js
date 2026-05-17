import { DomainError } from "../utils/DomainError.js";

/**
 * Service for submitting, confirming, and managing match results.
 * Handles result validation, match state transitions, and admin operations.
 */
export class ResultService {
    /**
     * @param {{ seasons: SeasonRepository, matches: MatchRepository, matchResults: MatchResultRepository, players: PlayersRepository }} deps
     * @param {SeasonRepository} deps.seasons Season repository instance.
     * @param {MatchRepository} deps.matches Match repository instance.
     * @param {MatchResultRepository} deps.matchResults Match result repository instance.
     * @param {PlayersRepository} deps.players Player repository instance.
     */
    constructor({ seasons, matches, matchResults, players }) {
        this.seasons = seasons;
        this.matches = matches;
        this.matchResults = matchResults;
        this.players = players;
    }

    /**
     * Submit a match result for verification.
     * Finds the best matching open match and marks it as reported.
     * @param {{ guildId: string, discordUserId: string, displayName: (string|null), opponentDiscordUserId: string, legsYou: number, legsThem: number, proofUrl: string }} params
     * @returns {Promise<{season: Season, match: Match, result: MatchResult}>}
     * @throws {DomainError} If no season, season not active, invalid opponent, invalid score, no match found, or already reported by other player.
     */
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

        const submitterIsA = match.player_a_id === discordUserId;
        const submitterIsB = match.player_b_id === discordUserId;

        // safety: should always be true because we queried between the two, but keep it robust
        if (!submitterIsA && !submitterIsB) {
            throw new DomainError(
                "NOT_IN_MATCH",
                "You are not a player in this match."
            );
        }

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

        // ✅ Map submitter's "you/them" onto correct A–B orientation
        // If submitter is A: (A,B) = (you,them)
        // If submitter is B: (A,B) = (them,you)
        const legsA = submitterIsA ? legsYou : legsThem;
        const legsB = submitterIsA ? legsThem : legsYou;

        // save scoreline (stored as A-B, always)
        const result = await this.matchResults.upsert({
            matchId: match.id,
            legsA,
            legsB,
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

        // #region agent log
        fetch(
            "http://127.0.0.1:7242/ingest/dd387cc0-3ef6-4629-9ef1-f5bce1d079ff",
            {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    sessionId: "debug-session",
                    runId: "post-fix",
                    hypothesisId: "H1",
                    location: "ResultService.submit",
                    message: "submit returning payload",
                    data: {
                        matchIsArray: Array.isArray(updatedMatch),
                        matchType: typeof updatedMatch,
                        matchId: updatedMatch?.id ?? null,
                    },
                    timestamp: Date.now(),
                }),
            }
        ).catch(() => {});
        // #endregion

        return { season, match: updatedMatch, result };
    }

    /**
     * Confirm a reported match result (admin action).
     * Moves match from reported to confirmed status.
     * @param {{ guildId: string, adminDiscordUserId: string, adminDisplayName: string, matchId: string|number }} params
     * @returns {Promise<{season: Season, match: Match, result: MatchResult}>}
     * @throws {DomainError} If no season, season not active, match not found, wrong season, or match not reported.
     */
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

    /**
     * Reject a reported match result (admin action).
     * Deletes the result and resets match to scheduled status.
     * @param {{ guildId: string, adminDiscordUserId: string, adminDisplayName: string, matchId: string|number }} params
     * @returns {Promise<{season: Season, match: Match}>}
     * @throws {DomainError} If no season, season not active, match not found, wrong season, or match not reported.
     */
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

    /**
     * Pick the best candidate match from multiple options.
     * Prioritizes scheduled > reported (by same reporter) > disputed.
     * @private
     * @param {Array.<Match>} candidates
     * @param {string} reporterId
     * @returns {Match}
     */
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

    /**
     * Validate match score format and values.
     * @private
     * @param {number} legsYou
     * @param {number} legsThem
     * @throws {DomainError} If score is invalid (non-integer, negative, draw, or too high).
     */
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

    /**
     * Edit a match result (admin action).
     * Can edit results for reported/confirmed/disputed matches.
     * @param {{ guildId: string, adminDiscordUserId: string, adminDisplayName: string, matchId: string|number, legsA: number, legsB: number, proofUrl: (string|null) }} params
     * @returns {Promise<{season: Season, match: Match, result: MatchResult}>}
     * @throws {DomainError} If no season, match wrong season, invalid state, or invalid score.
     */
    async adminEditResult({
        guildId,
        adminDiscordUserId,
        adminDisplayName,
        matchId,
        legsA,
        legsB,
        proofUrl = null,
    }) {
        const season = await this.seasons.getCurrentForGuild(guildId);
        if (!season) throw new DomainError("NO_SEASON", "No season found.");
        const match = await this.matches.getById(matchId);

        if (match.season_id !== season.id) {
            throw new DomainError(
                "WRONG_SEASON",
                "That match is not in the current season."
            );
        }

        if (!["reported", "confirmed", "disputed"].includes(match.status)) {
            throw new DomainError(
                "INVALID_STATE",
                `Can only edit results for reported/confirmed/disputed matches (current: ${match.status})`
            );
        }

        // reuse your existing validation rules
        this.#validateScore(legsA, legsB);

        // FK safety if you ever use confirmed_by / audit later
        await this.players.upsert({
            discordUserId: adminDiscordUserId,
            displayName: adminDisplayName,
        });

        const updatedResult = await this.matchResults.upsert({
            matchId: match.id,
            legsA,
            legsB,
            proofUrl,
        });

        // no need to update matches table unless you're changing status/timestamps/etc
        return { season, match, result: updatedResult };
    }

    /**
     * Submit a match result on behalf of two players (admin action).
     * Finds the match between the two players and submits the result.
     * @param {{ guildId: string, adminDiscordUserId: string, adminDisplayName: string, playerAId: string, playerBId: string, legsA: number, legsB: number, proofUrl: (string|null), autoConfirm: boolean }} params
     * @returns {Promise<{season: Season, match: Match, result: MatchResult}>}
     * @throws {DomainError} If no season, season not active, invalid players, invalid score, no match found, or already reported.
     */
    async adminSubmitResult({
        guildId,
        adminDiscordUserId,
        adminDisplayName,
        playerAId,
        playerBId,
        legsA,
        legsB,
        proofUrl,
        autoConfirm = false,
    }) {
        const season = await this.seasons.getCurrentForGuild(guildId);
        if (!season) throw new DomainError("NO_SEASON", "No season found.");

        if (season.status !== "active") {
            throw new DomainError(
                "INVALID_STATE",
                `Season must be active (current: ${season.status})`
            );
        }

        if (playerAId === playerBId) {
            throw new DomainError(
                "INVALID_OPPONENT",
                "Players must be different."
            );
        }

        this.#validateScore(legsA, legsB);

        // FK safety for reported_by and confirmed_by
        await this.players.upsert({
            discordUserId: adminDiscordUserId,
            displayName: adminDisplayName,
        });
        await this.players.ensureExists({ discordUserId: playerAId });
        await this.players.ensureExists({ discordUserId: playerBId });

        // find candidate matches between the two players
        const candidates = await this.matches.findOpenMatchesBetweenPlayers({
            seasonId: season.id,
            userA: playerAId,
            userB: playerBId,
        });

        if (candidates.length === 0) {
            throw new DomainError(
                "NO_MATCH",
                "No open match found between these players in the current season."
            );
        }

        // Pick the best candidate (scheduled > reported > disputed)
        const match = this.#pickBestCandidate(candidates, playerAId);

        // Verify the match has the correct players
        const matchHasCorrectPlayers =
            (match.player_a_id === playerAId && match.player_b_id === playerBId) ||
            (match.player_a_id === playerBId && match.player_b_id === playerAId);

        if (!matchHasCorrectPlayers) {
            throw new DomainError(
                "MATCH_MISMATCH",
                "Match found does not match the specified players."
            );
        }

        // don't allow overwriting someone else's report (unless admin is overriding)
        if (
            match.status === "reported" &&
            match.reported_by &&
            match.reported_by !== adminDiscordUserId
        ) {
            throw new DomainError(
                "ALREADY_REPORTED",
                "This match has already been reported by another user and is awaiting verification."
            );
        }

        // Ensure legsA and legsB match the match's player_a_id and player_b_id orientation
        // If match has playerA as A, use legsA/legsB as-is
        // If match has playerA as B, swap them
        const finalLegsA =
            match.player_a_id === playerAId ? legsA : legsB;
        const finalLegsB =
            match.player_a_id === playerAId ? legsB : legsA;

        // save scoreline (stored as A-B, always)
        const result = await this.matchResults.upsert({
            matchId: match.id,
            legsA: finalLegsA,
            legsB: finalLegsB,
            proofUrl,
        });

        // set match to reported (or confirmed if autoConfirm is true)
        const status = autoConfirm ? "confirmed" : "reported";
        const patch = {
            status,
            reported_by: adminDiscordUserId,
            reported_at: new Date().toISOString(),
        };

        if (autoConfirm) {
            patch.confirmed_by = adminDiscordUserId;
            patch.confirmed_at = new Date().toISOString();
        } else {
            patch.confirmed_by = null;
            patch.confirmed_at = null;
        }

        patch.disputed_at = null;

        const updatedMatch = await this.matches.update(match.id, patch);

        return { season, match: updatedMatch, result };
    }

    /**
     * Forfeit all open matches for a player as 4–0 losses (admin action).
     * Applies to the current active season only. For each scheduled/reported/disputed
     * match involving the player, creates/overwrites a result where the player
     * loses 0–4 and the opponent wins 4–0, and marks the match as confirmed.
     *
     * @param {{ guildId: string, adminDiscordUserId: string, adminDisplayName: string, forfeitingPlayerId: string }} params
     * @returns {Promise<{ season: Season, updated: Array<{ match: Match, result: MatchResult }> }>}
     * @throws {DomainError} If no active season is found.
     */
    async adminForfeitAllMatchesForPlayer({
        guildId,
        adminDiscordUserId,
        adminDisplayName,
        forfeitingPlayerId,
    }) {
        const season = await this.seasons.getCurrentForGuild(guildId);
        if (!season) throw new DomainError("NO_SEASON", "No season found.");
        if (season.status !== "active") {
            throw new DomainError(
                "INVALID_STATE",
                `Season must be active (current: ${season.status})`
            );
        }

        // Ensure admin exists in players table for FK / audit safety
        await this.players.upsert({
            discordUserId: adminDiscordUserId,
            displayName: adminDisplayName,
        });

        // Get all matches for this player in the current season
        const allMatches =
            await this.matches.listForPlayerInSeasonWithResults({
                seasonId: season.id,
                discordUserId: forfeitingPlayerId,
            });

        // Filter to only matches that are not already confirmed or void
        const targetStatuses = new Set(["scheduled", "reported", "disputed"]);
        const targets = allMatches.filter((m) =>
            targetStatuses.has(m.status)
        );

        const updated = [];

        for (const match of targets) {
            // Determine orientation and assign 0–4 to forfeiting player
            const forfeiterIsA = match.player_a_id === forfeitingPlayerId;
            const legsA = forfeiterIsA ? 0 : 4;
            const legsB = forfeiterIsA ? 4 : 0;

            const result = await this.matchResults.upsert({
                matchId: match.id,
                legsA,
                legsB,
                proofUrl: null,
            });

            const updatedMatch = await this.matches.update(match.id, {
                status: "confirmed",
                reported_by: adminDiscordUserId,
                reported_at: new Date().toISOString(),
                confirmed_by: adminDiscordUserId,
                confirmed_at: new Date().toISOString(),
                disputed_at: null,
            });

            updated.push({ match: updatedMatch, result });
        }

        return { season, updated };
    }

    /**
     * Reset a match to scheduled status (admin action).
     * Deletes the result and optionally clears result message references.
     * @param {{ guildId: string, adminDiscordUserId: string, adminDisplayName: string, matchId: string|number, clearResultMessage: boolean }} params
     * @returns {Promise<{season: Season, match: Match}>}
     * @throws {DomainError} If no season or match wrong season.
     */
    async adminResetMatch({
        guildId,
        adminDiscordUserId,
        adminDisplayName,
        matchId,
        clearResultMessage = false,
    }) {
        const season = await this.seasons.getCurrentForGuild(guildId);
        if (!season) throw new DomainError("NO_SEASON", "No season found.");

        const match = await this.matches.getById(matchId);

        if (match.season_id !== season.id) {
            throw new DomainError(
                "WRONG_SEASON",
                "That match is not in the current season."
            );
        }

        // delete the stored result
        await this.matchResults.deleteByMatchId(match.id);

        await this.players.upsert({
            discordUserId: adminDiscordUserId,
            displayName: adminDisplayName,
        });

        const patch = {
            status: "scheduled",
            reported_by: null,
            reported_at: null,
            confirmed_by: null,
            confirmed_at: null,
            disputed_at: null,
        };

        if (clearResultMessage) {
            patch.result_channel_id = null;
            patch.result_message_id = null;
        }

        const updatedMatch = await this.matches.update(match.id, patch);

        return { season, match: updatedMatch };
    }

    /**
     * Void a match (admin action).
     * Deletes the result and sets match status to void (no points awarded).
     * @param {{ guildId: string, adminDiscordUserId: string, adminDisplayName: string, matchId: string|number, clearResultMessage: boolean }} params
     * @returns {Promise<{season: Season, match: Match}>}
     * @throws {DomainError} If no season or match wrong season.
     */
    async adminVoidMatch({
        guildId,
        adminDiscordUserId,
        adminDisplayName,
        matchId,
        clearResultMessage = false,
    }) {
        const season = await this.seasons.getCurrentForGuild(guildId);
        if (!season) throw new DomainError("NO_SEASON", "No season found.");

        const match = await this.matches.getById(matchId);

        if (match.season_id !== season.id) {
            throw new DomainError(
                "WRONG_SEASON",
                "That match is not in the current season."
            );
        }

        // void means no points from it → easiest is to delete match_results
        await this.matchResults.deleteByMatchId(match.id);

        await this.players.upsert({
            discordUserId: adminDiscordUserId,
            displayName: adminDisplayName,
        });

        const patch = {
            status: "void",
            reported_by: null,
            reported_at: null,
            confirmed_by: null,
            confirmed_at: null,
            disputed_at: null,
        };

        if (clearResultMessage) {
            patch.result_channel_id = null;
            patch.result_message_id = null;
        }

        const updatedMatch = await this.matches.update(match.id, patch);

        return { season, match: updatedMatch };
    }
}
