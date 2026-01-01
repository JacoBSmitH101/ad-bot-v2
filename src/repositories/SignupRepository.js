/**
 * @typedef {Object} Signup
 * @property {string|number} season_id
 * @property {string} discord_user_id
 * @property {number} avg_3dart
 * @property {string} created_at
 * @property {string} updated_at
 */

/**
 * Repository for managing season signups.
 * Expects a Supabase client already configured with auth; all methods throw
 * on database errors.
 */
export class SignupRepository {
    /**
     * @param {{ supabase: object, schema: string }} deps
     * @param {object} deps.supabase Supabase client instance.
     * @param {string} deps.schema Postgres schema name to scope all queries.
     */
    constructor({ supabase, schema }) {
        this.supabase = supabase.schema(schema);
    }

    /**
     * Upsert a signup for a season. Creates or updates based on season_id and discord_user_id.
     * @param {{ seasonId: string|number, discordUserId: string, avg3dart: number }} params
     * @returns {Promise<Signup>}
     */
    async upsertSignup({ seasonId, discordUserId, avg3dart }) {
        const { data, error } = await this.supabase
            .from("signups")
            .upsert(
                {
                    season_id: seasonId,
                    discord_user_id: discordUserId,
                    avg_3dart: avg3dart,
                },
                { onConflict: "season_id,discord_user_id" }
            )
            .select("*")
            .single();

        if (error) throw error;
        return data;
    }

    /**
     * List all signups for a season ordered by avg_3dart descending.
     * @param {string|number} seasonId
     * @returns {Promise<Array.<{discord_user_id: string, avg_3dart: number, created_at: string, updated_at: string}>>}
     */
    async listBySeason(seasonId) {
        const { data, error } = await this.supabase
            .from("signups")
            .select("discord_user_id, avg_3dart, created_at, updated_at")
            .eq("season_id", seasonId)
            .order("avg_3dart", { ascending: false });

        if (error) throw error;
        return data;
    }

    /**
     * Get a signup by season and user.
     * @param {string|number} seasonId
     * @param {string} discordUserId
     * @returns {Promise<(Signup|null)>} Signup object or null if not found.
     */
    async getBySeasonAndUser(seasonId, discordUserId) {
        const { data, error } = await this.supabase
            .from("signups")
            .select("*")
            .eq("season_id", seasonId)
            .eq("discord_user_id", discordUserId)
            .maybeSingle();

        if (error) throw error;
        return data ?? null;
    }

    /**
     * Delete a signup by season and user.
     * @param {string|number} seasonId
     * @param {string} discordUserId
     * @returns {Promise<void>}
     */
    async deleteBySeasonAndUser(seasonId, discordUserId) {
        const { error } = await this.supabase
            .from("signups")
            .delete()
            .eq("season_id", seasonId)
            .eq("discord_user_id", discordUserId);

        if (error) throw error;
    }
}
