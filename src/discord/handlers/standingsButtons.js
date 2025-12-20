// src/discord/handlers/standingsButtons.js
import { EmbedBuilder } from "discord.js";
import { DomainError } from "../../utils/DomainError.js";

function fmtPlayer(id) {
    return id.startsWith("FAKE_") ? `\`${id}\`` : `<@${id}>`;
}

function medal(i) {
    return i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : "•";
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

function buildMyPositionEmbed({ season, divisionName, row, rank, total }) {
    const ld = row.legDiff >= 0 ? `+${row.legDiff}` : `${row.legDiff}`;

    return new EmbedBuilder()
        .setTitle(`👤 My position — ${season.name}`)
        .setDescription(`**${divisionName}**\nYou are **${rank}/${total}**`)
        .addFields(
            {
                name: "Player",
                value: `${fmtPlayer(row.discordUserId)}`,
                inline: true,
            },
            { name: "Points", value: `**${row.points}**`, inline: true },
            {
                name: "Record",
                value: `W ${row.wins} / L ${row.losses}`,
                inline: true,
            },
            {
                name: "Legs",
                value: `LF ${row.legsFor} • LA ${row.legsAgainst} • LD ${ld}`,
                inline: false,
            }
        )
        .setTimestamp();
}

export async function handleStandingsButtons(interaction) {
    if (!interaction.isButton()) return false;

    if (
        interaction.customId !== "standings_full" &&
        interaction.customId !== "standings_me"
    ) {
        return false;
    }

    await interaction.deferReply({ ephemeral: true });

    try {
        const res =
            await interaction.client.services.standings.getStandingsForCurrentSeason(
                {
                    guildId: interaction.guildId,
                }
            );

        if (interaction.customId === "standings_full") {
            const embeds = buildFullEmbeds(res);
            await interaction.editReply({ embeds });
            return true;
        }

        if (interaction.customId === "standings_me") {
            const userId = interaction.user.id;

            // find the division they are in
            for (const d of res.divisions) {
                const idx = d.standings.findIndex(
                    (r) => r.discordUserId === userId
                );
                if (idx !== -1) {
                    const row = d.standings[idx];
                    const embed = buildMyPositionEmbed({
                        season: res.season,
                        divisionName: d.division.name,
                        row,
                        rank: idx + 1,
                        total: d.standings.length,
                    });

                    await interaction.editReply({ embeds: [embed] });
                    return true;
                }
            }

            await interaction.editReply(
                "❌ You’re not in the standings for the current season."
            );
            return true;
        }

        await interaction.editReply("❌ Unknown button action.");
        return true;
    } catch (err) {
        if (err instanceof DomainError) {
            await interaction.editReply(`❌ ${err.message}`);
            return true;
        }
        console.error(err);
        await interaction.editReply("❌ Something went wrong.");
        return true;
    }
}
