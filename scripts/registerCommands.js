import "dotenv/config";
import fs from "fs";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";
import { REST, Routes } from "discord.js";

const token = process.env.DISCORD_TOKEN;
const clientId = process.env.DISCORD_CLIENT_ID;
const guildId = process.env.GUILD_ID;

if (!token || !clientId || !guildId) {
    console.error(
        "Missing DISCORD_TOKEN, DISCORD_CLIENT_ID, or GUILD_ID in .env"
    );
    process.exit(1);
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load command definitions from src/discord/commands
const commands = [];
const commandsPath = path.join(__dirname, "..", "src", "discord", "commands");
const commandFiles = fs
    .readdirSync(commandsPath)
    .filter((f) => f.endsWith(".js"));

for (const file of commandFiles) {
    const filePath = path.join(commandsPath, file);
    const mod = await import(pathToFileURL(filePath).href);

    if (!mod?.data?.toJSON) {
        console.warn(`Skipping ${file} (missing export: data)`);
        continue;
    }

    commands.push(mod.data.toJSON());
}

const rest = new REST({ version: "10" }).setToken(token);

try {
    console.log(`Registering ${commands.length} guild command(s)...`);
    await rest.put(Routes.applicationGuildCommands(clientId, guildId), {
        body: commands,
    });
    console.log("✅ Guild commands registered");
} catch (err) {
    console.error("❌ Failed to register commands:", err);
    process.exit(1);
}
