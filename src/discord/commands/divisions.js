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
            .setName("assign-manual")
            .setDescription("Manually assign specific players to a division")
            .addStringOption((o) =>
                o
                    .setName("division")
                    .setDescription('Division name (e.g. "Div 1" or "1")')
                    .setRequired(true)
            )
            .addStringOption((o) =>
                o
                    .setName("players")
                    .setDescription(
                        "Paste @mentions or user IDs separated by spaces/commas/newlines"
                    )
                    .setRequired(true)
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

    if (sub === "assign-manual") {
        const divisionName = interaction.options.getString("division", true);
        const playersRaw = interaction.options.getString("players", true);

        const ids = parseDiscordUserIds(playersRaw);

        const { season, division, count } =
            await interaction.client.services.divisions.assignManual({
                guildId: interaction.guildId,
                divisionName,
                discordUserIds: ids,
            });

        const preview = ids
            .slice(0, 25)
            .map((id) => `<@${id}>`)
            .join(", ");
        const suffix = ids.length > 25 ? ` …(+${ids.length - 25} more)` : "";

        const embed = new EmbedBuilder()
            .setTitle("✍️ Manual Assignment Saved")
            .setDescription(
                `**${division.name}**\n\nAssigned **${count}** player(s):\n${preview}${suffix}`
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

function parseDiscordUserIds(input) {
    const text = String(input ?? "");
    const ids = [];

    // Matches <@123>, <@!123>, or raw numeric IDs
    const mentionRe = /<@!?(\d+)>/g;
    let m;
    while ((m = mentionRe.exec(text))) ids.push(m[1]);

    // Also accept bare IDs in the text
    const bareRe = /\b(\d{15,25})\b/g;
    while ((m = bareRe.exec(text))) ids.push(m[1]);

    return Array.from(new Set(ids));
}
