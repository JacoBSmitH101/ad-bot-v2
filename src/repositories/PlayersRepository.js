export class PlayersRepository {
    constructor({ supabase, schema }) {
        this.supabase = supabase.schema(schema);
    }

    async upsert({ discordUserId, displayName }) {
        const { data, error } = await this.supabase
            .from("players")
            .upsert(
                {
                    discord_user_id: discordUserId,
                    display_name: displayName ?? null,
                },
                { onConflict: "discord_user_id" }
            )
            .select("*")
            .single();

        if (error) throw error;
        return data;
    }
}
