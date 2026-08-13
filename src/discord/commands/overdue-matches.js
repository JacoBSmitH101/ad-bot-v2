import {
    AttachmentBuilder,
    MessageFlags,
    PermissionFlagsBits,
    SlashCommandBuilder,
} from "discord.js";
import { renderOverdueMatchesImage } from "../../services/OverdueMatchesImageRenderer.js";
import { DomainError } from "../../utils/DomainError.js";

/**
 * Discord slash command: /overdue-matches
 * Posts a one-off public image of previous-week fixtures still awaiting a result.
 * No message reference is stored and the post is not automatically refreshed.
 * @module commands/overdue-matches
 */

export const data = new SlashCommandBuilder()
    .setName("overdue-matches")
    .setDescription("[ADMIN] Post a public reminder of overdue matches")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .setDMPermission(false)
    .addIntegerOption((option) =>
        option
            .setName("week")
            .setDescription(
                "Show matches before this week (defaults to current week)"
            )
            .setMinValue(2)
            .setMaxValue(99)
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
            content: "❌ You don’t have permission.",
            flags: MessageFlags.Ephemeral,
        });
        return;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
        const requestedWeek = interaction.options.getInteger("week");
        const { season, weeks, cutoffWeek, currentWeek } =
            await interaction.client.services.matches.getUnreportedBeforeWeek({
                guildId: interaction.guildId,
                week: requestedWeek,
            });
        const matches = weeks.flatMap((group) => group.matches ?? []);

        if (matches.length === 0) {
            await interaction.editReply(
                `✅ No overdue matches were found before Week ${cutoffWeek}.`
            );
            return;
        }

        const playerIds = [
            ...new Set(
                matches
                    .flatMap((match) => [
                        match.playerAId,
                        match.playerBId,
                    ])
                    .filter(
                        (playerId) =>
                            playerId &&
                            !String(playerId).startsWith("FAKE_")
                    )
            ),
        ];
        const players =
            await interaction.client.repos.players.listByDiscordIds({
                discordUserIds: playerIds,
            });
        const nameById = new Map(
            players.map((player) => [
                player.discord_user_id,
                player.display_name ?? player.discord_user_id,
            ])
        );
        const missingIds = playerIds.filter((id) => !nameById.has(id));
        for (const missingId of missingIds) {
            try {
                const discordUser =
                    await interaction.client.users.fetch(missingId);
                nameById.set(
                    missingId,
                    discordUser.displayName ?? discordUser.username
                );
            } catch {
                // The renderer will fall back to the Discord ID.
            }
        }

        const png = await renderOverdueMatchesImage({
            seasonName: season.name,
            cutoffWeek,
            currentWeek,
            weeks,
            nameById,
        });
        const file = new AttachmentBuilder(png, {
            name: `overdue-matches-before-week-${cutoffWeek}.png`,
            description: `${season.name} overdue matches before Week ${cutoffWeek}`,
        });

        if (!interaction.channel?.isTextBased()) {
            throw new DomainError(
                "BAD_CHANNEL",
                "This command must be used in a text channel."
            );
        }

        await interaction.channel.send({ files: [file] });
        await interaction.editReply(
            `✅ Posted ${matches.length} overdue ${
                matches.length === 1 ? "match" : "matches"
            } in this channel.`
        );
    } catch (error) {
        if (error instanceof DomainError) {
            await interaction.editReply(`❌ ${error.message}`);
            return;
        }
        console.error("Failed to post overdue matches image:", error);
        await interaction.editReply(
            "❌ The overdue matches image could not be generated. Check the bot logs for details."
        );
    }
}
