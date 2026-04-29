/**
 * @typedef {Object} Division
 * @property {number} id
 * @property {string|number} season_id
 * @property {string} name
 * @property {number} sort_order
 * @property {string|null} channel_id
 * @property {string} created_at
 * @property {string} updated_at
 */

/**
 * @typedef {Object} DivisionPlayer
 * @property {number} division_id
 * @property {string} discord_user_id
 * @property {number|null} seed_avg
 * @property {number|null} seed_rank
 * @property {string} created_at
 * @property {string} updated_at
 */

/**
 * Repository for managing divisions and division players within a season.
 * Expects a Supabase client already configured with auth; all methods throw
 * on database errors.
 */
export class DivisionRepository {
    /**
     * @param {{ supabase: object, schema: string }} deps
     * @param {object} deps.supabase Supabase client instance.
     * @param {string} deps.schema Postgres schema name to scope all queries.
     */
    constructor({ supabase, schema }) {
        this.supabase = supabase.schema(schema);
    }

    /**
     * Create a set of sequential divisions for a season.
     * @param {{ seasonId: string|number, count: number }} params
     * @returns {Promise<Array.<Division>>}
     */
    async createMany({ seasonId, count }) {
        const rows = Array.from({ length: count }, (_, i) => ({
            season_id: seasonId,
            name: `Div ${i + 1}`,
            sort_order: i + 1,
        }));

        const { data, error } = await this.supabase
            .from("divisions")
            .insert(rows)
            .select("*")
            .order("sort_order", { ascending: true });

        if (error) throw error;
        return data;
    }

    /**
     * List divisions for a season ordered by sort_order.
     * @param {string|number} seasonId
     * @returns {Promise<Array.<Division>>}
     */
    async listBySeason(seasonId) {
        const { data, error } = await this.supabase
            .from("divisions")
            .select("*")
            .eq("season_id", seasonId)
            .order("sort_order", { ascending: true });

        if (error) throw error;
        return data;
    }

    /**
     * Remove all division player memberships for every division in the season.
     * No-op if the season has no divisions.
     * @param {string|number} seasonId
     * @returns {Promise<void>}
     */
    async clearPlayersForSeason(seasonId) {
        const { data: divs, error: divErr } = await this.supabase
            .from("divisions")
            .select("id")
            .eq("season_id", seasonId);

        if (divErr) throw divErr;
        if (!divs?.length) return;

        const ids = divs.map((d) => d.id);

        const { error } = await this.supabase
            .from("division_players")
            .delete()
            .in("division_id", ids);

        if (error) throw error;
    }

    /**
     * Remove division memberships for a set of users within a season.
     * Useful for manual reassignment without wiping the entire season.
     * @param {string|number} seasonId
     * @param {Array.<string>} discordUserIds
     * @returns {Promise<void>}
     */
    async removePlayersForSeason(seasonId, discordUserIds) {
        if (!discordUserIds?.length) return;

        const { data: divs, error: divErr } = await this.supabase
            .from("divisions")
            .select("id")
            .eq("season_id", seasonId);

        if (divErr) throw divErr;
        if (!divs?.length) return;

        const divisionIds = divs.map((d) => d.id);

        const { error } = await this.supabase
            .from("division_players")
            .delete()
            .in("division_id", divisionIds)
            .in("discord_user_id", discordUserIds);

        if (error) throw error;
    }

    /**
     * Add players to divisions in bulk.
     * @param {Array.<{division_id: number, discord_user_id: string, seed_avg: (number|null), seed_rank: (number|null)}>} rows
     * @returns {Promise<Array.<DivisionPlayer>>}
     */
    async addPlayersBulk(rows) {
        const { data, error } = await this.supabase
            .from("division_players")
            .insert(rows)
            .select("*");

        if (error) throw error;
        return data;
    }

    /**
     * List players for a division ordered by seed_avg descending.
     * @param {number} divisionId
     * @returns {Promise<Array.<{discord_user_id: string, seed_avg: (number|null), seed_rank: (number|null)}>>}
     */
    async listDivisionPlayers(divisionId) {
        const { data, error } = await this.supabase
            .from("division_players")
            .select("discord_user_id, seed_avg, seed_rank")
            .eq("division_id", divisionId)
            .order("seed_avg", { ascending: false });

        if (error) throw error;
        return data;
    }

    /**
     * Find which division a player is assigned to for a given season.
     * Returns the first match if somehow assigned multiple times.
     * @param {{ seasonId: string|number, discordUserId: string }} params
     * @returns {Promise<({id: any, name: string, sort_order?: number}|null)>}
     */
    async findDivisionForPlayerInSeason({ seasonId, discordUserId }) {
        const divs = await this.listBySeason(seasonId);
        if (!divs?.length) return null;

        const divisionIds = divs.map((d) => d.id);

        const { data, error } = await this.supabase
            .from("division_players")
            .select("division_id")
            .in("division_id", divisionIds)
            .eq("discord_user_id", discordUserId)
            .limit(1)
            .maybeSingle();

        if (error) throw error;
        if (!data?.division_id) return null;

        const byId = new Map(divs.map((d) => [String(d.id), d]));
        return byId.get(String(data.division_id)) ?? null;
    }

    /**
     * Replace one player with another within a single division roster.
     * @param {{ divisionId: string|number, outDiscordUserId: string, inDiscordUserId: string }} params
     * @returns {Promise<number>} number of rows updated
     */
    async replacePlayerInDivision({
        divisionId,
        outDiscordUserId,
        inDiscordUserId,
    }) {
        const { data, error } = await this.supabase
            .from("division_players")
            .update({ discord_user_id: inDiscordUserId })
            .eq("division_id", divisionId)
            .eq("discord_user_id", outDiscordUserId)
            .select("division_id, discord_user_id");

        if (error) throw error;
        return (data ?? []).length;
    }

    /**
     * Remove a player from a division roster.
     * @param {{ divisionId: string|number, discordUserId: string }} params
     * @returns {Promise<number>} number of rows deleted
     */
    async removePlayerFromDivision({ divisionId, discordUserId }) {
        const { data, error } = await this.supabase
            .from("division_players")
            .delete()
            .eq("division_id", divisionId)
            .eq("discord_user_id", discordUserId)
            .select("division_id, discord_user_id");

        if (error) throw error;
        return (data ?? []).length;
    }

    /**
     * Ensure a player is present in a division roster (no-op if already exists).
     * @param {{ divisionId: string|number, discordUserId: string }} params
     * @returns {Promise<void>}
     */
    async ensurePlayerInDivision({ divisionId, discordUserId }) {
        const { error } = await this.supabase
            .from("division_players")
            .upsert(
                {
                    division_id: divisionId,
                    discord_user_id: discordUserId,
                    seed_avg: 0,
                    seed_rank: 0,
                },
                { onConflict: "division_id,discord_user_id" }
            );

        if (error) throw error;
    }

    /**
     * List divisions with their players for a season.
     * @param {string|number} seasonId
     * @returns {Promise<Array.<{ division: {id: number, name: string, sort_order: number}, players: Array.<{discord_user_id: string, seed_avg: (number|null), seed_rank: (number|null)}> }>>}
     */
    async listAllDivisionPlayersForSeason(seasonId) {
        const { data: divs, error: divErr } = await this.supabase
            .from("divisions")
            .select("id, name, sort_order")
            .eq("season_id", seasonId)
            .order("sort_order", { ascending: true });

        if (divErr) throw divErr;

        const result = [];
        for (const d of divs) {
            const players = await this.listDivisionPlayers(d.id);
            result.push({ division: d, players });
        }
        return result;
    }
    /**
     * Set the Discord channel for a division.
     * @param {number} divisionId
     * @param {string} channelId
     * @returns {Promise<Division>}
     */
    async setChannel(divisionId, channelId) {
        const { data, error } = await this.supabase
            .from("divisions")
            .update({ channel_id: channelId })
            .eq("id", divisionId)
            .select("*")
            .single();

        if (error) throw error;
        return data;
    }
    /**
     * Fetch a division by season and name.
     * @param {string|number} seasonId
     * @param {string} name
     * @returns {Promise<(Division|null)>}
     */
    async getBySeasonAndName(seasonId, name) {
        const { data, error } = await this.supabase
            .from("divisions")
            .select("*")
            .eq("season_id", seasonId)
            .eq("name", name)
            .maybeSingle();

        if (error) throw error;
        return data ?? null;
    }

    /**
     * List divisions for a season ordered by sort_order.
     * @param {string|number} seasonId
     * @returns {Promise<Array.<Division>>}
     */
    async listForSeason(seasonId) {
        const { data, error } = await this.supabase
            .from("divisions")
            .select("*")
            .eq("season_id", seasonId)
            .order("sort_order", { ascending: true });

        if (error) throw error;
        return data ?? [];
    }
}
