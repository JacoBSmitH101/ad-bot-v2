import {
    SlashCommandBuilder,
    PermissionFlagsBits,
    EmbedBuilder,
    MessageFlags,
} from "discord.js";

export const data = new SlashCommandBuilder()
    .setName("signups")
    .setDescription("Admin signup tools")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .setDMPermission(false)
    .addSubcommand((s) =>
        s.setName("list").setDescription("List signups for the current season")
    );

export async function execute(interaction) {
    const sub = interaction.options.getSubcommand();
    if (sub !== "list") return;

    const season = await interaction.client.repos.seasons.getCurrentForGuild(
        interaction.guildId
    );
    if (!season)
        return interaction.reply({
            content: "❌ No season found.",
            flags: MessageFlags.Ephemeral,
        });

    const signups = await interaction.client.repos.signups.listBySeason(
        season.id
    );

    const lines = signups.length
        ? signups
              .map(
                  (s, i) =>
                      `**${i + 1}.** <@${s.discord_user_id}> — **${
                          s.avg_3dart
                      }**`
              )
              .join("\n")
        : "_No signups yet._";

    const embed = new EmbedBuilder()
        .setTitle("📋 Signups")
        .setDescription(`**${season.name}**\n\n${lines}`)
        .setFooter({ text: `Total: ${signups.length}` })
        .setTimestamp();

    await interaction.reply({ embeds: [embed] });
}
