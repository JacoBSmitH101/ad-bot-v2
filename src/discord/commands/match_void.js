import {
    SlashCommandBuilder,
    EmbedBuilder,
    MessageFlags,
    PermissionFlagsBits,
} from "discord.js";
import { DomainError } from "../../utils/DomainError.js";

/**
 * Discord slash command: /match-void
 * Admin-only command to void a match (no points awarded) and delete its result.
 * Optionally clears stored result message references. Refreshes standings and fixtures after voiding.
 * @module commands/match_void
 */

export const data = new SlashCommandBuilder()
    .setName("match-void")
    .setDescription("[ADMIN] Void a match (no points) and delete its result")
    .addStringOption((opt) =>
        opt.setName("match_id").setDescription("Match UUID").setRequired(true)
    )
    .addBooleanOption((opt) =>
        opt
            .setName("clear_message_link")
            .setDescription("Also clear stored result message ids")
            .setRequired(false)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);

/**
 * Execute the /match-void command.
 * Voids match, deletes result, optionally clears message references, and refreshes published messages.
 * @param {Object} interaction - Discord ChatInputCommandInteraction object.
 * @returns {Promise<void>}
 * @throws {DomainError} If match not found, invalid state, or void operation fails.
 */
export async function execute(interaction) {
    const matchId = interaction.options.getString("match_id", true).trim();
    const clearMsg =
        interaction.options.getBoolean("clear_message_link") ?? false;

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
        const { season, match } =
            await interaction.client.services.results.adminVoidMatch({
                guildId: interaction.guildId,
                adminDiscordUserId: interaction.user.id,
                adminDisplayName:
                    interaction.member?.displayName ??
                    interaction.user.username,
                matchId,
                clearResultMessage: clearMsg,
            });

        const embed = new EmbedBuilder()
            .setTitle("🚫 Match voided")
            .setDescription(`Match set to **void** in **${season.name}**`)
            .addFields(
                { name: "Match ID", value: `\`${match.id}\``, inline: false },
                {
                    name: "Players (A vs B)",
                    value: `<@${match.player_a_id}> vs <@${match.player_b_id}>`,
                    inline: false,
                },
                { name: "Status", value: `**${match.status}**`, inline: true }
            )
            .setTimestamp();

        await interaction.editReply({ embeds: [embed] });

        await interaction.client.services.standingsPublisher?.refresh?.({
            client: interaction.client,
            guildId: interaction.guildId,
        });
        await interaction.client.services.fixturesPublisher?.refresh?.({
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
