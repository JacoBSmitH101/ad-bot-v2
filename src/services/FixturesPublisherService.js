import { AttachmentBuilder } from "discord.js";
import { DomainError } from "../utils/DomainError.js";
import {
    combineFixtureImages,
    renderFixturesImage,
} from "./FixturesImageRenderer.js";

/**
 * Service for publishing and refreshing fixture messages in Discord.
 * Manages Discord image creation and message updates for weekly fixtures.
 */
export class FixturesPublisherService {
    /**
     * @param {{ seasons: SeasonRepository, matches: MatchRepository, divisions: DivisionRepository, players: PlayersRepository }} deps
     * @param {SeasonRepository} deps.seasons Season repository instance.
     * @param {MatchRepository} deps.matches Match repository instance.
     * @param {DivisionRepository} deps.divisions Division repository instance.
     * @param {PlayersRepository} deps.players Players repository instance.
     */
    constructor({ seasons, matches, divisions, players }) {
        this.seasons = seasons;
        this.matches = matches;
        this.divisions = divisions;
        this.players = players;
    }

    /**
     * Publish fixtures for a week to a Discord channel.
     * Creates a message and stores channel/message/week references.
     * @param {{ client: Client, guildId: string, channelId: string, week: (number|null) }} params
     * @returns {Promise<{season: Season, channelId: string, messageId: string, week: number}>}
     * @throws {DomainError} If no season, invalid state, bad channel, or invalid week.
     */
    async publish({ client, guildId, channelId, week = null }) {
        const season = await this.seasons.getCurrentForGuild(guildId);
        if (!season) throw new DomainError("NO_SEASON", "No season found.");

        if (!["active", "signups_closed", "closed"].includes(season.status)) {
            throw new DomainError(
                "INVALID_STATE",
                `Fixtures publish not available in this season state (current: ${season.status})`
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

        // default week: season.current_week, else 1
        const targetWeek = Number(week ?? season.current_week ?? 1);
        if (!Number.isInteger(targetWeek) || targetWeek < 1) {
            throw new DomainError("INVALID_WEEK", "Week must be >= 1.");
        }

        // store config
        await this.seasons.setFixturesChannel(season.id, channelId);
        await this.seasons.setFixturesWeek(season.id, targetWeek);

        // create placeholder message (we'll edit it immediately)
        const msg = await channel.send({
            content: "📅 Publishing fixtures...",
        });
        await this.seasons.setFixturesMessageId(season.id, msg.id);

        // render
        await this.refresh({ client, guildId });

        return { season, channelId, messageId: msg.id, week: targetWeek };
    }

    /**
     * Update the fixtures week and refresh the message.
     * @param {{ client: Client, guildId: string, week: number }} params
     * @returns {Promise<{seasonId: string, week: number}>}
     * @throws {DomainError} If no season or invalid week.
     */
    async setWeek({ client, guildId, week }) {
        const season = await this.seasons.getCurrentForGuild(guildId);
        if (!season) throw new DomainError("NO_SEASON", "No season found.");

        const targetWeek = Number(week);
        if (!Number.isInteger(targetWeek) || targetWeek < 1) {
            throw new DomainError("INVALID_WEEK", "Week must be >= 1.");
        }

        await this.seasons.setFixturesWeek(season.id, targetWeek);

        // update immediately
        await this.refresh({ client, guildId });

        return { seasonId: season.id, week: targetWeek };
    }

    /**
     * Refresh the published fixtures message with current data.
     * @param {{ client: Client, guildId: string }} params
     * @returns {Promise<{updated: boolean, skipped: boolean}>}
     * @throws {DomainError} If no season.
     */
    async refresh({ client, guildId }) {
        const season = await this.seasons.getCurrentForGuild(guildId);
        if (!season) throw new DomainError("NO_SEASON", "No season found.");

        if (!season.fixtures_channel_id || !season.fixtures_message_id) {
            // not published yet
            return { updated: false, skipped: true };
        }

        const week = Number(season.fixtures_week ?? season.current_week ?? 1);

        const channel = await client.channels
            .fetch(season.fixtures_channel_id)
            .catch(() => null);
        if (!channel || !channel.isTextBased())
            return { updated: false, skipped: true };

        const msg = await channel.messages
            .fetch(season.fixtures_message_id)
            .catch(() => null);
        if (!msg) return { updated: false, skipped: true };

        // pull matches + divisions to label nicely
        const matches = await this.matches.listForSeasonWeekWithResults({
            seasonId: season.id,
            week,
        });

        // pull unreported matches from previous weeks
        const pastMatches = await this.matches.listUnreportedBeforeWeek({
            seasonId: season.id,
            week,
        });

        const divisions = await this.divisions.listForSeason(season.id);

        const playerIds = new Set();
        for (const m of matches) {
            playerIds.add(m.player_a_id);
            playerIds.add(m.player_b_id);
        }
        for (const m of pastMatches) {
            playerIds.add(m.player_a_id);
            playerIds.add(m.player_b_id);
        }

        const nameById = new Map();
        const idsToLookup = [...playerIds].filter(
            (id) => !id.startsWith("FAKE_")
        );
        if (idsToLookup.length > 0) {
            const players = await this.players.listByDiscordIds({
                discordUserIds: idsToLookup,
            });
            const foundIds = new Set();
            for (const p of players) {
                const name = p.display_name ?? p.discord_user_id;
                nameById.set(p.discord_user_id, name);
                foundIds.add(p.discord_user_id);
            }

            // Fallback: try to fetch missing players from Discord API
            // This handles edge cases where players exist in matches but not in the players table
            const missingIds = idsToLookup.filter((id) => !foundIds.has(id));
            if (missingIds.length > 0 && client) {
                for (const missingId of missingIds) {
                    try {
                        const discordUser = await client.users.fetch(missingId);
                        const name = discordUser.displayName ?? discordUser.username;
                        nameById.set(missingId, name);
                        // Also upsert to players table for future lookups
                        await this.players.upsert({
                            discordUserId: missingId,
                            displayName: name,
                        });
                    } catch (err) {
                        // User not found or other error - will fall back to showing ID
                    }
                }
            }
        }

        // group by division
        const byDiv = new Map();
        for (const m of matches) {
            if (!byDiv.has(m.division_id)) byDiv.set(m.division_id, []);
            byDiv.get(m.division_id).push(m);
        }

        // group past matches by division
        const pastByDiv = new Map();
        for (const m of pastMatches) {
            if (!pastByDiv.has(m.division_id)) pastByDiv.set(m.division_id, []);
            pastByDiv.get(m.division_id).push(m);
        }

        const divisionsToRender =
            divisions.length > 0
                ? divisions
                : [{ id: null, name: "All Divisions" }];
        const divisionImages = [];

        for (const division of divisionsToRender) {
            const divisionMatches =
                division.id === null
                    ? matches
                    : byDiv.get(division.id) ?? [];
            const overdueMatches =
                division.id === null
                    ? pastMatches
                    : pastByDiv.get(division.id) ?? [];
            const image = await renderFixturesImage({
                seasonName: season.name,
                divisionName: division.name,
                week,
                matches: divisionMatches,
                overdueMatches,
                nameById,
            });
            divisionImages.push(image);
        }

        const png = await combineFixtureImages(divisionImages);
        const file = new AttachmentBuilder(png, {
            name: `fixtures-week-${week}.png`,
            description: `${season.name} Week ${week} fixtures`,
        });

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
