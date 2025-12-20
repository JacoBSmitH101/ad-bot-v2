// src/repositories/DivisionPlayersRepository.js
export class DivisionPlayersRepository {
    constructor({ supabase, schema }) {
        this.supabase = supabase.schema(schema);
    }

    async listPlayersForDivision(divisionId) {
        const { data, error } = await this.supabase
            .from("division_players")
            .select(
                `
                discord_user_id,
                seed_avg,
                seed_rank,
                players (
                    discord_user_id,
                    display_name
                )
            `
            )
            .eq("division_id", divisionId);

        if (error) throw error;

        // normalize to a clean array: { discord_user_id, display_name }
        return (data ?? []).map((row) => ({
            discord_user_id: row.discord_user_id,
            display_name: row.players?.display_name ?? null,
            seed_avg: row.seed_avg,
            seed_rank: row.seed_rank,
        }));
    }
}
