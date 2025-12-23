import {
    SlashCommandBuilder,
    EmbedBuilder,
    MessageFlags,
    PermissionFlagsBits,
} from "discord.js";
import { DomainError } from "../../utils/DomainError.js";

/**
 * Discord slash command: /result-edit
 * Admin-only command to edit the stored result (legs A and B) for a match.
 * Optionally updates the proof URL. Refreshes standings and fixtures after editing.
 * @module commands/results_edit
 */

export const data = new SlashCommandBuilder()
    .setName("result-edit")
    .setDescription("[ADMIN] Edit the stored A–B result for a match")
    .addStringOption((opt) =>
        opt.setName("match_id").setDescription("Match UUID").setRequired(true)
    )
    .addIntegerOption((opt) =>
        opt
            .setName("legs_a")
            .setDescription("Legs for player A")
            .setRequired(true)
    )
    .addIntegerOption((opt) =>
        opt
            .setName("legs_b")
            .setDescription("Legs for player B")
            .setRequired(true)
    )
    .addStringOption((opt) =>
        opt
            .setName("url")
            .setDescription("Proof URL (optional)")
            .setRequired(false)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);

/**
 * Execute the /result-edit command.
 * Updates match result scores and optionally proof URL, then refreshes published messages.
 * @param {Object} interaction - Discord ChatInputCommandInteraction object.
 * @returns {Promise<void>}
 * @throws {DomainError} If match not found, invalid state, or edit fails.
 */
export async function execute(interaction) {
    const matchId = interaction.options.getString("match_id", true).trim();
    const legsA = interaction.options.getInteger("legs_a", true);
    const legsB = interaction.options.getInteger("legs_b", true);
    const url = interaction.options.getString("url", false);

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
        const { season, match, result } =
            await interaction.client.services.results.adminEditResult({
                guildId: interaction.guildId,
                adminDiscordUserId: interaction.user.id,
                adminDisplayName:
                    interaction.member?.displayName ??
                    interaction.user.username,
                matchId,
                legsA,
                legsB,
                proofUrl: url ?? null,
            });

        const embed = new EmbedBuilder()
            .setTitle("✏️ Result edited")
            .setDescription(`Updated result for **${season.name}**`)
            .addFields(
                { name: "Match ID", value: `\`${match.id}\``, inline: false },
                {
                    name: "Players (A vs B)",
                    value: `<@${match.player_a_id}> vs <@${match.player_b_id}>`,
                    inline: false,
                },
                {
                    name: "Score (A–B)",
                    value: `**${result.legs_a} - ${result.legs_b}**`,
                    inline: true,
                },
                {
                    name: "Proof",
                    value: result.proof_url
                        ? `[Open link](${result.proof_url})`
                        : "None",
                    inline: true,
                }
            )
            .setTimestamp();

        await interaction.editReply({ embeds: [embed] });

        // optional: refresh published messages so the league view updates immediately
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
