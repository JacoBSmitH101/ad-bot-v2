import { DomainError } from "../utils/DomainError.js";

/**
 * @typedef {Object} Match
 * @property {number} id
 * @property {string|number} season_id
 * @property {number} division_id
 * @property {number} week
 * @property {string} player_a_id
 * @property {string} player_b_id
 * @property {string} status - One of: 'scheduled', 'reported', 'confirmed', 'disputed', 'void'
 * @property {string|null} reported_by
 * @property {string|null} reported_at
 * @property {string|null} confirmed_by
 * @property {string|null} confirmed_at
 * @property {string|null} disputed_at
 * @property {string|null} result_channel_id
 * @property {string|null} result_message_id
 * @property {string} created_at
 * @property {string} updated_at
 */

/**
 * @typedef {Object} MatchWithResult
 * @property {number} id
 * @property {string|number} season_id
 * @property {number} division_id
 * @property {number} week
 * @property {string} player_a_id
 * @property {string} player_b_id
 * @property {string} status
 * @property {Object|null} match_results
 * @property {number|null} match_results.legs_a
 * @property {number|null} match_results.legs_b
 * @property {string|null} match_results.proof_url
 * @property {number|null} [match_results.match_id]
 */

/**
 * Repository for managing matches within a season.
 * Expects a Supabase client already configured with auth; all methods throw
 * on database errors.
 */
export class MatchRepository {
    /**
     * @param {{ supabase: object, schema: string }} deps
     * @param {object} deps.supabase Supabase client instance.
     * @param {string} deps.schema Postgres schema name to scope all queries.
     */
    constructor({ supabase, schema }) {
        this.supabase = supabase.schema(schema);
        this.db = this.supabase;
    }

    /**
     * Insert multiple matches in bulk.
     * @param {Array.<Object>} rows Array of match objects to insert.
     * @returns {Promise<Array.<Match>>}
     */
    async insertMany(rows) {
        const { data, error } = await this.supabase
            .from("matches")
            .insert(rows)
            .select("*");

        if (error) throw error;
        return data;
    }

    /**
     * Find open (non-confirmed, non-void) matches between two players in a season.
     * @param {{ seasonId: string|number, userA: string, userB: string }} params
     * @returns {Promise<Array.<Match>>}
     */
    async findOpenMatchesBetweenPlayers({ seasonId, userA, userB }) {
        const { data, error } = await this.supabase
            .from("matches")
            .select("*")
            .eq("season_id", seasonId)
            .not("status", "in", "(confirmed,void)")
            .or(
                `and(player_a_id.eq.${userA},player_b_id.eq.${userB}),and(player_a_id.eq.${userB},player_b_id.eq.${userA})`
            )
            .order("week", { ascending: true });

        if (error) throw error;
        return data ?? [];
    }

    /**
     * Get a single match by ID.
     * @param {string|number} matchId
     * @returns {Promise<Match>}
     */
    async getById(matchId) {
        const { data, error } = await this.supabase
            .from("matches")
            .select("*")
            .eq("id", matchId)
            .single();
        // console.log("MatchRepository.getById:", { matchId, data, error });
        if (error) throw error;
        return data;
    }

    /**
     * Update a match by ID. Throws DomainError if match not found.
     * @param {string|number} matchId
     * @param {Object} patch Object with fields to update.
     * @returns {Promise<Match>}
     * @throws {DomainError} If match not found (0 rows affected).
     */
    async update(matchId, patch) {
        const { data, error } = await this.supabase
            .from("matches")
            .update(patch)
            .eq("id", String(matchId).trim())
            .select("*");

        if (error) throw error;
        if (!data || data.length === 0) {
            throw new DomainError(
                "MATCH_UPDATE_FAILED",
                "Match update affected 0 rows (match not found)."
            );
        }

        const row = Array.isArray(data) ? data[0] : data;

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
                    location: "MatchRepository.update",
                    message: "update result shape",
                    data: {
                        matchId,
                        dataIsArray: Array.isArray(data),
                        dataLength: Array.isArray(data) ? data.length : null,
                        rowId: row?.id ?? null,
                    },
                    timestamp: Date.now(),
                }),
            }
        ).catch(() => {});
        // #endregion

        return row;
    }

    /**
     * Set the Discord channel and message ID for a match result.
     * @param {{ matchId: string|number, channelId: string, messageId: string }} params
     * @returns {Promise<Match>}
     */
    async setResultMessage({ matchId, channelId, messageId }) {
        const { data, error } = await this.supabase
            .from("matches")
            .update({
                result_channel_id: channelId,
                result_message_id: messageId,
            })
            .eq("id", matchId)
            .select("*")
            .single();

        if (error) throw error;
        return data;
    }

    /**
     * Find a match between two players in a season (any status).
     * @param {{ seasonId: string|number, userA: string, userB: string }} params
     * @returns {Promise<(Match|null)>} Match object or null if not found.
     */
    async findByPlayersInSeason({ seasonId, userA, userB }) {
        const { data, error } = await this.db
            .from("matches")
            .select("*")
            .eq("season_id", seasonId)
            .or(
                `and(player_a_id.eq.${userA},player_b_id.eq.${userB}),and(player_a_id.eq.${userB},player_b_id.eq.${userA})`
            )
            .limit(1)
            .maybeSingle();

        if (error) throw error;
        return data; // null if not found
    }

    /**
     * Mark a match as reported with timestamp and reporter.
     * @param {{ matchId: string|number, reportedBy: string }} params
     * @returns {Promise<Match>}
     */
    async markReported({ matchId, reportedBy }) {
        const now = new Date().toISOString();
        const { data, error } = await this.db
            .from("matches")
            .update({
                status: "reported",
                reported_by: reportedBy,
                reported_at: now,
            })
            .eq("id", matchId)
            .select("*")
            .single();

        if (error) throw error;
        return data;
    }

    /**
     * List all matches for a player in a season with their results joined.
     * @param {{ seasonId: string|number, discordUserId: string }} params
     * @returns {Promise<Array.<MatchWithResult>>}
     */
    async listForPlayerInSeasonWithResults({ seasonId, discordUserId }) {
        const { data, error } = await this.supabase
            .from("matches")
            .select(
                `
            id,
            season_id,
            division_id,
            week,
            player_a_id,
            player_b_id,
            status,
            match_results (
                legs_a,
                legs_b,
                proof_url
            )
        `
            )
            .eq("season_id", seasonId)
            .or(
                `player_a_id.eq.${discordUserId},player_b_id.eq.${discordUserId}`
            )
            .order("week", { ascending: true });

        if (error) throw error;
        return data ?? [];
    }

    /**
     * Mark a match as confirmed with timestamp and confirmer.
     * @param {{ matchId: string|number, confirmedBy: string }} params
     * @returns {Promise<Match>}
     */
    async markConfirmed({ matchId, confirmedBy }) {
        const now = new Date().toISOString();
        const { data, error } = await this.db
            .from("matches")
            .update({
                status: "confirmed",
                confirmed_by: confirmedBy,
                confirmed_at: now,
            })
            .eq("id", matchId)
            .select("*")
            .single();

        if (error) throw error;
        return data;
    }

    /**
     * Delete all matches for a season.
     * @param {string|number} seasonId
     * @returns {Promise<void>}
     */
    async clearForSeason(seasonId) {
        const { error } = await this.supabase
            .from("matches")
            .delete()
            .eq("season_id", seasonId);

        if (error) throw error;
    }

    /**
     * Count matches for a season.
     * @param {string|number} seasonId
     * @returns {Promise<number>}
     */
    async countForSeason(seasonId) {
        const { count, error } = await this.supabase
            .from("matches")
            .select("*", { count: "exact", head: true })
            .eq("season_id", seasonId);
        if (error) throw error;
        return count ?? 0;
    }

    /**
     * List matches for a player in a season, optionally filtered by week.
     * @param {{ seasonId: string|number, discordUserId: string, week: (number|null) }} params
     * @returns {Promise<Array.<{id: number, week: number, division_id: number, player_a_id: string, player_b_id: string, status: string}>>}
     */
    async listForPlayer({ seasonId, discordUserId, week = null }) {
        let q = this.supabase
            .from("matches")
            .select("id, week, division_id, player_a_id, player_b_id, status")
            .eq("season_id", seasonId)
            .or(
                `player_a_id.eq.${discordUserId},player_b_id.eq.${discordUserId}`
            )
            .order("week", { ascending: true });

        if (week != null) q = q.eq("week", week);

        const { data, error } = await q;
        if (error) throw error;
        return data ?? [];
    }

    /**
     * List confirmed matches with results for a division.
     * @param {{ seasonId: string|number, divisionId: number }} params
     * @returns {Promise<Array.<MatchWithResult>>}
     */
    async listConfirmedWithResultsForDivision({ seasonId, divisionId }) {
        const { data, error } = await this.supabase
            .from("matches")
            .select(
                `
                id,
                season_id,
                division_id,
                week,
                player_a_id,
                player_b_id,
                status,
                match_results (
                    match_id,
                    legs_a,
                    legs_b,
                    proof_url
                )
            `
            )
            .eq("season_id", seasonId)
            .eq("division_id", divisionId)
            .eq("status", "confirmed");

        if (error) throw error;
        return data ?? [];
    }

    /**
     * List all matches for a division (excluding void matches).
     * @param {{ seasonId: string|number, divisionId: number }} params
     * @returns {Promise<Array.<Match>>}
     */
    async listAllForDivision({ seasonId, divisionId }) {
        const { data, error } = await this.supabase
            .from("matches")
            .select("id, player_a_id, player_b_id, status")
            .eq("season_id", seasonId)
            .eq("division_id", divisionId)
            .neq("status", "void");

        if (error) throw error;
        return data ?? [];
    }

    /**
     * Count confirmed matches for a player in a division within a season.
     * @param {{ seasonId: string|number, divisionId: number|string, discordUserId: string }} params
     * @returns {Promise<number>}
     */
    async countConfirmedForPlayerInDivision({
        seasonId,
        divisionId,
        discordUserId,
    }) {
        const { count, error } = await this.supabase
            .from("matches")
            .select("*", { count: "exact", head: true })
            .eq("season_id", seasonId)
            .eq("division_id", divisionId)
            .eq("status", "confirmed")
            .or(
                `player_a_id.eq.${discordUserId},player_b_id.eq.${discordUserId}`
            );

        if (error) throw error;
        return count ?? 0;
    }

    /**
     * List distinct division IDs where a player appears in matches for a season.
     * Useful as a fallback when roster membership is missing/out of sync.
     * @param {{ seasonId: string|number, discordUserId: string }} params
     * @returns {Promise<Array.<(number|string)>>}
     */
    async listDivisionIdsForPlayerInSeason({ seasonId, discordUserId }) {
        const { data, error } = await this.supabase
            .from("matches")
            .select("division_id")
            .eq("season_id", seasonId)
            .or(`player_a_id.eq.${discordUserId},player_b_id.eq.${discordUserId}`);

        if (error) throw error;

        const ids = new Set((data ?? []).map((r) => r.division_id));
        return [...ids];
    }

    /**
     * Replace a player id in matches for a season/division.
     * - full_replace: all matches in season/division
     * - future_only: week >= effectiveWeek AND status not in (confirmed, void)
     *
     * @param {{
     *   seasonId: string|number,
     *   divisionId: number|string,
     *   outDiscordUserId: string,
     *   inDiscordUserId: string,
     *   mode: ('full_replace'|'future_only'),
     *   effectiveWeek: (number|null),
     * }} params
     * @returns {Promise<number>} number of matches updated (sum of a-side + b-side updates)
     */
    async replacePlayerInDivisionMatches({
        seasonId,
        divisionId,
        outDiscordUserId,
        inDiscordUserId,
        mode,
        effectiveWeek,
    }) {
        const now = new Date().toISOString();

        const applyModeFilters = (q) => {
            if (mode === "future_only") {
                q = q
                    .gte("week", effectiveWeek)
                    .not("status", "in", "(confirmed,void)");
            }
            return q;
        };

        const { data: aData, error: aErr } = await applyModeFilters(
            this.supabase
                .from("matches")
                .update({ player_a_id: inDiscordUserId, updated_at: now })
                .eq("season_id", seasonId)
                .eq("division_id", divisionId)
                .eq("player_a_id", outDiscordUserId)
                .select("id")
        );

        if (aErr) throw aErr;

        const { data: bData, error: bErr } = await applyModeFilters(
            this.supabase
                .from("matches")
                .update({ player_b_id: inDiscordUserId, updated_at: now })
                .eq("season_id", seasonId)
                .eq("division_id", divisionId)
                .eq("player_b_id", outDiscordUserId)
                .select("id")
        );

        if (bErr) throw bErr;

        return (aData ?? []).length + (bData ?? []).length;
    }

    /**
     * List matches for a specific season and week with results joined.
     * @param {{ seasonId: string|number, week: number }} params
     * @returns {Promise<Array.<MatchWithResult>>}
     */
    async listForSeasonWeekWithResults({ seasonId, week }) {
        const { data, error } = await this.supabase
            .from("matches")
            .select(
                `
                id,
                season_id,
                division_id,
                week,
                player_a_id,
                player_b_id,
                status,
                match_results (
                    legs_a,
                    legs_b,
                    proof_url
                )
            `
            )
            .eq("season_id", seasonId)
            .eq("week", week)
            .order("division_id", { ascending: true });

        if (error) throw error;
        return data ?? [];
    }

    /**
     * List matches that are unreported before a specific week.
     * Excludes confirmed, void, and reported matches.
     * @param {{ seasonId: string|number, week: number }} params
     * @returns {Promise<Array.<MatchWithResult>>}
     */
    async listUnreportedBeforeWeek({ seasonId, week }) {
        const { data, error } = await this.supabase
            .from("matches")
            .select(
                `
                id,
                season_id,
                division_id,
                week,
                player_a_id,
                player_b_id,
                status,
                match_results (
                    legs_a,
                    legs_b,
                    proof_url
                )
            `
            )
            .eq("season_id", seasonId)
            .lt("week", week)
            .neq("status", "confirmed")
            .neq("status", "void")
            .neq("status", "reported")
            .order("week", { ascending: true })
            .order("division_id", { ascending: true });

        if (error) throw error;
        return data ?? [];
    }

    /**
     * List all confirmed matches for a season with their results.
     * @param {string|number} seasonId
     * @returns {Promise<Array.<MatchWithResult>>}
     */
    async listConfirmedForSeasonWithResults(seasonId) {
        const { data, error } = await this.supabase
            .from("matches")
            .select(
                `
                id,
                season_id,
                division_id,
                week,
                player_a_id,
                player_b_id,
                status,
                match_results (
                    legs_a,
                    legs_b,
                    proof_url
                )
            `
            )
            .eq("season_id", seasonId)
            .eq("status", "confirmed")
            .order("week", { ascending: true });

        if (error) throw error;
        return data ?? [];
    }

    /**
     * List all confirmed matches for a player across all seasons in a guild with their results.
     * @param {{ guildId: string, discordUserId: string }} params
     * @returns {Promise<Array.<MatchWithResult>>}
     */
    async listAllConfirmedForPlayerInGuild({ guildId, discordUserId }) {
        // First get all seasons for this guild
        const { data: seasons, error: seasonsError } = await this.supabase
            .from("seasons")
            .select("id")
            .eq("guild_id", guildId);

        if (seasonsError) throw seasonsError;
        if (!seasons || seasons.length === 0) return [];

        const seasonIds = seasons.map((s) => s.id);

        const { data, error } = await this.supabase
            .from("matches")
            .select(
                `
                id,
                season_id,
                division_id,
                week,
                player_a_id,
                player_b_id,
                status,
                confirmed_at,
                match_results (
                    legs_a,
                    legs_b,
                    proof_url
                )
            `
            )
            .in("season_id", seasonIds)
            .eq("status", "confirmed")
            .or(
                `player_a_id.eq.${discordUserId},player_b_id.eq.${discordUserId}`
            )
            .order("confirmed_at", { ascending: false });

        if (error) throw error;
        return data ?? [];
    }

    /**
     * List all confirmed matches between two players in a guild with their results.
     * @param {{ guildId: string, playerAId: string, playerBId: string }} params
     * @returns {Promise<Array.<MatchWithResult>>}
     */
    async listHeadToHeadMatches({ guildId, playerAId, playerBId }) {
        // First get all seasons for this guild
        const { data: seasons, error: seasonsError } = await this.supabase
            .from("seasons")
            .select("id")
            .eq("guild_id", guildId);

        if (seasonsError) throw seasonsError;
        if (!seasons || seasons.length === 0) return [];

        const seasonIds = seasons.map((s) => s.id);

        const { data, error } = await this.supabase
            .from("matches")
            .select(
                `
                id,
                season_id,
                division_id,
                week,
                player_a_id,
                player_b_id,
                status,
                confirmed_at,
                match_results (
                    legs_a,
                    legs_b,
                    proof_url
                )
            `
            )
            .in("season_id", seasonIds)
            .eq("status", "confirmed")
            .or(
                `and(player_a_id.eq.${playerAId},player_b_id.eq.${playerBId}),and(player_a_id.eq.${playerBId},player_b_id.eq.${playerAId})`
            )
            .order("confirmed_at", { ascending: false });

        if (error) throw error;
        return data ?? [];
    }
}
