import "dotenv/config";
import fs from "fs";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";
import {
    Client,
    Collection,
    GatewayIntentBits,
    Events,
    MessageFlags,
} from "discord.js";
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
import { MatchResultsRepository } from "./repositories/MatchResultRepository.js";
import { ResultService } from "./services/ResultService.js";
import { ResultsNotifierService } from "./services/ResultsNotifierService.js";
import { handleResultButtons } from "./discord/handlers/resultButtons.js";
import { DivisionPlayersRepository } from "./repositories/DivisionPlayersRepository.js";
import { StandingsService } from "./services/StandingsService.js";
import { handleStandingsButtons } from "./discord/handlers/standingsButtons.js";
import { StandingsPublisherService } from "./services/StandingsPublisherService.js";
import { MatchesService } from "./services/MatchesService.js";
import { FixturesPublisherService } from "./services/FixturesPublisherService.js";
import { InternalApiClient } from "./services/InternalApiClient.js";
import { MatchStatsService } from "./services/MatchStatsService.js";
import { SignupsPublisherService } from "./services/SignupsPublisherService.js";
import { StatsLeadersPublisherService } from "./services/StatsLeadersPublisherService.js";
import { PlayerStatsService } from "./services/PlayerStatsService.js";

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
const schema = env.SUPABASE_DB_SCHEMA || "public";

const internalApi = new InternalApiClient({
    baseUrl: env.INTERNAL_API_BASE_URL,
    internalKey: env.INTERNAL_API_KEY,
});
client.repos = {
    seasons: new SeasonRepository({ supabase, schema }),
    players: new PlayersRepository({ supabase, schema }),
    signups: new SignupRepository({ supabase, schema }),
    divisions: new DivisionRepository({ supabase, schema }),
    schedules: new ScheduleRepository({ supabase, schema }),
    matches: new MatchRepository({ supabase, schema }),
    matchResults: new MatchResultsRepository({ supabase, schema }),
    divisionPlayers: new DivisionPlayersRepository({ supabase, schema }),
};

const matchStatsService = new MatchStatsService({
    internalApi,
    matches: client.repos.matches,
    matchResults: client.repos.matchResults,
});

client.services = {
    resultsNotifier: new ResultsNotifierService({
        config: {
            resultsReviewChannelId: env.RESULTS_REVIEW_CHANNEL ?? null,
            adminUserId: env.ADMIN_USER_ID ?? null,
        },
    }),
    results: new ResultService({
        matches: client.repos.matches,
        matchResults: client.repos.matchResults,
        players: client.repos.players,
        seasons: client.repos.seasons,
    }),
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
        players: client.repos.players,
    }),
    standings: new StandingsService({
        divisions: client.repos.divisions,
        divisionPlayers: client.repos.divisionPlayers,
        seasons: client.repos.seasons,
        matchResults: client.repos.matchResults,
        matches: client.repos.matches,
    }),
    matches: new MatchesService({
        matches: client.repos.matches,
        seasons: client.repos.seasons,
        divisions: client.repos.divisions,
    }),
    fixturesPublisher: new FixturesPublisherService({
        seasons: client.repos.seasons,
        matches: client.repos.matches,
        divisions: client.repos.divisions,
        players: client.repos.players,
    }),
    signupsPublisher: new SignupsPublisherService({
        seasons: client.repos.seasons,
        signups: client.repos.signups,
    }),
    matchStats: matchStatsService,
    playerStats: new PlayerStatsService({
        seasons: client.repos.seasons,
        matches: client.repos.matches,
        players: client.repos.players,
        matchStats: matchStatsService,
    }),
    internalApi: internalApi,
    config: {
        adminUserId: env.ADMIN_USER_ID ?? null,
        adminRoleId: env.ADMIN_ROLE_ID ?? null,
    },
};
client.services.standingsPublisher = new StandingsPublisherService({
    standings: client.services.standings,
    seasons: client.repos.seasons,
    matches: client.repos.matches,
    players: client.repos.players,
});
client.services.statsLeadersPublisher = new StatsLeadersPublisherService({
    seasons: client.repos.seasons,
    matches: client.repos.matches,
    players: client.repos.players,
});

// Load commands (execute handlers) from files
client.commands = new Collection();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const commandsPath = path.join(__dirname, "discord", "commands");
const commandFiles = fs
    .readdirSync(commandsPath)
    .filter((f) => f.endsWith(".js"));

const isProduction = process.env.NODE_ENV === "production";

for (const file of commandFiles) {
    const filePath = path.join(commandsPath, file);
    const mod = await import(pathToFileURL(filePath).href);

    if (!mod?.data?.name || typeof mod.execute !== "function") {
        console.warn(`Skipping ${file} (needs exports: data + execute)`);
        continue;
    }

    // Skip dev-only commands in production
    if (isProduction && mod.data.name === "resultdev") {
        console.log(`Skipping dev command: ${mod.data.name}`);
        continue;
    }

    client.commands.set(mod.data.name, mod);
}

client.once(Events.ClientReady, async () => {
    console.log(`✅ Logged in as ${client.user.tag}`);

    // Refresh published messages after restart so they stay in sync
    for (const guild of client.guilds.cache.values()) {
        await client.services.signupsPublisher
            .refresh({ client, guildId: guild.id })
            .catch((err) =>
                console.error(
                    `Failed to refresh signups for guild ${guild.id}:`,
                    err?.message ?? err
                )
            );
    }
});

client.on(Events.InteractionCreate, async (interaction) => {
    if (interaction.isButton()) {
        if (await handleResultButtons(interaction)) return;
        if (await handleStandingsButtons(interaction)) return;
    }
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
                .followUp({ content: message, flags: MessageFlags.Ephemeral })
                .catch(() => {});
        } else {
            await interaction
                .reply({ content: message, flags: MessageFlags.Ephemeral })
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
