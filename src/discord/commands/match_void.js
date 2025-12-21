// src/discord/commands/match_void.js
import {
    SlashCommandBuilder,
    EmbedBuilder,
    MessageFlags,
    PermissionFlagsBits,
} from "discord.js";
import { DomainError } from "../../utils/DomainError.js";

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
