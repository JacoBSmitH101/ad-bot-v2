export class SeasonRepository {
    /**
     * @param {{ supabase: any }} deps
     */
    constructor({ supabase }) {
        this.supabase = supabase;
    }

    /**
     * Create a new season (status defaults to 'draft' in DB)
     * @param {{ guildId: string, name: string }} input
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
     * Fetch a season by ID
     * @param {string} id
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
     * Get the most recent season for a guild (useful for MVP)
     * @param {string} guildId
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
}
