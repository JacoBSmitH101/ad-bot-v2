// src/discord/handlers/resultButtons.js
import { DomainError } from "../../utils/DomainError.js";
import { MessageFlags } from "discord.js";

export async function handleResultButtons(interaction) {
    if (!interaction.isButton()) return false;

    const id = interaction.customId;
    if (!id.startsWith("result_confirm:") && !id.startsWith("result_reject:"))
        return false;

    const [action, matchId] = id.split(":");
    if (!matchId) {
        await interaction.reply({
            content: "❌ Invalid button payload.",
            flags: MessageFlags.Ephemeral,
        });
        return true;
    }

    // basic admin gate (replace with your own approach if you already have one)
    const cfg = interaction.client.services.config;
    const isAdmin =
        (cfg.adminUserId && interaction.user.id === cfg.adminUserId) ||
        (cfg.adminRoleId &&
            interaction.member?.roles?.cache?.has(cfg.adminRoleId));

    if (!isAdmin) {
        console.log(cfg);
        await interaction.reply({
            content: "❌ You don’t have permission to do that.",
            flags: MessageFlags.Ephemeral,
        });
        return true;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
        if (action === "result_confirm") {
            const matchBefore = await interaction.client.repos.matches.getById(
                matchId
            );
            const before =
                await interaction.client.services.standings.getDivisionStandings(
                    {
                        guildId: interaction.guildId,
                        divisionId: matchBefore.division_id,
                    }
                );
            await interaction.client.services.results.confirm({
                guildId: interaction.guildId,
                adminDiscordUserId: interaction.user.id,
                adminDisplayName:
                    interaction.member?.displayName ??
                    interaction.user.username,
                matchId,
            });

            const match = await interaction.client.repos.matches.getById(
                matchId
            );
            const resultRow =
                await interaction.client.repos.matchResults.getByMatchId(
                    matchId
                ); // add if you don’t have it

            // standings AFTER (division)
            const after =
                await interaction.client.services.standings.getDivisionStandings(
                    {
                        guildId: interaction.guildId,
                        divisionId: matchBefore.division_id,
                    }
                );

            const scoreText = resultRow
                ? `${resultRow.legs_a}-${resultRow.legs_b}`
                : null;
            await interaction.client.services.standingsPublisher.refresh({
                client: interaction.client,
                guildId: interaction.guildId,
                context: {
                    divisionId: matchBefore.division_id,
                    playerAId: match.player_a_id,
                    playerBId: match.player_b_id,
                    scoreText,
                    actorName: interaction.user.username,
                    beforeStandings: before.standings,
                    afterStandings: after.standings,
                },
            });
            await updatePlayerResultEmbed({
                client: interaction.client,
                match,
                status: "confirmed",
                actorName: interaction.user.username,
            });

            await interaction.editReply("✅ Result confirmed.");
            await interaction.message.edit({
                content: "✅ Confirmed",
                components: [],
            });

            await interaction.client.services.fixturesPublisher.refresh({
                client: interaction.client,
                guildId: interaction.guildId,
            });

            return true;
        }

        if (action === "result_reject") {
            await interaction.client.services.results.reject({
                guildId: interaction.guildId,
                adminDiscordUserId: interaction.user.id,
                adminDisplayName:
                    interaction.member?.displayName ??
                    interaction.user.username,
                matchId,
            });

            const match = await interaction.client.repos.matches.getById(
                matchId
            );

            await updatePlayerResultEmbed({
                client: interaction.client,
                match,
                status: "rejected",
                actorName: interaction.user.username,
            });

            await interaction.editReply(
                "❌ Result rejected (match reset to scheduled)."
            );
            await interaction.message.edit({
                content: "❌ Rejected",
                components: [],
            });
            return true;
        }

        await interaction.editReply("❌ Unknown action.");
        return true;
    } catch (err) {
        if (err instanceof DomainError) {
            await interaction.editReply(`❌ ${err.message}`);
            return true;
        }
        console.error(err);
        await interaction.editReply("❌ Something went wrong.");
        return true;
    }
}
import { EmbedBuilder } from "discord.js";

function statusToEmbedPatch(status, actorName) {
    if (status === "confirmed") {
        return {
            color: 0x22c55e,
            title: "✅ Match Completed",
            footer: `Confirmed by ${actorName}`,
        };
    }
    return {
        color: 0xef4444,
        title: "❌ Result Rejected",
        footer: `Rejected by ${actorName}`,
    };
}

async function updatePlayerResultEmbed({ client, match, status, actorName }) {
    if (!match.result_channel_id || !match.result_message_id) return;

    const channel = await client.channels
        .fetch(match.result_channel_id)
        .catch(() => null);
    if (!channel || !channel.isTextBased()) return;

    const message = await channel.messages
        .fetch(match.result_message_id)
        .catch(() => null);
    if (!message) return;

    const old = message.embeds?.[0];
    if (!old) return;

    const patch = statusToEmbedPatch(status, actorName);

    const updated = EmbedBuilder.from(old)
        .setColor(patch.color)
        .setTitle(patch.title)
        .setFooter({ text: patch.footer });

    await message.edit({ embeds: [updated] });
}
