import {
    SlashCommandBuilder,
    EmbedBuilder,
    MessageFlags,
    PermissionFlagsBits,
} from "discord.js";
import { DomainError } from "../../utils/DomainError.js";

export const data = new SlashCommandBuilder()
    .setName("unreported_before_week")
    .setDescription(
        "[ADMIN] Show matches before a given week that have not been reported/confirmed"
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addIntegerOption((opt) =>
        opt
            .setName("week")
            .setDescription("Show matches from weeks before this number")
            .setRequired(true)
    );

export async function execute(interaction) {
    const cfg = interaction.client.services.config;
    const isAdmin =
        (cfg.adminUserId && interaction.user.id === cfg.adminUserId) ||
        (cfg.adminRoleId &&
            interaction.member?.roles?.cache?.has(cfg.adminRoleId));

    if (!isAdmin) {
        await interaction.reply({
            content: "❌ You don’t have permission.",
            flags: MessageFlags.Ephemeral,
        });
        return;
    }

    const week = interaction.options.getInteger("week", true);

    if (week <= 1) {
        await interaction.reply({
            content:
                "ℹ️ Week must be greater than 1 to check previous weeks (e.g. 2 to see week 1).",
            flags: MessageFlags.Ephemeral,
        });
        return;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
        const { season, weeks } =
            await interaction.client.services.matches.getUnreportedBeforeWeek({
                guildId: interaction.guildId,
                week,
            });

        const embed = new EmbedBuilder()
            .setTitle(
                `📋 Unreported Matches Before Week ${week} — ${season.name}`
            )
            .setDescription(
                "Shows matches from earlier weeks that are not reported or confirmed."
            )
            .setTimestamp();

        if (weeks.length === 0) {
            embed.addFields({
                name: "All caught up",
                value: "No unreported matches found before that week.",
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

        await interaction.editReply({ embeds: [embed] });
    } catch (err) {
        if (err instanceof DomainError) {
            await interaction.editReply(`❌ ${err.message}`);
            return;
        }
        console.error(err);
        await interaction.editReply("❌ Something went wrong.");
    }
}
