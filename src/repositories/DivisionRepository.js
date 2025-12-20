export class DivisionRepository {
    constructor({ supabase, schema }) {
        this.supabase = supabase.schema(schema);
    }

    async createMany({ seasonId, count }) {
        const rows = Array.from({ length: count }, (_, i) => ({
            season_id: seasonId,
            name: `Div ${i + 1}`,
            sort_order: i + 1,
        }));

        const { data, error } = await this.supabase
            .from("divisions")
            .insert(rows)
            .select("*")
            .order("sort_order", { ascending: true });

        if (error) throw error;
        return data;
    }

    async listBySeason(seasonId) {
        const { data, error } = await this.supabase
            .from("divisions")
            .select("*")
            .eq("season_id", seasonId)
            .order("sort_order", { ascending: true });

        if (error) throw error;
        return data;
    }

    async clearPlayersForSeason(seasonId) {
        // delete membership for all divisions in this season
        const { data: divs, error: divErr } = await this.supabase
            .from("divisions")
            .select("id")
            .eq("season_id", seasonId);

        if (divErr) throw divErr;
        if (!divs?.length) return;

        const ids = divs.map((d) => d.id);

        const { error } = await this.supabase
            .from("division_players")
            .delete()
            .in("division_id", ids);

        if (error) throw error;
    }

    async addPlayersBulk(rows) {
        // rows: [{division_id, discord_user_id, seed_avg, seed_rank}]
        const { data, error } = await this.supabase
            .from("division_players")
            .insert(rows)
            .select("*");

        if (error) throw error;
        return data;
    }
    async listDivisionPlayers(divisionId) {
        const { data, error } = await this.supabase
            .from("division_players")
            .select("discord_user_id, seed_avg, seed_rank")
            .eq("division_id", divisionId)
            .order("seed_avg", { ascending: false });

        if (error) throw error;
        return data;
    }

    async listAllDivisionPlayersForSeason(seasonId) {
        const { data: divs, error: divErr } = await this.supabase
            .from("divisions")
            .select("id, name, sort_order")
            .eq("season_id", seasonId)
            .order("sort_order", { ascending: true });

        if (divErr) throw divErr;

        const result = [];
        for (const d of divs) {
            const players = await this.listDivisionPlayers(d.id);
            result.push({ division: d, players });
        }
        return result;
    }
    async setChannel(divisionId, channelId) {
        const { data, error } = await this.supabase
            .from("divisions")
            .update({ channel_id: channelId })
            .eq("id", divisionId)
            .select("*")
            .single();

        if (error) throw error;
        return data;
    }
    async getBySeasonAndName(seasonId, name) {
        const { data, error } = await this.supabase
            .from("divisions")
            .select("*")
            .eq("season_id", seasonId)
            .eq("name", name)
            .maybeSingle();

        if (error) throw error;
        return data ?? null;
    }
    async listForSeason(seasonId) {
        const { data, error } = await this.supabase
            .from("divisions")
            .select("*")
            .eq("season_id", seasonId)
            .order("sort_order", { ascending: true });

        if (error) throw error;
        return data ?? [];
    }
}
