// src/discord/commands/season_close.js
import {
    SlashCommandBuilder,
    EmbedBuilder,
    MessageFlags,
    PermissionFlagsBits,
} from "discord.js";
import { DomainError } from "../../utils/DomainError.js";

export const data = new SlashCommandBuilder()
    .setName("season-close")
    .setDescription("[ADMIN] Close the current season (locks it)")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);

export async function execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
        const season = await interaction.client.services.seasons.closeSeason({
            guildId: interaction.guildId,
        });

        const embed = new EmbedBuilder()
            .setTitle("🔒 Season closed")
            .setDescription(`Season **${season.name}** is now **closed**.`)
            .addFields({
                name: "Status",
                value: `**${season.status}**`,
                inline: true,
            })
            .setTimestamp();

        await interaction.editReply({ embeds: [embed] });

        // optional: refresh published messages once on close
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
