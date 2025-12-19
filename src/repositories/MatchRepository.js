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
}
