import { SlashCommandBuilder, EmbedBuilder } from "discord.js";

export const data = new SlashCommandBuilder()
    .setName("dropout")
    .setDescription(
        "Unregister from the current season (signups must be open)"
    );

export async function execute(interaction) {
    const { season, previousAvg } =
        await interaction.client.services.signups.dropout({
            guildId: interaction.guildId,
            discordUserId: interaction.user.id,
        });

    const avatarUrl = interaction.user.displayAvatarURL({ size: 256 });

    const embed = new EmbedBuilder()
        .setTitle("🗑️ Signup Removed")
        .setDescription(`You have been removed from **${season.name}**`)
        .setThumbnail(avatarUrl)
        //purple
        .setColor(0x800080)
        .addFields(
            {
                name: "Player",
                value: `<@${interaction.user.id}>`,
                inline: true,
            },
            {
                name: "Previous Average",
                value: `**${previousAvg}**`,
                inline: true,
            }
        )
        .setTimestamp();

    await interaction.reply({ embeds: [embed] });
}
