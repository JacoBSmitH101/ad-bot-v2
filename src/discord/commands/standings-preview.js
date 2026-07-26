import {
    AttachmentBuilder,
    MessageFlags,
    PermissionFlagsBits,
    SlashCommandBuilder,
} from "discord.js";
import { DomainError } from "../../utils/DomainError.js";
import { renderStandingsImage } from "../../services/StandingsImageRenderer.js";

/**
 * Discord slash command: /standings-preview
 * Admin-only, ephemeral trial of image-based standings.
 * It does not create or edit the official published standings messages.
 * @module commands/standings-preview
 */

export const data = new SlashCommandBuilder()
    .setName("standings-preview")
    .setDescription("[ADMIN] Preview website-style standings images")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .setDMPermission(false)
    .addIntegerOption((option) =>
        option
            .setName("division")
            .setDescription("Division number to preview (leave empty for all)")
            .setMinValue(1)
            .setMaxValue(10)
            .setRequired(false)
    );

export async function execute(interaction) {
    const cfg = interaction.client.services.config;
    const isConfiguredAdmin =
        (cfg.adminUserId && interaction.user.id === cfg.adminUserId) ||
        (cfg.adminRoleId &&
            interaction.member?.roles?.cache?.has(cfg.adminRoleId));
    const isServerAdmin = interaction.memberPermissions?.has(
        PermissionFlagsBits.Administrator
    );

    if (!isConfiguredAdmin && !isServerAdmin) {
        await interaction.reply({
            content: "You don't have permission to use this preview.",
            flags: MessageFlags.Ephemeral,
        });
        return;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
        const result =
            await interaction.client.services.standings.getStandingsForCurrentSeason(
                { guildId: interaction.guildId }
            );
        const requestedDivision = interaction.options.getInteger("division");
        const selected = requestedDivision
            ? result.divisions.filter(
                  ({ division }, index) =>
                      Number(division.sort_order) === requestedDivision ||
                      index + 1 === requestedDivision
              )
            : result.divisions;

        if (selected.length === 0) {
            await interaction.editReply(
                `No Division ${requestedDivision} exists in the current season.`
            );
            return;
        }

        const files = [];
        for (const entry of selected.slice(0, 10)) {
            const divisionIndex = result.divisions.findIndex(
                ({ division }) => String(division.id) === String(entry.division.id)
            );
            const averages =
                await interaction.client.services.standingsPublisher.getPlayerAverages(
                    result.season.id,
                    entry.standings
                );
            const png = await renderStandingsImage({
                seasonName: result.season.name,
                divisionName: entry.division.name,
                standings: entry.standings,
                playerAverages: averages,
                isTopDivision: divisionIndex === 0,
                isBottomDivision: divisionIndex === result.divisions.length - 1,
            });
            const safeDivisionName = String(entry.division.name)
                .toLowerCase()
                .replace(/[^a-z0-9]+/g, "-")
                .replace(/^-|-$/g, "");
            files.push(
                new AttachmentBuilder(png, {
                    name: `standings-${safeDivisionName || divisionIndex + 1}.png`,
                    description: `${result.season.name} ${entry.division.name} standings preview`,
                })
            );
        }

        await interaction.editReply({
            content:
                "Image preview only — this has not changed the official published standings.",
            files,
        });
    } catch (error) {
        if (error instanceof DomainError) {
            await interaction.editReply(error.message);
            return;
        }
        console.error("Failed to build standings image preview:", error);
        await interaction.editReply(
            "The standings image could not be generated. Check the bot logs for details."
        );
    }
}
