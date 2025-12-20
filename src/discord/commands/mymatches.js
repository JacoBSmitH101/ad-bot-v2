// src/discord/commands/mymatches.js
import { SlashCommandBuilder, EmbedBuilder } from "discord.js";
import { DomainError } from "../../utils/DomainError.js";

export const data = new SlashCommandBuilder()
    .setName("mymatches")
    .setDescription("Show your matches for the current season");

export async function execute(interaction) {
    try {
        const { season, weeks, next } =
            await interaction.client.services.matches.getMyMatches({
                guildId: interaction.guildId,
                discordUserId: interaction.user.id,
            });

        const embed = new EmbedBuilder()
            .setTitle(`🎯 My Matches — ${season.name}`)
            .setDescription(
                "🗓️ scheduled • 🟠 reported (pending) • 🟢 confirmed\n"
            )
            .setTimestamp();

        if (next) {
            const opp =
                next.player_a_id === interaction.user.id
                    ? next.player_b_id
                    : next.player_a_id;

            embed.addFields({
                name: "Next up",
                value: `Week **${next.week}** — vs <@${opp}>`,
                inline: false,
            });
        }

        if (weeks.length === 0) {
            embed.addFields({
                name: "No matches",
                value: "No fixtures found for you yet.",
                inline: false,
            });
        } else {
            for (const w of weeks) {
                embed.addFields({
                    name: `Week ${w.week}`,
                    value: w.lines.join("\n"),
                    inline: false,
                });
            }
        }

        await interaction.reply({ embeds: [embed], ephemeral: false });
    } catch (err) {
        if (err instanceof DomainError) {
            await interaction.reply({
                content: `❌ ${err.message}`,
                ephemeral: true,
            });
            return;
        }
        console.error(err);
        await interaction.reply({
            content: "❌ Something went wrong.",
            ephemeral: true,
        });
    }
}
