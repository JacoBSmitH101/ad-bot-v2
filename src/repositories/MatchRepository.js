export class MatchRepository {
    constructor({ supabase, schema }) {
        this.supabase = supabase.schema(schema);
        this.db = this.supabase;
    }

    async insertMany(rows) {
        const { data, error } = await this.supabase
            .from("matches")
            .insert(rows)
            .select("*");

        if (error) throw error;
        return data;
    }
    async findOpenMatchesBetweenPlayers({ seasonId, userA, userB }) {
        const { data, error } = await this.supabase
            .from("matches")
            .select("*")
            .eq("season_id", seasonId)
            .not("status", "in", "(confirmed,void)")
            .or(
                `and(player_a_id.eq.${userA},player_b_id.eq.${userB}),and(player_a_id.eq.${userB},player_b_id.eq.${userA})`
            )
            .order("week", { ascending: true });

        if (error) throw error;
        return data ?? [];
    }

    async getById(matchId) {
        const { data, error } = await this.supabase
            .from("matches")
            .select("*")
            .eq("id", matchId)
            .single();

        if (error) throw error;
        return data;
    }

    async update(matchId, patch) {
        const { data, error } = await this.supabase
            .from("matches")
            .update(patch)
            .eq("id", matchId)
            .select("*")
            .single();

        if (error) throw error;
        return data;
    }
    async setResultMessage({ matchId, channelId, messageId }) {
        const { data, error } = await this.supabase
            .from("matches")
            .update({
                result_channel_id: channelId,
                result_message_id: messageId,
            })
            .eq("id", matchId)
            .select("*")
            .single();

        if (error) throw error;
        return data;
    }
    async findByPlayersInSeason({ seasonId, userA, userB }) {
        const { data, error } = await this.db
            .from("matches")
            .select("*")
            .eq("season_id", seasonId)
            .or(
                `and(player_a_id.eq.${userA},player_b_id.eq.${userB}),and(player_a_id.eq.${userB},player_b_id.eq.${userA})`
            )
            .limit(1)
            .maybeSingle();

        if (error) throw error;
        return data; // null if not found
    }
    // add inside your existing MatchesRepository
    async getById(matchId) {
        const { data, error } = await this.supabase
            .from("matches")
            .select("*")
            .eq("id", matchId)
            .single();

        if (error) throw error;
        return data;
    }

    async update(matchId, patch) {
        const { data, error } = await this.supabase
            .from("matches")
            .update(patch)
            .eq("id", matchId)
            .select("*")
            .single();

        if (error) throw error;
        return data;
    }

    async markReported({ matchId, reportedBy }) {
        const now = new Date().toISOString();
        const { data, error } = await this.db
            .from("matches")
            .update({
                status: "reported",
                reported_by: reportedBy,
                reported_at: now,
            })
            .eq("id", matchId)
            .select("*")
            .single();

        if (error) throw error;
        return data;
    }

    async markConfirmed({ matchId, confirmedBy }) {
        const now = new Date().toISOString();
        const { data, error } = await this.db
            .from("matches")
            .update({
                status: "confirmed",
                confirmed_by: confirmedBy,
                confirmed_at: now,
            })
            .eq("id", matchId)
            .select("*")
            .single();

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
    async listConfirmedWithResultsForDivision({ seasonId, divisionId }) {
        const { data, error } = await this.supabase
            .from("matches")
            .select(
                `
                id,
                season_id,
                division_id,
                week,
                player_a_id,
                player_b_id,
                status,
                match_results (
                    match_id,
                    legs_a,
                    legs_b,
                    proof_url
                )
            `
            )
            .eq("season_id", seasonId)
            .eq("division_id", divisionId)
            .eq("status", "confirmed");

        if (error) throw error;
        return data ?? [];
    }
}
