import {
    SlashCommandBuilder,
    PermissionFlagsBits,
    EmbedBuilder,
} from "discord.js";

/**
 * Discord slash command: /divisions
 * Admin-only command group for managing divisions.
 * Subcommands: create, assign-auto
 * @module commands/divisions
 */

export const data = new SlashCommandBuilder()
    .setName("divisions")
    .setDescription("Division admin commands")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .setDMPermission(false)
    .addSubcommand((s) =>
        s
            .setName("create")
            .setDescription("Create divisions (signups must be closed)")
            .addIntegerOption((o) =>
                o
                    .setName("count")
                    .setDescription("Number of divisions")
                    .setRequired(true)
            )
    )
    .addSubcommand((s) =>
        s
            .setName("assign-auto")
            .setDescription(
                "Assign players into divisions by average (Div1 strongest)"
            )
    )
    .addSubcommand((s) =>
        s
            .setName("preview-auto")
            .setDescription(
                "Preview auto-assignments (no DB changes, signups can be open)"
            )
            .addIntegerOption((o) =>
                o
                    .setName("count")
                    .setDescription("Number of divisions to preview")
                    .setRequired(true)
            )
    );

/**
 * Execute the /divisions command.
 * Routes to appropriate subcommand handler: create divisions or auto-assign players.
 * @param {Object} interaction - Discord ChatInputCommandInteraction object.
 * @returns {Promise<void>}
 */
export async function execute(interaction) {
    const sub = interaction.options.getSubcommand();

    if (sub === "create") {
        const count = interaction.options.getInteger("count", true);
        const { season, divisions } =
            await interaction.client.services.divisions.createDivisions({
                guildId: interaction.guildId,
                count,
            });

        const embed = new EmbedBuilder()
            .setTitle("✅ Divisions Created")
            .setDescription(divisions.map((d) => `• **${d.name}**`).join("\n"))
            .setFooter({ text: season.name })
            .setTimestamp();

        return interaction.reply({ embeds: [embed] });
    }

    if (sub === "assign-auto") {
        const { season, divisions, counts } =
            await interaction.client.services.divisions.assignAuto({
                guildId: interaction.guildId,
            });

        const embed = new EmbedBuilder()
            .setTitle("🎯 Players Assigned")
            .setDescription(
                divisions
                    .map((d, i) => `• **${d.name}** — **${counts[i]}** players`)
                    .join("\n")
            )
            .setFooter({ text: season.name })
            .setTimestamp();

        return interaction.reply({ embeds: [embed] });
    }

    if (sub === "preview-auto") {
        const count = interaction.options.getInteger("count", true);
        const { season, divisions, counts, warnings, playerCount } =
            await interaction.client.services.divisions.previewAuto({
                guildId: interaction.guildId,
                count,
            });

        const warningLines = warnings.length
            ? `\n\n⚠️ ${warnings.join("\n⚠️ ")}`
            : "";

        const embed = new EmbedBuilder()
            .setTitle("👀 Division Preview")
            .setDescription(
                divisions
                    .map((d, i) => `• **${d.name}** — **${counts[i]}** players`)
                    .join("\n") + warningLines
            )
            .setFooter({
                text: `${season.name} • ${playerCount} total signups`,
            })
            .setTimestamp();

        return interaction.reply({ embeds: [embed] });
    }
}
