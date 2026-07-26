import { AttachmentBuilder } from "discord.js";
import { DomainError } from "../utils/DomainError.js";
import { renderFixturesImage } from "./FixturesImageRenderer.js";

function fixtureMessageKey(divisionId) {
    return `division:${divisionId ?? "all"}`;
}

function parseFixtureMessageIds(rawValue, divisions) {
    if (rawValue && typeof rawValue === "object" && !Array.isArray(rawValue)) {
        return { ...rawValue };
    }

    const raw = String(rawValue ?? "").trim();
    if (!raw) return {};

    try {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
            return parsed;
        }
    } catch {
        // A plain Discord ID is the legacy format.
    }

    const firstDivision = divisions[0];
    return firstDivision
        ? { [fixtureMessageKey(firstDivision.id)]: raw }
        : {};
}

function fixtureAttachment({ image, season, division, week }) {
    const safeDivisionName = String(division.name)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "");
    return new AttachmentBuilder(image, {
        name: `fixtures-week-${week}-${
            safeDivisionName || division.sort_order || "division"
        }.png`,
        description: `${season.name} ${division.name} Week ${week} fixtures`,
    });
}

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

    async buildDivisionImages({ client, season, week }) {
        const matches = await this.matches.listForSeasonWeekWithResults({
            seasonId: season.id,
            week,
        });
        const pastMatches = await this.matches.listUnreportedBeforeWeek({
            seasonId: season.id,
            week,
        });
        const divisions = await this.divisions.listForSeason(season.id);
        const divisionsToRender =
            divisions.length > 0
                ? divisions
                : [{ id: null, name: "All Divisions", sort_order: 1 }];

        const playerIds = new Set();
        for (const match of [...matches, ...pastMatches]) {
            playerIds.add(match.player_a_id);
            playerIds.add(match.player_b_id);
        }

        const nameById = new Map();
        const idsToLookup = [...playerIds].filter(
            (id) => !String(id).startsWith("FAKE_")
        );
        if (idsToLookup.length > 0) {
            const players = await this.players.listByDiscordIds({
                discordUserIds: idsToLookup,
            });
            const foundIds = new Set();
            for (const player of players) {
                const name =
                    player.display_name ?? player.discord_user_id;
                nameById.set(player.discord_user_id, name);
                foundIds.add(player.discord_user_id);
            }

            const missingIds = idsToLookup.filter(
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
                    // Fall back to the Discord ID if the user cannot be fetched.
                }
            }
        }

        const byDivision = new Map();
        for (const match of matches) {
            const key = String(match.division_id);
            if (!byDivision.has(key)) byDivision.set(key, []);
            byDivision.get(key).push(match);
        }
        const overdueByDivision = new Map();
        for (const match of pastMatches) {
            const key = String(match.division_id);
            if (!overdueByDivision.has(key)) overdueByDivision.set(key, []);
            overdueByDivision.get(key).push(match);
        }

        const images = [];
        for (const division of divisionsToRender) {
            const divisionKey = String(division.id);
            const divisionMatches =
                division.id === null
                    ? matches
                    : byDivision.get(divisionKey) ?? [];
            const overdueMatches =
                division.id === null
                    ? pastMatches
                    : overdueByDivision.get(divisionKey) ?? [];
            divisionMatches.sort((a, b) =>
                String(a.id).localeCompare(String(b.id))
            );
            overdueMatches.sort(
                (a, b) =>
                    Number(a.week) - Number(b.week) ||
                    String(a.id).localeCompare(String(b.id))
            );

            const image = await renderFixturesImage({
                seasonName: season.name,
                divisionName: division.name,
                week,
                matches: divisionMatches,
                overdueMatches,
                nameById,
            });
            images.push({ division, image });
        }

        return images;
    }

    /**
     * Publish fixtures for a week to a Discord channel.
     * Creates one image message per division and stores their references.
     * @param {{ client: Client, guildId: string, channelId: string, week: (number|null) }} params
     * @returns {Promise<{season: Season, channelId: string, messageId: (string|null), messageIds: Object.<string, string>, week: number}>}
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

        await this.seasons.setFixturesChannel(season.id, channelId);
        await this.seasons.setFixturesWeek(season.id, targetWeek);

        const divisionImages = await this.buildDivisionImages({
            client,
            season,
            week: targetWeek,
        });
        const messageIds = {};
        for (const entry of divisionImages) {
            const file = fixtureAttachment({
                image: entry.image,
                season,
                division: entry.division,
                week: targetWeek,
            });
            const msg = await channel.send({ files: [file] });
            messageIds[fixtureMessageKey(entry.division.id)] = msg.id;
        }
        await this.seasons.setFixturesMessageIds(season.id, messageIds);

        return {
            season,
            channelId,
            messageId: Object.values(messageIds)[0] ?? null,
            messageIds,
            week: targetWeek,
        };
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
     * Refresh each published division fixture message with current data.
     * @param {{ client: Client, guildId: string }} params
     * @returns {Promise<{updated: boolean, updatedCount?: number, skipped: boolean}>}
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

        const divisionImages = await this.buildDivisionImages({
            client,
            season,
            week,
        });
        const divisions = divisionImages.map(({ division }) => division);
        const originalStoredValue =
            typeof season.fixtures_message_id === "string"
                ? season.fixtures_message_id.trim()
                : JSON.stringify(season.fixtures_message_id ?? {});
        const messageIds = parseFixtureMessageIds(
            season.fixtures_message_id,
            divisions
        );

        let updatedCount = 0;
        for (const entry of divisionImages) {
            const key = fixtureMessageKey(entry.division.id);
            const storedId = messageIds[key];
            let msg = storedId
                ? await channel.messages.fetch(storedId).catch(() => null)
                : null;
            const file = fixtureAttachment({
                image: entry.image,
                season,
                division: entry.division,
                week,
            });

            if (msg) {
                await msg.edit({
                    content: "",
                    embeds: [],
                    components: [],
                    attachments: [],
                    files: [file],
                });
            } else {
                msg = await channel.send({ files: [file] });
                messageIds[key] = msg.id;
            }
            updatedCount += 1;
        }

        const serializedMessageIds = JSON.stringify(messageIds);
        if (serializedMessageIds !== originalStoredValue) {
            await this.seasons.setFixturesMessageIds(
                season.id,
                messageIds
            );
        }

        return {
            updated: updatedCount > 0,
            updatedCount,
            skipped: false,
        };
    }
}
