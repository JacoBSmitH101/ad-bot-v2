import {
    AttachmentBuilder,
    MessageFlags,
    PermissionFlagsBits,
    SlashCommandBuilder,
} from "discord.js";
import {
    combineFixtureImages,
    renderFixturesImage,
} from "../../services/FixturesImageRenderer.js";

/**
 * Discord slash command: /fixtures-preview
 * Admin-only command that posts website-style fixture images to the channel.
 * It does not create or edit the official published fixtures message.
 * @module commands/fixtures-preview
 */

export const data = new SlashCommandBuilder()
    .setName("fixtures-preview")
    .setDescription("[ADMIN] Post website-style weekly fixture images")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .setDMPermission(false)
    .addIntegerOption((option) =>
        option
            .setName("week")
            .setDescription("Week to show (defaults to the season's current week)")
            .setMinValue(1)
            .setMaxValue(99)
            .setRequired(false)
    )
    .addIntegerOption((option) =>
        option
            .setName("division")
            .setDescription("Division number to show (leave empty for all)")
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

    await interaction.deferReply();

    try {
        const currentSeason =
            await interaction.client.repos.seasons.getCurrentForGuild(
                interaction.guildId
            );
        const currentCanShowFixtures = ["active", "closed"].includes(
            currentSeason?.status
        );
        const previewSeason = currentCanShowFixtures
            ? currentSeason
            : await interaction.client.repos.seasons.getLatestStandingsSeasonForGuild(
                  interaction.guildId
              );

        if (!previewSeason) {
            await interaction.editReply(
                "No active or completed season is available to preview."
            );
            return;
        }

        const week = Number(
            interaction.options.getInteger("week") ??
                previewSeason.current_week ??
                previewSeason.fixtures_week ??
                1
        );
        const requestedDivision = interaction.options.getInteger("division");
        const divisions =
            await interaction.client.repos.divisions.listForSeason(
                previewSeason.id
            );
        const selectedDivisions = requestedDivision
            ? divisions.filter(
                  (division, index) =>
                      Number(division.sort_order) === requestedDivision ||
                      index + 1 === requestedDivision
              )
            : divisions;

        if (selectedDivisions.length === 0) {
            await interaction.editReply(
                requestedDivision
                    ? `No Division ${requestedDivision} exists in ${previewSeason.name}.`
                    : `No divisions exist in ${previewSeason.name}.`
            );
            return;
        }

        const matches =
            await interaction.client.repos.matches.listForSeasonWeekWithResults({
                seasonId: previewSeason.id,
                week,
            });
        const overdueMatches =
            await interaction.client.repos.matches.listUnreportedBeforeWeek({
                seasonId: previewSeason.id,
                week,
            });
        const playerIds = [
            ...new Set(
                [...matches, ...overdueMatches].flatMap((match) => [
                    match.player_a_id,
                    match.player_b_id,
                ])
            ),
        ];
        const realPlayerIds = playerIds.filter(
            (playerId) => !String(playerId).startsWith("FAKE_")
        );
        const players =
            await interaction.client.repos.players.listByDiscordIds({
                discordUserIds: realPlayerIds,
            });
        const nameById = new Map(
            players.map((player) => [
                player.discord_user_id,
                player.display_name ?? player.discord_user_id,
            ])
        );

        const divisionImages = [];
        for (const division of selectedDivisions.slice(0, 10)) {
            const divisionMatches = matches
                .filter(
                    (match) =>
                        String(match.division_id) === String(division.id)
                )
                .sort((a, b) => String(a.id).localeCompare(String(b.id)));
            const divisionOverdueMatches = overdueMatches
                .filter(
                    (match) =>
                        String(match.division_id) === String(division.id)
                )
                .sort(
                    (a, b) =>
                        Number(a.week) - Number(b.week) ||
                        String(a.id).localeCompare(String(b.id))
                );
            const png = await renderFixturesImage({
                seasonName: previewSeason.name,
                divisionName: division.name,
                week,
                matches: divisionMatches,
                overdueMatches: divisionOverdueMatches,
                nameById,
            });
            divisionImages.push(png);
        }

        const combinedPng = await combineFixtureImages(divisionImages);
        const file = new AttachmentBuilder(combinedPng, {
            name: `fixtures-week-${week}.png`,
            description: `${previewSeason.name} Week ${week} fixtures`,
        });
        const showingPreviousSeason =
            currentSeason &&
            String(currentSeason.id) !== String(previewSeason.id);
        const previewMessage = showingPreviousSeason
            ? `Showing **${previewSeason.name} — Week ${week}** because **${currentSeason.name}** has not started yet.`
            : `Showing **${previewSeason.name} — Week ${week}** fixtures.`;

        await interaction.editReply({
            content: previewMessage,
            files: [file],
        });
    } catch (error) {
        console.error("Failed to build fixtures image preview:", error);
        await interaction.editReply(
            "The fixtures image could not be generated. Check the bot logs for details."
        );
    }
}
