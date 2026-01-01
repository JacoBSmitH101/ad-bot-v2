import { DomainError } from "../utils/DomainError.js";

/**
 * @typedef {Object} MatchResult
 * @property {string|number} match_id
 * @property {number} legs_a
 * @property {number} legs_b
 * @property {string|null} proof_url
 * @property {string} created_at
 * @property {string} updated_at
 */

/**
 * Repository for managing match results.
 * Expects a Supabase client already configured with auth; all methods throw
 * on database errors.
 */
export class MatchResultsRepository {
    /**
     * @param {{ supabase: object, schema: string }} deps
     * @param {object} deps.supabase Supabase client instance.
     * @param {string} deps.schema Postgres schema name to scope all queries.
     */
    constructor({ supabase, schema }) {
        this.supabase = supabase.schema(schema);
    }

    /**
     * Get match result by match ID.
     * @param {string|number} matchId
     * @returns {Promise<(MatchResult|null)>} Result object or null if not found.
     */
    async getByMatchId(matchId) {
        const { data, error } = await this.supabase
            .from("match_results")
            .select("*")
            .eq("match_id", matchId)
            .maybeSingle();

        if (error) throw error;
        return data;
    }

    /**
     * Upsert a match result. Creates or updates based on match_id.
     * @param {{ matchId: string|number, legsA: number, legsB: number, proofUrl: (string|null) }} params
     * @returns {Promise<MatchResult>}
     * @throws {DomainError} If upsert fails (no row returned).
     */
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

    /**
     * Delete match result by match ID.
     * @param {string|number} matchId
     * @returns {Promise<boolean>} Always returns true on success.
     */
    async deleteByMatchId(matchId) {
        const { error } = await this.supabase
            .from("match_results")
            .delete()
            .eq("match_id", matchId);

        if (error) throw error;
        return true;
    }
}
