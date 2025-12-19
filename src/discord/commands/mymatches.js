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
    if (!["signups_closed", "active", "completed"].includes(season.status)) {
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

    // Group matches by week
    const byWeek = new Map();
    for (const m of matches) {
        const w = Number(m.week ?? 0);
        if (!byWeek.has(w)) byWeek.set(w, []);
        byWeek.get(w).push(m);
    }

    const weeks = [...byWeek.keys()].sort((a, b) => a - b);

    // helper: display one match line nicely
    function formatMatchLine(m) {
        const a = `<@${m.player_a_id}>`;
        const b = `<@${m.player_b_id}>`;

        // Show it as: "• vs @opponent"
        // If you want, we can bold the opponent specifically later
        return `• ${a} **vs** ${b}`;
    }

    // Build field chunks (each field <= 1024 chars)
    const fields = [];
    for (const w of weeks) {
        const lines = byWeek.get(w).map(formatMatchLine);

        let value = lines.join("\n");
        const header = `Week ${w}`;

        // If a single week field is too long, chunk it
        if (value.length <= 1024) {
            fields.push({ name: `🗓️ ${header}`, value });
        } else {
            // chunk within week
            let current = "";
            let part = 1;
            for (const line of lines) {
                const candidate = current ? `${current}\n${line}` : line;
                if (candidate.length > 950) {
                    fields.push({
                        name: `🗓️ ${header} (part ${part})`,
                        value: current,
                    });
                    part++;
                    current = line;
                } else {
                    current = candidate;
                }
            }
            if (current)
                fields.push({
                    name: `🗓️ ${header} (part ${part})`,
                    value: current,
                });
        }
    }

    // Discord embeds max 25 fields.
    // If you have loads of weeks, we should combine weeks into fewer fields.
    // For MVP, we’ll just cap and tell them.
    if (fields.length > 25) {
        embed.addFields(fields.slice(0, 24));
        embed.addFields({
            name: "⚠️ Too many matches to display",
            value: "Try `/mymatches week:<n>` to view a specific week.",
        });
    } else {
        embed.addFields(fields);
    }

    return interaction.reply({ embeds: [embed], ephemeral: true });
}
