export class ScheduleRepository {
    constructor({ supabase }) {
        this.supabase = supabase;
    }

    async createProposal({ seasonId, createdBy, payload }) {
        const { data, error } = await this.supabase
            .from("schedule_proposals")
            .insert([
                {
                    season_id: seasonId,
                    created_by: createdBy,
                    payload,
                    status: "proposed",
                },
            ])
            .select("*")
            .single();

        if (error) throw error;
        return data;
    }

    async getLatestProposal(seasonId) {
        const { data, error } = await this.supabase
            .from("schedule_proposals")
            .select("*")
            .eq("season_id", seasonId)
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle();

        if (error) throw error;
        return data ?? null;
    }

    async markApproved(proposalId) {
        const { data, error } = await this.supabase
            .from("schedule_proposals")
            .update({ status: "approved" })
            .eq("id", proposalId)
            .select("*")
            .single();

        if (error) throw error;
        return data;
    }
}
