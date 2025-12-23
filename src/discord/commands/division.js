import {
    SlashCommandBuilder,
    PermissionFlagsBits,
    EmbedBuilder,
    MessageFlags,
} from "discord.js";

/**
 * Discord slash command: /division
 * Admin-only command group for viewing division information.
 * Subcommands: list
 * @module commands/division
 */

export const data = new SlashCommandBuilder()
    .setName("division")
    .setDescription("Division tools")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .setDMPermission(false)
    .addSubcommand((s) =>
        s.setName("list").setDescription("List players in each division")
    );

/**
 * Execute the /division command.
 * Routes to the list subcommand to display all divisions and their assigned players.
 * @param {Object} interaction - Discord ChatInputCommandInteraction object.
 * @returns {Promise<void>}
 */
export async function execute(interaction) {
    const season = await interaction.client.repos.seasons.getCurrentForGuild(
        interaction.guildId
    );
    if (!season)
        return interaction.reply({
            content: "❌ No season found.",
            flags: MessageFlags.Ephemeral,
        });

    const grouped =
        await interaction.client.repos.divisions.listAllDivisionPlayersForSeason(
            season.id
        );

    const embed = new EmbedBuilder()
        .setTitle("📌 Divisions")
        .setDescription(`**${season.name}**`)
        .setTimestamp();

    for (const g of grouped) {
        const lines = g.players.length
            ? g.players
                  .map(
                      (p, i) =>
                          `**${i + 1}.** <@${p.discord_user_id}> — **${
                              p.seed_avg
                          }**`
                  )
                  .join("\n")
            : "_No players assigned_";

        embed.addFields({ name: g.division.name, value: lines });
    }

    await interaction.reply({ embeds: [embed] });
}
