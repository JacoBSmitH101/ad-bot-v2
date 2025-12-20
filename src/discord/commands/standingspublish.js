// src/discord/commands/standingspublish.js
import { SlashCommandBuilder } from "discord.js";
import { DomainError } from "../../utils/DomainError.js";

export const data = new SlashCommandBuilder()
    .setName("standingspublish")
    .setDescription(
        "[ADMIN] Publish standings to this channel and keep them updated"
    );

export async function execute(interaction) {
    const cfg = interaction.client.services.config;
    const isAdmin =
        (cfg.adminUserId && interaction.user.id === cfg.adminUserId) ||
        (cfg.adminRoleId &&
            interaction.member?.roles?.cache?.has(cfg.adminRoleId));

    if (!isAdmin) {
        await interaction.reply({
            content: "❌ You don’t have permission to do that.",
            ephemeral: true,
        });
        return;
    }

    await interaction.deferReply({ ephemeral: true });

    try {
        const { season } =
            await interaction.client.services.standingsPublisher.publish({
                client: interaction.client,
                guildId: interaction.guildId,
                channelId: interaction.channelId,
            });

        await interaction.editReply(
            `✅ Published standings for **${season.name}** in this channel.`
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
