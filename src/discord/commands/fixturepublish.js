import { SlashCommandBuilder, PermissionFlagsBits } from "discord.js";
import { DomainError } from "../../utils/DomainError.js";

export const data = new SlashCommandBuilder()
    .setName("fixturespublish")
    .setDescription("[ADMIN] Publish weekly fixtures message in this channel")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addIntegerOption((opt) =>
        opt
            .setName("week")
            .setDescription(
                "Week number to display (defaults to current_week or 1)"
            )
            .setRequired(false)
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
            ephemeral: true,
        });
        return;
    }

    await interaction.deferReply({ ephemeral: true });

    try {
        const week = interaction.options.getInteger("week");
        const res = await interaction.client.services.fixturesPublisher.publish(
            {
                client: interaction.client,
                guildId: interaction.guildId,
                channelId: interaction.channelId,
                week,
            }
        );

        await interaction.editReply(
            `✅ Published fixtures for **${res.season.name}** (Week **${res.week}**) in this channel.`
        );
    } catch (err) {
        if (err instanceof DomainError) {
            await interaction.editReply(`❌ ${err.message}`);
            return;
        }
        console.error(err);
        await interaction.editReply("❌ Something went wrong.");
    }
}
