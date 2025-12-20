// src/services/StandingsMovement.js
import { EmbedBuilder } from "discord.js";

function fmtPlayer(id) {
    return id.startsWith("FAKE_") ? `\`${id}\`` : `<@${id}>`;
}

function buildRankMap(rows) {
    const map = new Map();
    rows.forEach((r, i) => map.set(r.discordUserId, i + 1));
    return map;
}

function arrow(delta) {
    if (delta < 0) return `▲${Math.abs(delta)}`;
    if (delta > 0) return `▼${delta}`;
    return "—";
}

// include only: the two players + anyone whose rank changed (optional cap)
export function buildMovementEmbed({
    seasonName,
    divisionName,
    match,
    beforeRows,
    afterRows,
    limit = 8,
}) {
    const before = buildRankMap(beforeRows);
    const after = buildRankMap(afterRows);

    const changed = [];
    for (const r of afterRows) {
        const b = before.get(r.discordUserId);
        const a = after.get(r.discordUserId);
        if (!b || !a) continue;
        if (b !== a) changed.push({ id: r.discordUserId, from: b, to: a });
    }

    // make sure the match players are included even if they didn’t move
    const ensure = [match.player_a_id, match.player_b_id];
    for (const id of ensure) {
        const b = before.get(id);
        const a = after.get(id);
        if (!b || !a) continue;
        if (!changed.some((x) => x.id === id))
            changed.push({ id, from: b, to: a });
    }

    // sort by biggest movement first
    changed.sort(
        (x, y) =>
            Math.abs((x.from ?? 0) - (x.to ?? 0)) -
            Math.abs((y.from ?? 0) - (y.to ?? 0))
    );
    changed.reverse();

    const lines = changed.slice(0, limit).map((c) => {
        const delta = (c.to ?? 0) - (c.from ?? 0);
        return `${fmtPlayer(c.id)}: **${c.to}** (${arrow(delta)})`;
    });

    return new EmbedBuilder()
        .setTitle(`📈 Standings update — ${divisionName}`)
        .setDescription(
            `**${seasonName}**\nAfter: ${fmtPlayer(
                match.player_a_id
            )} vs ${fmtPlayer(match.player_b_id)}`
        )
        .addFields({
            name: "Movement",
            value: lines.join("\n") || "_No movement_",
            inline: false,
        })
        .setTimestamp();
}
