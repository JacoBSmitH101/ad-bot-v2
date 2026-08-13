import { DomainError } from "../utils/DomainError.js";
import { AttachmentBuilder } from "discord.js";
import { renderStandingsImage } from "./StandingsImageRenderer.js";

function fmtPlayerInline(id, nameById) {
    if (id.startsWith("FAKE_")) return `\`${id}\``;
    if (nameById?.has(id)) return `\`${nameById.get(id)}\``;
    return `\`${id}\``;
}

function safeDivisionFilename(divisionName, fallback) {
    const safeName = String(divisionName)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "");
    return `standings-${safeName || fallback}.png`;
}

function buildRankMap(rows) {
    const map = new Map();
    rows.forEach((r, i) => map.set(r.discordUserId, i + 1));
    return map;
}

/**
 * Format rank movement arrow.
 * @private
 * @param {number} delta
 * @returns {string}
 */
function arrow(delta) {
    if (delta < 0) return `🟢▲${Math.abs(delta)}`;
    if (delta > 0) return `🔴▼${delta}`;
    return "⚪—";
}

/**
 * Service for publishing and refreshing standings messages in Discord.
 * Manages Discord image creation and message updates for division standings.
 */
export class StandingsPublisherService {
    /**
     * @param {{ seasons: SeasonRepository, standings: StandingsService, matches: MatchRepository, players: PlayersRepository }} deps
     * @param {SeasonRepository} deps.seasons Season repository instance.
     * @param {StandingsService} deps.standings Standings service instance.
     * @param {MatchRepository} deps.matches Match repository instance.
     * @param {PlayersRepository} deps.players Players repository instance.
     */
    constructor({ seasons, standings, matches, players }) {
        this.seasons = seasons;
        this.standings = standings;
        this.matches = matches;
        this.players = players;
    }

    /**
     * Get player season averages from match stats cache.
     * @private
     * @param {string|number} seasonId
     * @param {Array.<StandingsRow>} standings
     * @returns {Promise<Map<string, number>>} Map of discordUserId -> average
     */
    async getPlayerAverages(seasonId, standings) {
        void seasonId;
        return new Map(
            standings
                .filter(
                    (row) =>
                        row.average != null &&
                        Number.isFinite(Number(row.average))
                )
                .map((row) => [row.discordUserId, Number(row.average)])
        );
    }

    /**
     * Create (or recreate) standings messages in a channel and store their message IDs.
     * Posts one message per division.
     * @param {{ client: Client, guildId: string, channelId: string }} params
     * @returns {Promise<{season: Season, channelId: string, messageIds: Object}>}
     * @throws {DomainError} If no season, invalid state, or bad channel.
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

        for (const [divisionIndex, d] of res.divisions.entries()) {
            // Get player averages for this division
            const playerAverages = await this.getPlayerAverages(
                res.season.id,
                d.standings
            );

            const png = await renderStandingsImage({
                seasonName: res.season.name,
                divisionName: d.division.name,
                standings: d.standings,
                playerAverages,
                isTopDivision: divisionIndex === 0,
                isBottomDivision:
                    divisionIndex === res.divisions.length - 1,
            });
            const file = new AttachmentBuilder(png, {
                name: safeDivisionFilename(
                    d.division.name,
                    divisionIndex + 1
                ),
                description: `${res.season.name} ${d.division.name} standings`,
            });

            const msg = await channel.send({ files: [file] });

            messageIds[`division:${d.division.id}`] = msg.id;
        }

        await this.seasons.setStandingsChannel(season.id, channelId);
        await this.seasons.setStandingsMessageIds(season.id, messageIds);

        return { season, channelId, messageIds };
    }

    /**
     * Recompute standings and edit existing published messages.
     * Call this after every confirm. Optionally includes movement context.
     * @param {{ client: Client, guildId: string, context: (Object|null) }} params
     * @param {Object|null} [params.context] Optional context with divisionId, beforeStandings, afterStandings, playerAId, playerBId, scoreText, actorName, reportedBy
     * @returns {Promise<{updated: number, skipped: boolean}>}
     * @throws {DomainError} If no season.
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

        // Fetch player names
        const playerIds = new Set();
        for (const d of res.divisions) {
            for (const s of d.standings) {
                if (!s.discordUserId.startsWith("FAKE_")) {
                    playerIds.add(s.discordUserId);
                }
            }
        }
        if (context?.playerAId && !context.playerAId.startsWith("FAKE_")) {
            playerIds.add(context.playerAId);
        }
        if (context?.playerBId && !context.playerBId.startsWith("FAKE_")) {
            playerIds.add(context.playerBId);
        }
        if (context?.reportedBy && !context.reportedBy.startsWith("FAKE_")) {
            playerIds.add(context.reportedBy);
        }

        const nameById = new Map();
        if (playerIds.size > 0) {
            const players = await this.players.listByDiscordIds({
                discordUserIds: [...playerIds],
            });
            for (const p of players) {
                const name = p.display_name ?? p.discord_user_id;
                nameById.set(p.discord_user_id, name);
            }
        }

        let beforeDivisionStandings = null;
        let afterDivisionStandings = null;
        let movementText = null;
        const rankMovements = new Map();

        if (
            context?.divisionId &&
            context?.beforeStandings &&
            context?.afterStandings
        ) {
            beforeDivisionStandings = context.beforeStandings;
            afterDivisionStandings = context.afterStandings;

            const beforeMap = buildRankMap(beforeDivisionStandings);
            const afterMap = buildRankMap(afterDivisionStandings);

            for (const [playerId, afterRank] of afterMap.entries()) {
                const beforeRank = beforeMap.get(playerId);
                if (!beforeRank) continue;
                const delta = afterRank - beforeRank;
                if (delta !== 0) {
                    rankMovements.set(String(playerId), delta);
                }
            }

            const ids = [context.playerAId, context.playerBId].filter(Boolean);

            const parts = ids.map((id) => {
                const b = beforeMap.get(id);
                const a = afterMap.get(id);
                if (!b || !a) return `${fmtPlayerInline(id, nameById)}: —`;
                const delta = a - b;
                return `${fmtPlayerInline(id, nameById)} ${b}→**${a}** (${arrow(delta)})`;
            });

            movementText = parts.length ? parts.join(" • ") : null;
        }

        let updated = 0;

        for (const [divisionIndex, d] of res.divisions.entries()) {
            const key = `division:${d.division.id}`;
            const msgId = season.standings_message_ids?.[key];
            if (!msgId) continue;

            const msg = await channel.messages.fetch(msgId).catch(() => null);
            if (!msg) continue;

            let lastUpdateText = null;

            if (
                context?.divisionId &&
                String(d.division.id) === String(context.divisionId)
            ) {
                // Score line (from stored match result if provided)
                const score = context.scoreText
                    ? ` — ${context.scoreText}`
                    : "";
                
                // Use reported_by from database if available, otherwise fall back to actorName
                let actorName = null;
                if (context.reportedBy && nameById.has(context.reportedBy)) {
                    actorName = nameById.get(context.reportedBy);
                } else if (context.actorName) {
                    actorName = context.actorName;
                }
                
                const by = actorName
                    ? ` (by ${actorName})`
                    : "";

                lastUpdateText = `🆕 **Last update:** ${fmtPlayerInline(
                    context.playerAId,
                    nameById
                )} vs ${fmtPlayerInline(context.playerBId, nameById)}${score}${by}`;
                if (movementText) {
                    lastUpdateText += `\n📈 ${movementText}`;
                }
            }

            // Get player averages for this division
            const playerAverages = await this.getPlayerAverages(
                res.season.id,
                d.standings
            );

            const png = await renderStandingsImage({
                seasonName: res.season.name,
                divisionName: d.division.name,
                standings: d.standings,
                playerAverages,
                rankMovements:
                    context?.divisionId &&
                    String(d.division.id) === String(context.divisionId)
                        ? rankMovements
                        : new Map(),
                isTopDivision: divisionIndex === 0,
                isBottomDivision:
                    divisionIndex === res.divisions.length - 1,
            });
            const file = new AttachmentBuilder(png, {
                name: safeDivisionFilename(
                    d.division.name,
                    divisionIndex + 1
                ),
                description: `${res.season.name} ${d.division.name} standings`,
            });

            await msg.edit({
                content: lastUpdateText ?? "",
                embeds: [],
                components: [],
                attachments: [],
                files: [file],
            });
            updated += 1;
        }

        return { updated, skipped: false };
    }
}
