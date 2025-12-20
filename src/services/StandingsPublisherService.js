// src/services/StandingsPublisherService.js
import { DomainError } from "../utils/DomainError.js";
import { EmbedBuilder } from "discord.js";

function fmtPlayer(id) {
    return id.startsWith("FAKE_") ? `\`${id}\`` : `<@${id}>`;
}
function medal(i) {
    return i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : "•";
}

function buildSummaryEmbed({ seasonName, divisionName, standings }) {
    const lines = standings.map(
        (r, idx) =>
            `${medal(idx)} **${fmtPlayer(r.discordUserId)}** — **${
                r.points
            } pts**`
    );

    return new EmbedBuilder()
        .setTitle(`📊 ${seasonName} — ${divisionName}`)
        .setDescription(lines.join("\n") || "_No players._")
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
    async refresh({ client, guildId }) {
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

        let updated = 0;

        for (const d of res.divisions) {
            const key = `division:${d.division.id}`;
            const msgId = season.standings_message_ids?.[key];
            if (!msgId) continue;

            const msg = await channel.messages.fetch(msgId).catch(() => null);
            if (!msg) continue;

            const embed = buildSummaryEmbed({
                seasonName: res.season.name,
                divisionName: d.division.name,
                standings: d.standings,
            });

            await msg.edit({ embeds: [embed] });
            updated += 1;
        }

        return { updated, skipped: false };
    }
}
