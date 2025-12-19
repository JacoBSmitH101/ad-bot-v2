export class MatchRepository {
    constructor({ supabase }) {
        this.supabase = supabase;
    }

    async insertMany(rows) {
        const { data, error } = await this.supabase
            .from("matches")
            .insert(rows)
            .select("*");

        if (error) throw error;
        return data;
    }

    async clearForSeason(seasonId) {
        const { error } = await this.supabase
            .from("matches")
            .delete()
            .eq("season_id", seasonId);

        if (error) throw error;
    }
    async countForSeason(seasonId) {
        const { count, error } = await this.supabase
            .from("matches")
            .select("*", { count: "exact", head: true })
            .eq("season_id", seasonId);
        if (error) throw error;
        return count ?? 0;
    }
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
    async countForSeason(seasonId) {
        const { count, error } = await this.supabase
            .from("matches")
            .select("*", { count: "exact", head: true })
            .eq("season_id", seasonId);

        if (error) throw error;
        return count ?? 0;
    }
}
