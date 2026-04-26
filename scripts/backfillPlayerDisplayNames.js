/**
 * One-off: resolve Discord display names for players where display_name is missing
 * (SQL NULL or empty string '')
 * and upsert into `players`.
 *
 * Requires same .env as the bot (DISCORD_TOKEN, GUILD_ID, Supabase vars).
 * Prefer server nickname: uses guild member when GUILD_MEMBERS intent is enabled;
 * otherwise falls back to user.globalName / user.username.
 *
 * Usage: node scripts/backfillPlayerDisplayNames.js
 * Optional: DRY_RUN=1 node scripts/backfillPlayerDisplayNames.js
 */
import "dotenv/config";
import { Client, GatewayIntentBits } from "discord.js";
import { supabase } from "../src/db/supabase.js";
import { PlayersRepository } from "../src/repositories/PlayersRepository.js";

const schema = process.env.SUPABASE_DB_SCHEMA || "public";
const dryRun = process.env.DRY_RUN === "1" || process.env.DRY_RUN === "true";
const token = process.env.DISCORD_TOKEN;
const guildId = process.env.GUILD_ID;

const SNOWFLAKE_RE = /^\d{15,25}$/;

function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
}

async function resolveDisplayName(client, guild, discordUserId) {
    if (guild) {
        try {
            const member = await guild.members.fetch(discordUserId);
            if (member?.displayName) return member.displayName;
        } catch {
            // missing intent or user left server — fall through
        }
    }
    const user = await client.users.fetch(discordUserId).catch(() => null);
    if (!user) return null;
    return user.globalName ?? user.username ?? null;
}

async function main() {
    if (!token) {
        console.error("Missing DISCORD_TOKEN");
        process.exit(1);
    }

    console.log(`Supabase schema: "${schema}" (set SUPABASE_DB_SCHEMA if this is wrong)`);

    const players = new PlayersRepository({ supabase, schema });
    const rows = await players.listWithNullDisplayName();
    const ids = rows
        .map((r) => r.discord_user_id)
        .filter((id) => SNOWFLAKE_RE.test(String(id)));

    const skipped = rows.length - ids.length;
    console.log(
        `Found ${rows.length} row(s) with display_name NULL (${ids.length} Discord snowflakes, ${skipped} skipped non-ID)`
    );

    if (!ids.length) {
        console.log("Nothing to do.");
        return;
    }

    const client = new Client({
        intents: [
            GatewayIntentBits.Guilds,
            GatewayIntentBits.GuildMembers,
        ],
    });

    await client.login(token);
    const guild = guildId
        ? await client.guilds.fetch(guildId).catch(() => null)
        : null;
    if (guildId && !guild) {
        console.warn(`Could not fetch guild ${guildId}; using user-only names.`);
    }

    let updated = 0;
    let failed = 0;
    let unchanged = 0;

    for (let i = 0; i < ids.length; i++) {
        const discordUserId = ids[i];
        let displayName = null;
        try {
            displayName = await resolveDisplayName(client, guild, discordUserId);
        } catch (e) {
            console.warn(`Lookup failed ${discordUserId}:`, e?.message ?? e);
            failed++;
            await sleep(350);
            continue;
        }

        if (!displayName) {
            console.warn(`No name for ${discordUserId} (not in guild / unknown user)`);
            unchanged++;
            await sleep(350);
            continue;
        }

        if (dryRun) {
            console.log(`[dry-run] ${discordUserId} -> ${displayName}`);
        } else {
            await players.upsert({
                discordUserId,
                displayName,
            });
            updated++;
            if (updated % 10 === 0 || i === ids.length - 1) {
                console.log(`Progress: ${i + 1}/${ids.length} (updated ${updated})`);
            }
        }

        await sleep(350);
    }

    await client.destroy();

    console.log(
        dryRun
            ? `Done (dry run). Would update ${ids.length - unchanged - failed} name(s); failed lookups: ${failed}; no name: ${unchanged}`
            : `Done. Updated: ${updated}, failed: ${failed}, no name: ${unchanged}`
    );
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
