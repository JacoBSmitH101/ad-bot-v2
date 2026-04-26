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

    /**
     * List players by Discord user IDs.
     * @param {{ discordUserIds: Array.<string> }} params
     * @returns {Promise<Array.<Player>>}
     */
    async listByDiscordIds({ discordUserIds }) {
        if (!discordUserIds || discordUserIds.length === 0) return [];

        const { data, error } = await this.supabase
            .from("players")
            .select("*")
            .in("discord_user_id", discordUserIds);

        if (error) throw error;
        return data ?? [];
    }

    /**
     * List players with no usable display name (for one-off backfills).
     * Includes SQL NULL and empty string (PostgREST does not treat '' as NULL).
     * @returns {Promise<Array.<{ discord_user_id: string, display_name: string|null }>>}
     */
    async listWithNullDisplayName() {
        const { data: nullRows, error: nullErr } = await this.supabase
            .from("players")
            .select("discord_user_id, display_name")
            .is("display_name", null);

        if (nullErr) throw nullErr;

        const { data: emptyRows, error: emptyErr } = await this.supabase
            .from("players")
            .select("discord_user_id, display_name")
            .eq("display_name", "");

        if (emptyErr) throw emptyErr;

        const byId = new Map();
        for (const r of [...(nullRows ?? []), ...(emptyRows ?? [])]) {
            byId.set(r.discord_user_id, r);
        }
        return [...byId.values()];
    }
}
