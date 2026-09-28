import { SlashCommandBuilder, MessageFlags, PermissionFlagsBits } from "discord.js";
import { DomainError } from "../../utils/DomainError.js";

export const data = new SlashCommandBuilder()
    .setName("division-void")
    .setDescription("[ADMIN] Void all remaining games in a division (0–0, no points)")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .setDMPermission(false)
    .addStringOption((option) => option
        .setName("division")
        .setDescription('Division name or number, e.g. "Div 1" or "1"')
        .setRequired(true));

/** Void open games only; refresh failures must not imply the mutation failed. */
export async function execute(interaction) {
    const config = interaction.client.services.config;
    const allowed = interaction.guildId && (
        interaction.memberPermissions?.has(PermissionFlagsBits.Administrator) ||
        interaction.user.id === config.adminUserId ||
        (config.adminRoleId && interaction.member?.roles?.cache?.has(config.adminRoleId))
    );
    if (!allowed) {
        await interaction.reply({ content: "❌ You don't have permission to do that.", flags: MessageFlags.Ephemeral });
        return;
    }
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    let result;
    try {
        result = await interaction.client.services.results.adminVoidRemainingDivision({
            guildId: interaction.guildId,
            divisionName: interaction.options.getString("division", true),
        });
    } catch (error) {
        console.error(error);
        await interaction.editReply(error instanceof DomainError
            ? `❌ ${error.message}`
            : "❌ Could not void the division's remaining games.");
        return;
    }

    const { season, division, updated, cleanupFailed } = result;
    const summary = `🚫 Voided **${updated.length}** remaining game(s) in **${division.name}**, **${season.name}**.\n`
        + "Scheduled, reported and disputed games are void; confirmed results are unchanged.\n"
        + "Voids display as **0–0**, award **0 points** to both players and do not count as played, wins or losses.";
    await interaction.editReply(summary + "\nRefreshing published tables and fixtures…");

    const services = interaction.client.services;
    const publishers = ["standingsPublisher", "fixturesPublisher", "statsLeadersPublisher"];
    const refreshes = await Promise.allSettled(publishers.map((key) =>
        services[key]?.refresh({ client: interaction.client, guildId: interaction.guildId })));
    const failures = publishers.filter((key, index) => {
        if (refreshes[index].status !== "rejected") return false;
        console.error(`${key} refresh failed after division void:`, refreshes[index].reason);
        return true;
    });
    const warnings = [];
    if (cleanupFailed) warnings.push("Result cleanup needs a retry. Run this command again; voided games already award no points.");
    if (failures.length) warnings.push("Some published messages could not refresh. Run this command again to retry.");
    await interaction.editReply([summary, ...warnings].join("\n"));
}
