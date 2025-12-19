import "dotenv/config";
import fs from "fs";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";
import { Client, Collection, GatewayIntentBits } from "discord.js";
import { env } from "./config/env.js";
import { supabase } from "./db/supabase.js";
import { SeasonRepository } from "./repositories/SeasonRepository.js";
import { SeasonService } from "./services/SeasonService.js";
import { DomainError } from "./utils/DomainError.js";
import { PlayersRepository } from "./repositories/PlayersRepository.js";
import { SignupRepository } from "./repositories/SignupRepository.js";
import { SignupService } from "./services/SignupService.js";
import { DivisionRepository } from "./repositories/DivisionRepository.js";
import { DivisionService } from "./services/DivisionService.js";
import { ScheduleRepository } from "./repositories/ScheduleRepository.js";
import { MatchRepository } from "./repositories/MatchRepository.js";
import { ScheduleService } from "./services/ScheduleService.js";

async function dbPing() {
    const { error } = await supabase.from("seasons").select("id").limit(1);
    if (error) {
        console.error("❌ Supabase connection failed:", error.message);
        process.exit(1);
    }
    console.log("✅ Supabase connected");
}

await dbPing();

const token = env.DISCORD_TOKEN;
if (!token) {
    console.error("Missing DISCORD_TOKEN in .env");
    process.exit(1);
}

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.repos = {
    seasons: new SeasonRepository({ supabase }),
    players: new PlayersRepository({ supabase }),
    signups: new SignupRepository({ supabase }),
    divisions: new DivisionRepository({ supabase }),
    schedules: new ScheduleRepository({ supabase }),
    matches: new MatchRepository({ supabase }),
};
client.services = {
    seasons: new SeasonService({
        seasons: client.repos.seasons,
        matches: client.repos.matches,
        signups: client.repos.signups,
    }),
    signups: new SignupService({
        seasons: client.repos.seasons,
        players: client.repos.players,
        signups: client.repos.signups,
    }),
    divisions: new DivisionService({
        divisions: client.repos.divisions,
        seasons: client.repos.seasons,
        signups: client.repos.signups,
    }),
    schedules: new ScheduleService({
        seasons: client.repos.seasons,
        divisions: client.repos.divisions,
        schedules: client.repos.schedules,
        matches: client.repos.matches,
    }),
};

// Load commands (execute handlers) from files
client.commands = new Collection();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const commandsPath = path.join(__dirname, "discord", "commands");
const commandFiles = fs
    .readdirSync(commandsPath)
    .filter((f) => f.endsWith(".js"));

for (const file of commandFiles) {
    const filePath = path.join(commandsPath, file);
    const mod = await import(pathToFileURL(filePath).href);

    if (!mod?.data?.name || typeof mod.execute !== "function") {
        console.warn(`Skipping ${file} (needs exports: data + execute)`);
        continue;
    }

    client.commands.set(mod.data.name, mod);
}

client.once("ready", () => {
    console.log(`✅ Logged in as ${client.user.tag}`);
});

client.on("interactionCreate", async (interaction) => {
    if (!interaction.isChatInputCommand()) return;

    const command = client.commands.get(interaction.commandName);
    if (!command) return;

    try {
        await command.execute(interaction);
    } catch (err) {
        console.error(err);

        const message =
            err instanceof DomainError
                ? `❌ ${err.message}`
                : "❌ Error running command";

        if (interaction.deferred || interaction.replied) {
            await interaction
                .followUp({ content: message, ephemeral: true })
                .catch(() => {});
        } else {
            await interaction
                .reply({ content: message, ephemeral: true })
                .catch(() => {});
        }
    }
});

process.on("unhandledRejection", (err) =>
    console.error("Unhandled rejection:", err)
);
process.on("uncaughtException", (err) =>
    console.error("Uncaught exception:", err)
);

await client.login(token);
