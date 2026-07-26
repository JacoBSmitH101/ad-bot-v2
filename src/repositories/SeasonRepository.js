/**
 * @typedef {Object} Season
 * @property {string} id
 * @property {string} guild_id
 * @property {string} name
 * @property {string} status - One of: 'draft', 'signups_open', 'signups_closed', 'active', 'closed'
 * @property {string|null} signups_close_at
 * @property {string|null} signups_channel_id
 * @property {string|null} signups_message_id
 * @property {string|null} standings_channel_id
 * @property {Object|null} standings_message_ids - JSON map of division:{id} → message id
 * @property {string|null} fixtures_channel_id
 * @property {string|null} fixtures_message_id
 * @property {number|null} fixtures_week
 * @property {string|null} stats_channel_id
 * @property {string|null} stats_message_id
 * @property {string|null} started_at
 * @property {number|null} current_week
 * @property {string} created_at
 * @property {string} updated_at
 */

/**
 * Repository for managing seasons.
 * Expects a Supabase client already configured with auth; all methods throw
 * on database errors (except getById which returns null on not found).
 */
export class SeasonRepository {
    /**
     * @param {{ supabase: object, schema: string }} deps
     * @param {object} deps.supabase Supabase client instance.
     * @param {string} deps.schema Postgres schema name to scope all queries.
     */
    constructor({ supabase, schema }) {
        this.supabase = supabase.schema(schema);
    }

    /**
     * Create a new season (status defaults to 'draft' in DB).
     * @param {{ guildId: string, name: string }} input
     * @returns {Promise<Season>}
     */
    async create({ guildId, name }) {
        const { data, error } = await this.supabase
            .from("seasons")
            .insert([{ guild_id: guildId, name }])
            .select("*")
            .single();

        if (error) throw error;
        return data;
    }

    /**
     * Fetch a season by ID. Returns null if not found (unlike other methods).
     * @param {string} id
     * @returns {Promise<(Season|null)>} Season object or null if not found.
     */
    async getById(id) {
        const { data, error } = await this.supabase
            .from("seasons")
            .select("*")
            .eq("id", id)
            .single();

        // If not found, supabase returns an error. We treat that as null.
        if (error) return null;
        return data;
    }

    /**
     * Get the current (most recent) season for a guild.
     * @param {string} guildId
     * @returns {Promise<(Season|null)>} Season object or null if none found.
     */
    async getCurrentForGuild(guildId) {
        const { data, error } = await this.supabase
            .from("seasons")
            .select("*")
            .eq("guild_id", guildId)
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle();

        if (error) throw error;
        return data ?? null;
    }

    /**
     * Get the season immediately before another season for a guild.
     * @param {string} guildId
     * @param {string} beforeCreatedAt Current season's created_at value.
     * @returns {Promise<(Season|null)>}
     */
    async getPreviousForGuild(guildId, beforeCreatedAt) {
        const { data, error } = await this.supabase
            .from("seasons")
            .select("*")
            .eq("guild_id", guildId)
            .lt("created_at", beforeCreatedAt)
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle();

        if (error) throw error;
        return data ?? null;
    }

    /**
     * Get the most recent season that can provide standings.
     * This is useful while a newer season is still in draft or signups.
     * @param {string} guildId
     * @returns {Promise<(Season|null)>}
     */
    async getLatestStandingsSeasonForGuild(guildId) {
        const { data, error } = await this.supabase
            .from("seasons")
            .select("*")
            .eq("guild_id", guildId)
            .in("status", ["active", "closed"])
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle();

        if (error) throw error;
        return data ?? null;
    }

    /**
     * Update the status of a season.
     * @param {string|number} seasonId
     * @param {string} status New status value.
     * @returns {Promise<Season>}
     */
    async updateStatus(seasonId, status) {
        const { data, error } = await this.supabase
            .from("seasons")
            .update({ status })
            .eq("id", seasonId)
            .select("*")
            .single();

        if (error) throw error;
        return data;
    }

    /**
     * Set the signups close timestamp for a season.
     * @param {string|number} seasonId
     * @param {string} closeAt ISO timestamp string.
     * @returns {Promise<Season>}
     */
    async setSignupsCloseAt(seasonId, closeAt) {
        const { data, error } = await this.supabase
            .from("seasons")
            .update({ signups_close_at: closeAt })
            .eq("id", seasonId)
            .select("*")
            .single();

        if (error) throw error;
        return data;
    }

    /**
     * Set a season to active status, set started_at to now, and set current_week to 1.
     * @param {string|number} seasonId
     * @returns {Promise<Season>}
     */
    async setSeasonInProgress(seasonId) {
        const { data, error } = await this.supabase
            .from("seasons")
            .update({
                status: "active",
                started_at: new Date().toISOString(),
                current_week: 1,
            })
            .eq("id", seasonId)
            .select("*")
            .single();
        if (error) throw error;
        return data;
    }

    /**
     * Get the most recent season for a guild (useful for MVP).
     * @param {string} guildId
     * @returns {Promise<(Season|null)>} Season object or null if none found.
     */
    async getLatestForGuild(guildId) {
        const { data, error } = await this.supabase
            .from("seasons")
            .select("*")
            .eq("guild_id", guildId)
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle();

        if (error) throw error;
        return data ?? null;
    }

    /**
     * Set the Discord channel ID for standings for a season.
     * @param {string|number} seasonId
     * @param {string} channelId Discord channel ID.
     * @returns {Promise<Season>}
     */
    async setStandingsChannel(seasonId, channelId) {
        const { data, error } = await this.supabase
            .from("seasons")
            .update({ standings_channel_id: channelId })
            .eq("id", seasonId)
            .select("*")
            .single();

        if (error) throw error;
        return data;
    }

    /**
     * Set the Discord message IDs for standings messages for a season.
     * @param {string|number} seasonId
     * @param {Array.<string>} messageIds Array of Discord message IDs.
     * @returns {Promise<Season>}
     */
    async setStandingsMessageIds(seasonId, messageIds) {
        const { data, error } = await this.supabase
            .from("seasons")
            .update({ standings_message_ids: messageIds })
            .eq("id", seasonId)
            .select("*")
            .single();

        if (error) throw error;
        return data;
    }

    /**
     * Set the Discord channel ID for signups for a season.
     * @param {string|number} seasonId
     * @param {string} channelId Discord channel ID.
     * @returns {Promise<Season>}
     */
    async setSignupsChannel(seasonId, channelId) {
        const { data, error } = await this.supabase
            .from("seasons")
            .update({ signups_channel_id: channelId })
            .eq("id", seasonId)
            .select("*")
            .single();

        if (error) throw error;
        return data;
    }

    /**
     * Set the Discord message ID for the signups message for a season.
     * @param {string|number} seasonId
     * @param {string} messageId Discord message ID.
     * @returns {Promise<Season>}
     */
    async setSignupsMessageId(seasonId, messageId) {
        const { data, error } = await this.supabase
            .from("seasons")
            .update({ signups_message_id: messageId })
            .eq("id", seasonId)
            .select("*")
            .single();

        if (error) throw error;
        return data;
    }

    /**
     * Set the Discord channel ID for fixtures for a season.
     * @param {string|number} seasonId
     * @param {string} channelId Discord channel ID.
     * @returns {Promise<Season>}
     */
    async setFixturesChannel(seasonId, channelId) {
        const { data, error } = await this.supabase
            .from("seasons")
            .update({ fixtures_channel_id: channelId })
            .eq("id", seasonId)
            .select("*")
            .single();
        if (error) throw error;
        return data;
    }

    /**
     * Set the Discord message ID for the fixtures message for a season.
     * @param {string|number} seasonId
     * @param {string} messageId Discord message ID.
     * @returns {Promise<Season>}
     */
    async setFixturesMessageId(seasonId, messageId) {
        const { data, error } = await this.supabase
            .from("seasons")
            .update({ fixtures_message_id: messageId })
            .eq("id", seasonId)
            .select("*")
            .single();
        if (error) throw error;
        return data;
    }

    /**
     * Set the current fixtures week for a season.
     * @param {string|number} seasonId
     * @param {number} week Week number.
     * @returns {Promise<Season>}
     */
    async setFixturesWeek(seasonId, week) {
        const { data, error } = await this.supabase
            .from("seasons")
            .update({ fixtures_week: week })
            .eq("id", seasonId)
            .select("*")
            .single();
        if (error) throw error;
        return data;
    }

    /**
     * Set the Discord channel ID for stats leaders for a season.
     * @param {string|number} seasonId
     * @param {string} channelId Discord channel ID.
     * @returns {Promise<Season>}
     */
    async setStatsChannel(seasonId, channelId) {
        const { data, error } = await this.supabase
            .from("seasons")
            .update({ stats_channel_id: channelId })
            .eq("id", seasonId)
            .select("*")
            .single();
        if (error) throw error;
        return data;
    }

    /**
     * Set the Discord message ID for the stats leaders message for a season.
     * @param {string|number} seasonId
     * @param {string} messageId Discord message ID.
     * @returns {Promise<Season>}
     */
    async setStatsMessageId(seasonId, messageId) {
        const { data, error } = await this.supabase
            .from("seasons")
            .update({ stats_message_id: messageId })
            .eq("id", seasonId)
            .select("*")
            .single();
        if (error) throw error;
        return data;
    }
}
