// src/services/StandingsPublisherService.js
import { DomainError } from "../utils/DomainError.js";
import { EmbedBuilder } from "discord.js";

function fmtPlayer(id) {
    return id.startsWith("FAKE_") ? `\`${id}\`` : `<@${id}>`;
}
function medal(i) {
    return i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : "•";
}
function fmtPlayerInline(id) {
    return id.startsWith("FAKE_") ? `\`${id}\`` : `<@${id}>`;
}

function normalizeMatchResult(match) {
    const mrRaw = match.match_results;
    const mr = Array.isArray(mrRaw) ? mrRaw[0] : mrRaw;
    if (!mr) return null;
    return {
        legs_a: Number(mr.legs_a),
        legs_b: Number(mr.legs_b),
        proof_url: mr.proof_url ?? null,
    };
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

function buildSummaryEmbed({
    seasonName,
    divisionName,
    standings,
    lastUpdateText = null,
}) {
    const lines = standings.map(
        (r, idx) =>
            `${medal(idx)} **${fmtPlayer(r.discordUserId)}** — **${
                r.points
            } pts**`
    );

    const desc =
        (lastUpdateText ? `${lastUpdateText}\n\n` : "") +
        (lines.join("\n") || "_No players._");

    return new EmbedBuilder()
        .setTitle(`📊 ${seasonName} — ${divisionName}`)
        .setDescription(desc)
        .setTimestamp();
}

export class StandingsPublisherService {
    /**
     * @param {{ seasons: any, standings: any }} deps
     */
    constructor({ seasons, standings }) {
        this.seasons = seasons;
        this.standings = standings;
    }

    /**
     * Create (or recreate) standings messages in a channel and store their message IDs.
     */
    async publish({ client, guildId, channelId }) {
        const season = await this.seasons.getCurrentForGuild(guildId);
        if (!season) throw new DomainError("NO_SEASON", "No season found.");

        // you can allow publishing earlier if you want, but this is a sane rule
        if (!["active", "closed"].includes(season.status)) {
            throw new DomainError(
                "INVALID_STATE",
                `Standings publish only available when season is active/closed (current: ${season.status})`
            );
        }

        const channel = await client.channels
            .fetch(channelId)
            .catch(() => null);
        if (!channel || !channel.isTextBased()) {
            throw new DomainError(
                "BAD_CHANNEL",
                "That channel is not a text channel."
            );
        }

        const res = await this.standings.getStandingsForCurrentSeason({
            guildId,
        });

        // post one message per division and store IDs keyed by division id
        const messageIds = {};

        for (const d of res.divisions) {
            const embed = buildSummaryEmbed({
                seasonName: res.season.name,
                divisionName: d.division.name,
                standings: d.standings,
            });

            const msg = await channel.send({ embeds: [embed] });

            messageIds[`division:${d.division.id}`] = msg.id;
        }

        await this.seasons.setStandingsChannel(season.id, channelId);
        await this.seasons.setStandingsMessageIds(season.id, messageIds);

        return { season, channelId, messageIds };
    }

    /**
     * Recompute standings and edit existing published messages.
     * Call this after every confirm.
     */
    async refresh({ client, guildId, context = null }) {
        const season = await this.seasons.getCurrentForGuild(guildId);
        if (!season) throw new DomainError("NO_SEASON", "No season found.");

        if (!season.standings_channel_id || !season.standings_message_ids) {
            // not published yet; silently skip
            return { updated: 0, skipped: true };
        }

        const channel = await client.channels
            .fetch(season.standings_channel_id)
            .catch(() => null);

        if (!channel || !channel.isTextBased()) {
            return { updated: 0, skipped: true };
        }

        const res = await this.standings.getStandingsForCurrentSeason({
            guildId,
        });
        let beforeDivisionStandings = null;
        let afterDivisionStandings = null;
        let movementText = null;

        if (
            context?.divisionId &&
            context?.beforeStandings &&
            context?.afterStandings
        ) {
            beforeDivisionStandings = context.beforeStandings;
            afterDivisionStandings = context.afterStandings;

            const beforeMap = buildRankMap(beforeDivisionStandings);
            const afterMap = buildRankMap(afterDivisionStandings);

            const ids = [context.playerAId, context.playerBId].filter(Boolean);

            const parts = ids.map((id) => {
                const b = beforeMap.get(id);
                const a = afterMap.get(id);
                if (!b || !a) return `${fmtPlayerInline(id)}: —`;
                const delta = a - b;
                return `${fmtPlayerInline(id)} ${b}→**${a}** (${arrow(delta)})`;
            });

            movementText = parts.length ? parts.join(" • ") : null;
        }
        let updated = 0;

        for (const d of res.divisions) {
            const key = `division:${d.division.id}`;
            const msgId = season.standings_message_ids?.[key];
            if (!msgId) continue;

            const msg = await channel.messages.fetch(msgId).catch(() => null);
            if (!msg) continue;

            let lastUpdateText = null;

            if (context?.divisionId && d.division.id === context.divisionId) {
                // Score line (from stored match result if provided)
                const score = context.scoreText
                    ? ` — ${context.scoreText}`
                    : "";
                const by = context.actorName
                    ? ` (by ${context.actorName})`
                    : "";

                lastUpdateText = `🆕 **Last update:** ${fmtPlayerInline(
                    context.playerAId
                )} vs ${fmtPlayerInline(context.playerBId)}${score}${by}`;
                if (movementText) {
                    lastUpdateText += `\n📈 ${movementText}`;
                }
            }

            const embed = buildSummaryEmbed({
                seasonName: res.season.name,
                divisionName: d.division.name,
                standings: d.standings,
                lastUpdateText,
            });

            await msg.edit({ embeds: [embed] });
            updated += 1;
        }

        return { updated, skipped: false };
    }
}
