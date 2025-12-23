import {
    SlashCommandBuilder,
    PermissionFlagsBits,
    EmbedBuilder,
} from "discord.js";

/**
 * Discord slash command: /schedule
 * Admin-only command group for managing match schedules.
 * Subcommands: propose, approve, preview
 * @module commands/schedule
 */

export const data = new SlashCommandBuilder()
    .setName("schedule")
    .setDescription("Scheduling tools")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .setDMPermission(false)
    .addSubcommand((s) =>
        s.setName("propose").setDescription("Generate a schedule proposal")
    )
    .addSubcommand((s) =>
        s
            .setName("approve")
            .setDescription("Approve latest proposal and create matches")
    )
    .addSubcommand((s) =>
        s
            .setName("preview")
            .setDescription("Preview a week from the latest schedule proposal")
            .addStringOption((o) =>
                o
                    .setName("division")
                    .setDescription("Division name (e.g. Div 1)")
                    .setRequired(true)
            )
            .addIntegerOption((o) =>
                o
                    .setName("week")
                    .setDescription("Week number")
                    .setRequired(true)
            )
    );

/**
 * Execute the /schedule command.
 * Routes to appropriate subcommand: propose schedule, approve latest proposal, or preview a week.
 * @param {Object} interaction - Discord ChatInputCommandInteraction object.
 * @returns {Promise<void>}
 */
export async function execute(interaction) {
    const sub = interaction.options.getSubcommand();

    if (sub === "propose") {
        const { season, proposal } =
            await interaction.client.services.schedules.propose({
                guildId: interaction.guildId,
                createdBy: interaction.user.id,
            });

        const payload = proposal.payload;
        const summary = payload.divisions
            .map(
                (d) => `• **${d.division_name}** — **${d.weeks.length}** weeks`
            )
            .join("\n");

        const embed = new EmbedBuilder()
            .setTitle("🧾 Schedule Proposed")
            .setDescription(`**${season.name}**\n\n${summary}`)
            .setFooter({ text: `Proposal: ${proposal.id}` })
            .setTimestamp();

        return interaction.reply({ embeds: [embed] });
    }

    if (sub === "approve") {
        const { season, createdMatches } =
            await interaction.client.services.schedules.approveLatest({
                guildId: interaction.guildId,
            });

        const embed = new EmbedBuilder()
            .setTitle("✅ Schedule Approved")
            .setDescription(
                `**${season.name}**\n\nCreated **${createdMatches}** matches.`
            )
            .setTimestamp();

        return interaction.reply({ embeds: [embed] });
    }

    if (sub === "preview") {
        const divisionName = interaction.options.getString("division", true);
        const week = interaction.options.getInteger("week", true);

        const res = await interaction.client.services.schedules.preview({
            guildId: interaction.guildId,
            divisionName,
            week,
        });

        const lines = res.pairs.length
            ? res.pairs.map(([a, b]) => `• <@${a}> vs <@${b}>`).join("\n")
            : "_No matches (BYEs only)_";

        const embed = new EmbedBuilder()
            .setTitle("👀 Schedule Preview")
            .setDescription(
                `**${res.season.name}**\n**${res.division.name}** — Week **${res.week}** / ${res.totalWeeks}\n\n${lines}`
            )
            .setFooter({ text: `Proposal: ${res.proposal.id}` })
            .setTimestamp();

        return interaction.reply({ embeds: [embed] });
    }
}
