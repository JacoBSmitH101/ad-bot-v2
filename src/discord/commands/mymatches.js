import { SlashCommandBuilder, EmbedBuilder } from "discord.js";

export const data = new SlashCommandBuilder()
    .setName("mymatches")
    .setDescription("View your scheduled matches for the current season")
    .addIntegerOption((o) =>
        o
            .setName("week")
            .setDescription(
                "Optional week number (if omitted: shows all weeks)"
            )
            .setRequired(false)
    )
    .setDMPermission(false);

export async function execute(interaction) {
    const week = interaction.options.getInteger("week", false);

    // Current season (latest created for this guild)
    const season = await interaction.client.repos.seasons.getCurrentForGuild(
        interaction.guildId
    );

    if (!season) {
        return interaction.reply({
            content: "❌ No season found for this server yet.",
            ephemeral: true,
        });
    }

    // Optional: only allow once schedule exists / season started
    // If you want to allow preview before start, remove this block.
    if (
        !["signups_closed", "in_progress", "completed"].includes(season.status)
    ) {
        return interaction.reply({
            content:
                "⏳ Matches aren’t available yet. The season needs a schedule first.",
            ephemeral: true,
        });
    }

    // Fetch matches for this player
    const matches = await interaction.client.repos.matches.listForPlayer({
        seasonId: season.id,
        discordUserId: interaction.user.id,
        week: week ?? null,
    });

    // Sort by week then division (if present)
    matches.sort((a, b) => {
        const wa = Number(a.week ?? 0);
        const wb = Number(b.week ?? 0);
        if (wa !== wb) return wa - wb;
        return String(a.division_id ?? "").localeCompare(
            String(b.division_id ?? "")
        );
    });

    const avatarUrl = interaction.user.displayAvatarURL({ size: 256 });

    const embed = new EmbedBuilder()
        .setTitle("📅 Your Matches")
        .setDescription(
            `**${season.name}**${week != null ? ` — Week **${week}**` : ""}`
        )
        .setThumbnail(avatarUrl)
        .setTimestamp();

    if (!matches.length) {
        embed.addFields({
            name: "No matches found",
            value:
                week != null
                    ? "No matches for that week."
                    : "No matches scheduled yet.",
        });

        return interaction.reply({ embeds: [embed], ephemeral: true });
    }

    // Build a readable list: "W1 — @A vs @B"
    const lines = matches.map((m) => {
        const a = `<@${m.player_a_id}>`;
        const b = `<@${m.player_b_id}>`;
        return `**W${m.week}** — ${a} vs ${b}`;
    });

    // Discord embed field value limit is 1024 chars; chunk if needed.
    const chunks = [];
    let current = "";
    for (const line of lines) {
        const candidate = current ? `${current}\n${line}` : line;
        if (candidate.length > 950) {
            chunks.push(current);
            current = line;
        } else {
            current = candidate;
        }
    }
    if (current) chunks.push(current);

    chunks.forEach((chunk, i) => {
        embed.addFields({
            name: i === 0 ? "Matches" : "Matches (cont.)",
            value: chunk,
        });
    });

    return interaction.reply({ embeds: [embed], ephemeral: true });
}
