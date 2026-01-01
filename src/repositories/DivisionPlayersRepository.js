/**
 * @typedef {Object} DivisionPlayerWithDisplayName
 * @property {string} discord_user_id
 * @property {string|null} display_name
 * @property {number|null} seed_avg
 * @property {number|null} seed_rank
 */

/**
 * Repository for querying division players with player details.
 * Expects a Supabase client already configured with auth; all methods throw
 * on database errors.
 */
export class DivisionPlayersRepository {
    /**
     * @param {{ supabase: object, schema: string }} deps
     * @param {object} deps.supabase Supabase client instance.
     * @param {string} deps.schema Postgres schema name to scope all queries.
     */
    constructor({ supabase, schema }) {
        this.supabase = supabase.schema(schema);
    }

    /**
     * List players for a division with their display names from the players table.
     * @param {number} divisionId
     * @returns {Promise<Array.<DivisionPlayerWithDisplayName>>}
     */
    async listPlayersForDivision(divisionId) {
        const { data, error } = await this.supabase
            .from("division_players")
            .select(
                `
                discord_user_id,
                seed_avg,
                seed_rank,
                players (
                    discord_user_id,
                    display_name
                )
            `
            )
            .eq("division_id", divisionId);

        if (error) throw error;

        // normalize to a clean array: { discord_user_id, display_name }
        return (data ?? []).map((row) => ({
            discord_user_id: row.discord_user_id,
            display_name: row.players?.display_name ?? null,
            seed_avg: row.seed_avg,
            seed_rank: row.seed_rank,
        }));
    }
}
