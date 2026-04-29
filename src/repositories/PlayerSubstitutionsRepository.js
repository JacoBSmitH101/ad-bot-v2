/**
 * @typedef {Object} PlayerSubstitution
 * @property {number} id
 * @property {string} season_id
 * @property {string|null} division_id
 * @property {string} out_discord_user_id
 * @property {string} in_discord_user_id
 * @property {string} mode - 'full_replace' | 'future_only'
 * @property {number|null} effective_week
 * @property {string|null} created_by
 * @property {string|null} note
 * @property {string} created_at
 */

/**
 * Repository for recording player substitution events.
 * Expects a Supabase client already configured with auth; all methods throw
 * on database errors.
 */
export class PlayerSubstitutionsRepository {
    /**
     * @param {{ supabase: object, schema: string }} deps
     * @param {object} deps.supabase Supabase client instance.
     * @param {string} deps.schema Postgres schema name to scope all queries.
     */
    constructor({ supabase, schema }) {
        this.supabase = supabase.schema(schema);
    }

    /**
     * Insert a substitution record.
     * @param {{
     *   seasonId: string,
     *   divisionId: (string|null),
     *   outDiscordUserId: string,
     *   inDiscordUserId: string,
     *   mode: ('full_replace'|'future_only'),
     *   effectiveWeek: (number|null),
     *   createdBy: (string|null),
     *   note: (string|null),
     * }} params
     * @returns {Promise<PlayerSubstitution>}
     */
    async create({
        seasonId,
        divisionId,
        outDiscordUserId,
        inDiscordUserId,
        mode,
        effectiveWeek,
        createdBy,
        note,
    }) {
        const { data, error } = await this.supabase
            .from("player_substitutions")
            .insert({
                season_id: seasonId,
                division_id: divisionId ?? null,
                out_discord_user_id: outDiscordUserId,
                in_discord_user_id: inDiscordUserId,
                mode,
                effective_week: effectiveWeek ?? null,
                created_by: createdBy ?? null,
                note: note ?? null,
            })
            .select("*")
            .single();

        if (error) throw error;
        return data;
    }
}

