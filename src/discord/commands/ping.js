import { SlashCommandBuilder, PermissionFlagsBits } from "discord.js";

/**
 * Discord slash command: /ping
 * Simple test command that replies with "pong". Admin only.
 * @module commands/ping
 */

export const data = new SlashCommandBuilder()
    .setName("ping")
    .setDescription("Replies with pong")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);

/**
 * Execute the /ping command.
 * @param {Object} interaction - Discord ChatInputCommandInteraction object.
 * @returns {Promise<void>}
 */
export async function execute(interaction) {
    await interaction.reply("pong 🏓");
}
