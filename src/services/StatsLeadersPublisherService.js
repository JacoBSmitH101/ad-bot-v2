import { DomainError } from "../utils/DomainError.js";
import { AttachmentBuilder } from "discord.js";
import { extractAutodartsMatchId } from "../utils/autodarts.js";
import { supabase } from "../db/supabase.js";
import { renderStatsLeadersImage } from "./StatsLeadersImageRenderer.js";

/**
 * Align match stats to find the correct player's stats using legs won.
 * @private
 * @param {{ matchStats: Array.<Object>, legsA: number, legsB: number, playerAId: string, playerBId: string, targetPlayerId: string }} params
 * @returns {(Object|null)} The stats for the target player, or null if not found
 */
function findPlayerStatsByLegsWon({
    matchStats,
    legsA,
    legsB,
    playerAId,
    playerBId,
    targetPlayerId,
}) {
    const ms0 = matchStats?.[0];
    const ms1 = matchStats?.[1];
    if (!ms0 || !ms1) return null;

    const w0 = Number(ms0.legsWon);
    const w1 = Number(ms1.legsWon);

    const a = Number(legsA);
    const b = Number(legsB);

    // Determine which player we're looking for
    const isPlayerA = targetPlayerId === playerAId;
    const targetLegs = isPlayerA ? a : b;

    // Try to match by legs won
    if (Number.isFinite(w0) && Number.isFinite(w1)) {
        // Check if w0 matches target player's legs
        if (w0 === targetLegs) {
            return ms0;
        }
        // Check if w1 matches target player's legs
        if (w1 === targetLegs) {
            return ms1;
        }

        // If we can match the other player, return the opposite stat
        const otherLegs = isPlayerA ? b : a;
        if (w0 === otherLegs) {
            // ms0 is the other player, so ms1 must be the target
            return ms1;
        }
        if (w1 === otherLegs) {
            // ms1 is the other player, so ms0 must be the target
            return ms0;
        }
    }

    // If we can't align by legs won, return null to avoid incorrect assignment
    return null;
}

/**
 * Service for publishing and refreshing stats leaders messages in Discord.
 * Manages Discord embed creation and message updates for season stat leaders.
 */
export class StatsLeadersPublisherService {
    /**
     * @param {{ seasons: SeasonRepository, matches: MatchRepository, players: PlayersRepository }} deps
     * @param {SeasonRepository} deps.seasons Season repository instance.
     * @param {MatchRepository} deps.matches Match repository instance.
     * @param {PlayersRepository} deps.players Players repository instance.
     */
    constructor({ seasons, matches, players }) {
        this.seasons = seasons;
        this.matches = matches;
        this.players = players;
    }

    /**
     * Get all player stats for a season.
     * Aggregates stats from all confirmed matches.
     * @private
     * @param {string|number} seasonId
     * @returns {Promise<Map<string, {average: number, checkoutPercent: number, highestCheckout: number, first9Average: number, matchCount: number}>>}
     */
    async getAllPlayerStats(seasonId) {
        const statsMap = new Map();

        // Get all confirmed matches for the season with results
        const matches = await this.matches.listConfirmedForSeasonWithResults(
            seasonId
        );

        if (!matches || matches.length === 0) return statsMap;

        // Get all unique player IDs
        const playerIds = new Set();
        for (const m of matches) {
            if (m.player_a_id && !m.player_a_id.startsWith("FAKE_")) {
                playerIds.add(m.player_a_id);
            }
            if (m.player_b_id && !m.player_b_id.startsWith("FAKE_")) {
                playerIds.add(m.player_b_id);
            }
        }

        // Initialize stats for all players
        for (const playerId of playerIds) {
            statsMap.set(playerId, {
                averages: [],
                checkoutPercents: [],
                highestCheckout: 0,
                first9Averages: [],
                matchCount: 0,
            });
        }

        // Process each match
        for (const match of matches) {
            const mrRaw = match.match_results;
            const mr = Array.isArray(mrRaw) ? mrRaw[0] : mrRaw;
            if (!mr?.proof_url) continue;

            const matchId = extractAutodartsMatchId(mr.proof_url);
            if (!matchId) continue;

            // Query public schema cache table
            const { data: cacheData, error: cacheError } = await supabase
                .from("autodarts_match_stats_cache")
                .select("stats")
                .eq("match_id", matchId)
                .maybeSingle();

            if (cacheError || !cacheData) continue;

            // Parse JSON stats
            const stats =
                typeof cacheData.stats === "string"
                    ? JSON.parse(cacheData.stats)
                    : cacheData.stats;

            const matchStats = stats?.matchStats || stats;
            if (!Array.isArray(matchStats) || matchStats.length < 2) continue;

            // Process stats for both players
            for (const playerId of [match.player_a_id, match.player_b_id]) {
                if (!playerId || playerId.startsWith("FAKE_")) continue;

                const playerStats = findPlayerStatsByLegsWon({
                    matchStats,
                    legsA: mr.legs_a,
                    legsB: mr.legs_b,
                    playerAId: match.player_a_id,
                    playerBId: match.player_b_id,
                    targetPlayerId: playerId,
                });

                if (!playerStats) continue;

                const playerData = statsMap.get(playerId);
                if (!playerData) continue;

                // Collect averages
                if (
                    playerStats.average != null &&
                    Number.isFinite(Number(playerStats.average))
                ) {
                    playerData.averages.push(Number(playerStats.average));
                }

                // Collect checkout percentages (convert from decimal to percent)
                if (
                    playerStats.checkoutPercent != null &&
                    Number.isFinite(Number(playerStats.checkoutPercent))
                ) {
                    playerData.checkoutPercents.push(
                        Number(playerStats.checkoutPercent) * 100
                    );
                }

                // Track highest checkout
                if (
                    playerStats.checkoutPoints != null &&
                    Number.isFinite(Number(playerStats.checkoutPoints))
                ) {
                    const checkout = Number(playerStats.checkoutPoints);
                    if (checkout > playerData.highestCheckout) {
                        playerData.highestCheckout = checkout;
                    }
                }

                // Collect first 9 averages
                if (
                    playerStats.first9Average != null &&
                    Number.isFinite(Number(playerStats.first9Average))
                ) {
                    playerData.first9Averages.push(
                        Number(playerStats.first9Average)
                    );
                }

                playerData.matchCount += 1;
            }
        }

        // Calculate aggregated stats
        const aggregated = new Map();
        for (const [playerId, data] of statsMap.entries()) {
            if (data.matchCount === 0) continue;

            const avg =
                data.averages.length > 0
                    ? data.averages.reduce((sum, a) => sum + a, 0) /
                      data.averages.length
                    : null;

            const checkoutPercent =
                data.checkoutPercents.length > 0
                    ? data.checkoutPercents.reduce((sum, c) => sum + c, 0) /
                      data.checkoutPercents.length
                    : null;

            const first9Avg =
                data.first9Averages.length > 0
                    ? data.first9Averages.reduce((sum, f) => sum + f, 0) /
                      data.first9Averages.length
                    : null;

            aggregated.set(playerId, {
                average: avg,
                checkoutPercent: checkoutPercent,
                highestCheckout:
                    data.highestCheckout > 0 ? data.highestCheckout : null,
                first9Average: first9Avg,
                matchCount: data.matchCount,
            });
        }

        return aggregated;
    }

    async buildImage({ client, season }) {
        const allStats = await this.getAllPlayerStats(season.id);
        const playerIds = [...allStats.keys()];
        const nameById = new Map();

        if (playerIds.length > 0) {
            const players = await this.players.listByDiscordIds({
                discordUserIds: playerIds,
            });
            const foundIds = new Set();
            for (const player of players) {
                const name =
                    player.display_name ?? player.discord_user_id;
                nameById.set(player.discord_user_id, name);
                foundIds.add(player.discord_user_id);
            }

            const missingIds = playerIds.filter(
                (id) => !foundIds.has(id)
            );
            for (const missingId of missingIds) {
                try {
                    const discordUser = await client.users.fetch(missingId);
                    const name =
                        discordUser.displayName ?? discordUser.username;
                    nameById.set(missingId, name);
                    await this.players.upsert({
                        discordUserId: missingId,
                        displayName: name,
                    });
                } catch {
                    // Fall back to the Discord ID when the user cannot be fetched.
                }
            }
        }

        const leadersFor = (field) =>
            [...allStats.entries()]
                .filter(
                    ([, stats]) =>
                        stats[field] != null &&
                        Number.isFinite(Number(stats[field]))
                )
                .sort(
                    ([, a], [, b]) =>
                        Number(b[field]) - Number(a[field])
                )
                .slice(0, 5)
                .map(([playerId, stats]) => ({
                    name: nameById.get(playerId) ?? playerId,
                    value: Number(stats[field]),
                    matchCount: Number(stats.matchCount ?? 0),
                }));

        const matchesWithStats = Math.round(
            [...allStats.values()].reduce(
                (sum, stats) => sum + Number(stats.matchCount ?? 0),
                0
            ) / 2
        );
        return renderStatsLeadersImage({
            seasonName: season.name,
            qualifiedPlayers: allStats.size,
            matchesWithStats,
            average: leadersFor("average"),
            checkoutPercent: leadersFor("checkoutPercent"),
            highestCheckout: leadersFor("highestCheckout"),
            first9Average: leadersFor("first9Average"),
        });
    }

    createAttachment(image, season) {
        const safeSeasonName = String(season.name)
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-|-$/g, "");
        return new AttachmentBuilder(image, {
            name: `stat-leaders-${safeSeasonName || season.id}.png`,
            description: `${season.name} stat leaders`,
        });
    }

    /**
     * Create (or recreate) stats leaders message in a channel and store its message ID.
     * @param {{ client: Client, guildId: string, channelId: string }} params
     * @returns {Promise<{season: Season, channelId: string, messageId: string}>}
     * @throws {DomainError} If no season, invalid state, or bad channel.
     */
    async publish({ client, guildId, channelId }) {
        const season = await this.seasons.getCurrentForGuild(guildId);
        if (!season) throw new DomainError("NO_SEASON", "No season found.");

        if (!["active", "closed"].includes(season.status)) {
            throw new DomainError(
                "INVALID_STATE",
                `Stats publish only available when season is active/closed (current: ${season.status})`
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

        const image = await this.buildImage({ client, season });
        const file = this.createAttachment(image, season);
        const msg = await channel.send({ files: [file] });

        await this.seasons.setStatsChannel(season.id, channelId);
        await this.seasons.setStatsMessageId(season.id, msg.id);

        return { season, channelId, messageId: msg.id };
    }

    /**
     * Recompute stats leaders and edit existing published message.
     * Call this after every match confirmation.
     * @param {{ client: Client, guildId: string }} params
     * @returns {Promise<{updated: boolean, skipped: boolean}>}
     * @throws {DomainError} If no season.
     */
    async refresh({ client, guildId }) {
        const season = await this.seasons.getCurrentForGuild(guildId);
        if (!season) throw new DomainError("NO_SEASON", "No season found.");

        if (!season.stats_channel_id || !season.stats_message_id) {
            // not published yet; silently skip
            return { updated: false, skipped: true };
        }

        const channel = await client.channels
            .fetch(season.stats_channel_id)
            .catch(() => null);

        if (!channel || !channel.isTextBased()) {
            return { updated: false, skipped: true };
        }

        const msg = await channel.messages
            .fetch(season.stats_message_id)
            .catch(() => null);
        if (!msg) return { updated: false, skipped: true };

        const image = await this.buildImage({ client, season });
        const file = this.createAttachment(image, season);
        await msg.edit({
            content: "",
            embeds: [],
            components: [],
            attachments: [],
            files: [file],
        });

        return { updated: true, skipped: false };
    }
}
