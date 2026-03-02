import {
    SlashCommandBuilder,
    EmbedBuilder,
    MessageFlags,
    PermissionFlagsBits,
} from "discord.js";
import { DomainError } from "../../utils/DomainError.js";

/**
 * Discord slash command: /admin-forfeit-player
 * Admin-only command to forfeit all open matches for a player as 4–0 losses.
 * Applies to the current active season only and refreshes standings/fixtures/stats.
 * @module commands/admin_forfeit_player
 */

export const data = new SlashCommandBuilder()
    .setName("admin-forfeit-player")
    .setDescription(
        "[ADMIN] Forfeit all open matches for a player as 4–0 losses"
    )
    .addUserOption((opt) =>
        opt
            .setName("player")
            .setDescription("Player to forfeit remaining matches for")
            .setRequired(true)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);

/**
 * Execute the /admin-forfeit-player command.
 * Applies 0–4 losses to all scheduled/reported/disputed matches for the player
 * in the current active season, confirms them, and refreshes published messages.
 * @param {Object} interaction - Discord ChatInputCommandInteraction object.
 * @returns {Promise<void>}
 */
export async function execute(interaction) {
    const player = interaction.options.getUser("player", true);

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
        const { season, updated } =
            await interaction.client.services.results.adminForfeitAllMatchesForPlayer(
                {
                    guildId: interaction.guildId,
                    adminDiscordUserId: interaction.user.id,
                    adminDisplayName:
                        interaction.member?.displayName ??
                        interaction.user.username,
                    forfeitingPlayerId: player.id,
                }
            );

        const count = updated.length;

        const embed = new EmbedBuilder()
            .setTitle("🏳️ Player Forfeited Matches")
            .setDescription(
                `Applied **0–4** losses to **${count}** open match(es) for <@${player.id}> in **${season.name}**.`
            )
            .addFields(
                {
                    name: "Player",
                    value: `<@${player.id}>`,
                    inline: true,
                },
                {
                    name: "Matches affected",
                    value: String(count),
                    inline: true,
                }
            )
            .setTimestamp();

        await interaction.editReply({ embeds: [embed] });

        // Refresh fixtures, standings, and stats since multiple results changed
        await interaction.client.services.fixturesPublisher?.refresh?.({
            client: interaction.client,
            guildId: interaction.guildId,
        });
        await interaction.client.services.standingsPublisher?.refresh?.({
            client: interaction.client,
            guildId: interaction.guildId,
        });
        await interaction.client.services.statsLeadersPublisher?.refresh?.({
            client: interaction.client,
            guildId: interaction.guildId,
        });
    } catch (err) {
        if (err instanceof DomainError) {
            await interaction.editReply(`❌ ${err.message}`);
            return;
        }
        console.error(err);
        await interaction.editReply("❌ Something went wrong.");
    }
}

