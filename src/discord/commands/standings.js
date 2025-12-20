// src/discord/commands/standings.js
import {
    SlashCommandBuilder,
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
} from "discord.js";
import { DomainError } from "../../utils/DomainError.js";

export const data = new SlashCommandBuilder()
    .setName("standings")
    .setDescription("Show current standings (confirmed results only)")
    .addStringOption((opt) =>
        opt
            .setName("view")
            .setDescription("Summary or full standings")
            .addChoices(
                { name: "summary", value: "summary" },
                { name: "full", value: "full" }
            )
            .setRequired(false)
    );

function fmtPlayer(id) {
    return id.startsWith("FAKE_") ? `\`${id}\`` : `<@${id}>`;
}

function medal(i) {
    return i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : "•";
}

function buildSummaryEmbeds({ season, divisions }) {
    return divisions.map(({ division, standings }) => {
        const lines = standings.map(
            (r, idx) =>
                `${medal(idx)} **${fmtPlayer(r.discordUserId)}** — **${
                    r.points
                } pts**`
        );

        return new EmbedBuilder()
            .setTitle(`📊 ${season.name} — ${division.name}`)
            .setDescription(lines.join("\n") || "_No players._")
            .setTimestamp();
    });
}

function buildFullEmbeds({ season, divisions }) {
    return divisions.map(({ division, standings }) => {
        const lines = standings.map((r, idx) => {
            const ld = r.legDiff >= 0 ? `+${r.legDiff}` : `${r.legDiff}`;
            return (
                `${medal(idx)} **${fmtPlayer(r.discordUserId)}** — **${
                    r.points
                } pts**\n` +
                `\`W ${r.wins} • L ${r.losses} • LF ${r.legsFor} • LA ${r.legsAgainst} • LD ${ld}\``
            );
        });

        const header =
            "_Points = legs won + 2 for a win_\n" +
            "`W` wins • `L` losses • `LF` legs for • `LA` legs against • `LD` leg diff\n\n";

        return new EmbedBuilder()
            .setTitle(`📊 ${season.name} — ${division.name}`)
            .setDescription(header + (lines.join("\n\n") || "_No players._"))
            .setTimestamp();
    });
}

export async function execute(interaction) {
    const view = interaction.options.getString("view") ?? "summary";

    try {
        const res =
            await interaction.client.services.standings.getStandingsForCurrentSeason(
                {
                    guildId: interaction.guildId,
                }
            );

        const embeds =
            view === "full" ? buildFullEmbeds(res) : buildSummaryEmbeds(res);

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId("standings_full")
                .setLabel("Full standings")
                .setStyle(ButtonStyle.Primary),
            new ButtonBuilder()
                .setCustomId("standings_me")
                .setLabel("My position")
                .setStyle(ButtonStyle.Secondary)
        );

        // Summary is public + has buttons. Full via command is also public (your request).
        await interaction.reply({
            embeds,
            components: view === "summary" ? [row] : [], // keep channel clean on /standings full
            ephemeral: true,
        });
    } catch (err) {
        if (err instanceof DomainError) {
            await interaction.reply({
                content: `❌ ${err.message}`,
                ephemeral: true,
            });
            return;
        }
        console.error(err);
        await interaction.reply({
            content: "❌ Something went wrong.",
            ephemeral: true,
        });
    }
}
