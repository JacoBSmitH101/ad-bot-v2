/**
 * @typedef {Object} Player
 * @property {string} discord_user_id
 * @property {string|null} display_name
 * @property {string} created_at
 * @property {string} updated_at
 */

/**
 * Repository for managing players.
 * Expects a Supabase client already configured with auth; all methods throw
 * on database errors.
 */
export class PlayersRepository {
    /**
     * @param {{ supabase: object, schema: string }} deps
     * @param {object} deps.supabase Supabase client instance.
     * @param {string} deps.schema Postgres schema name to scope all queries.
     */
    constructor({ supabase, schema }) {
        this.supabase = supabase.schema(schema);
    }

    /**
     * Upsert a player. Creates or updates based on discord_user_id.
     * @param {{ discordUserId: string, displayName: (string|null) }} params
     * @returns {Promise<Player>}
     */
    async upsert({ discordUserId, displayName }) {
        const { data, error } = await this.supabase
            .from("players")
            .upsert(
                {
                    discord_user_id: discordUserId,
                    display_name: displayName ?? null,
                },
                { onConflict: "discord_user_id" }
            )
            .select("*")
            .single();

        if (error) throw error;
        return data;
    }
}
