import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);
if (process.env.NODE_ENV === "production") {
    throw new Error("Refusing to seed in production");
}

const FAKE_PLAYERS = 19;

async function run() {
    // get latest season
    const { data: season, error } = await supabase
        .from("seasons")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(1)
        .single();

    if (error || !season) {
        throw new Error("No season found");
    }

    console.log(`Seeding ${FAKE_PLAYERS} fake players into ${season.name}`);

    for (let i = 1; i <= FAKE_PLAYERS; i++) {
        const id = `FAKE_${String(i).padStart(3, "0")}`;
        const avg = Number((40 + Math.random() * 20).toFixed(1)); // 40–60 avg

        // upsert player
        await supabase.from("players").upsert({
            discord_user_id: id,
            display_name: `Fake Player ${i}`,
        });

        // upsert signup
        await supabase.from("signups").upsert({
            season_id: season.id,
            discord_user_id: id,
            avg_3dart: avg,
        });

        console.log(`✔ ${id} avg=${avg}`);
    }

    console.log("Done.");
}

run().catch((e) => {
    console.error(e);
    process.exit(1);
});
