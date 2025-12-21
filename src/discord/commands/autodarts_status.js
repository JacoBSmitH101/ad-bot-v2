// src/discord/commands/autodarts_status.js
import {
    SlashCommandBuilder,
    EmbedBuilder,
    MessageFlags,
    PermissionFlagsBits,
} from "discord.js";
import { DomainError } from "../../utils/DomainError.js";

export const data = new SlashCommandBuilder()
    .setName("autodarts-status")
    .setDescription("[ADMIN] Show internal Autodarts auth status")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);

export async function execute(interaction) {
    try {
        const s =
            await interaction.client.services.internalApi.getAutodartsStatus();

        const embed = new EmbedBuilder()
            .setTitle("🔐 Autodarts Status")
            .addFields(
                {
                    name: "Connected",
                    value: String(s.db.status ?? false),
                    inline: true,
                },
                {
                    name: "Last refresh",
                    value: String(s.db.last_refresh_at ?? "n/a"),
                    inline: true,
                },
                {
                    name: "Expiry",
                    value: String(s.memory.expiresAt ?? "n/a"),
                    inline: true,
                },
                {
                    name: "Last error",
                    value: String(s.db.last_error ?? "none"),
                    inline: false,
                },
                {
                    name: "Queue",
                    value: String(s.queueSize ?? "n/a"),
                    inline: true,
                }
            )
            .setTimestamp();

        await interaction.reply({
            embeds: [embed],
            flags: MessageFlags.Ephemeral,
        });
    } catch (e) {
        if (e instanceof DomainError) {
            await interaction.reply({
                content: `❌ ${e.message}`,
                flags: MessageFlags.Ephemeral,
            });
            return;
        }
        console.error(e);
        await interaction.reply({
            content: "❌ Internal API error.",
            flags: MessageFlags.Ephemeral,
        });
    }
}
