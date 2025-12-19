import { SlashCommandBuilder, EmbedBuilder } from "discord.js";

export const data = new SlashCommandBuilder()
    .setName("signup")
    .setDescription("Sign up for the current season")
    .addNumberOption((o) =>
        o.setName("avg").setDescription("Your 3-dart average").setRequired(true)
    );

export async function execute(interaction) {
    const avg = interaction.options.getNumber("avg", true);

    const { season, signup, isUpdate, previousAvg } =
        await interaction.client.services.signups.signup({
            guildId: interaction.guildId,
            discordUserId: interaction.user.id,
            displayName:
                interaction.member?.displayName ?? interaction.user.username,
            avg,
        });

    const avatarUrl = interaction.user.displayAvatarURL({ size: 256 });

    const embed = new EmbedBuilder()
        .setTitle(isUpdate ? "🔁 Signup Updated" : "✅ Signup Confirmed")
        .setDescription(`**${season.name}**`)
        .setThumbnail(avatarUrl)
        .addFields(
            {
                name: "Player",
                value: `<@${interaction.user.id}>`,
                inline: true,
            },
            {
                name: "3-Dart Average",
                value: `**${signup.avg_3dart}**`,
                inline: true,
            }
        )
        .setTimestamp();

    if (isUpdate) {
        embed.addFields({
            name: "Previous Average",
            value: `**${previousAvg}** → **${signup.avg_3dart}**`,
            inline: false,
        });
    }

    await interaction.reply({ embeds: [embed] });
}
