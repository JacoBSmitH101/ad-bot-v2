export class SignupRepository {
    constructor({ supabase }) {
        this.supabase = supabase;
    }

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

    async listBySeason(seasonId) {
        const { data, error } = await this.supabase
            .from("signups")
            .select("discord_user_id, avg_3dart, created_at, updated_at")
            .eq("season_id", seasonId)
            .order("avg_3dart", { ascending: false });

        if (error) throw error;
        return data;
    }
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

    async deleteBySeasonAndUser(seasonId, discordUserId) {
        const { error } = await this.supabase
            .from("signups")
            .delete()
            .eq("season_id", seasonId)
            .eq("discord_user_id", discordUserId);

        if (error) throw error;
    }
}
