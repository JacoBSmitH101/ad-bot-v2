// src/repositories/MatchResultsRepository.js
export class MatchResultsRepository {
    constructor({ supabase, schema }) {
        this.supabase = supabase.schema(schema);
    }

    async getByMatchId(matchId) {
        const { data, error } = await this.supabase
            .from("match_results")
            .select("*")
            .eq("match_id", matchId)
            .maybeSingle();

        if (error) throw error;
        return data;
    }

    async upsert({ matchId, legsA, legsB, proofUrl }) {
        const { data, error } = await this.supabase
            .from("match_results")
            .upsert(
                {
                    match_id: matchId,
                    legs_a: legsA,
                    legs_b: legsB,
                    proof_url: proofUrl ?? null,
                },
                { onConflict: "match_id" }
            )
            .select("*")
            .maybeSingle();

        if (error) throw error;
        if (!data) {
            throw new DomainError(
                "RESULT_UPSERT_FAILED",
                "Could not save match result (no row returned)."
            );
        }
        return data;
    }

    async deleteByMatchId(matchId) {
        const { error } = await this.supabase
            .from("match_results")
            .delete()
            .eq("match_id", matchId);

        if (error) throw error;
        return true;
    }
}
