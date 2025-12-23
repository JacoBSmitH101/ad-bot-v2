/**
 * @typedef {Object} ScheduleProposal
 * @property {number} id
 * @property {string|number} season_id
 * @property {string} created_by
 * @property {Object} payload - JSON object containing divisions + weeks
 * @property {string} status - One of: 'proposed', 'approved'
 * @property {string} created_at
 * @property {string} updated_at
 */

/**
 * Repository for managing schedule proposals.
 * Expects a Supabase client already configured with auth; all methods throw
 * on database errors.
 */
export class ScheduleRepository {
    /**
     * @param {{ supabase: object, schema: string }} deps
     * @param {object} deps.supabase Supabase client instance.
     * @param {string} deps.schema Postgres schema name to scope all queries.
     */
    constructor({ supabase, schema }) {
        this.supabase = supabase.schema(schema);
    }

    /**
     * Create a new schedule proposal.
     * @param {{ seasonId: string|number, createdBy: string, payload: Object }} params
     * @returns {Promise<ScheduleProposal>}
     */
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

    /**
     * Get the latest schedule proposal for a season.
     * @param {string|number} seasonId
     * @returns {Promise<(ScheduleProposal|null)>} Proposal object or null if none found.
     */
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

    /**
     * Mark a schedule proposal as approved.
     * @param {string|number} proposalId
     * @returns {Promise<ScheduleProposal>}
     */
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
