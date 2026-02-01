import { EmbedBuilder } from "discord.js";
import { DomainError } from "../utils/DomainError.js";

/**
 * Formats a player ID for display.
 * @private
 * @param {string} id
 * @param {Map<string, string>} [nameById]
 * @returns {string}
 */
function fmtPlayer(id, nameById) {
    if (id.startsWith("FAKE_")) return `\`${id}\``;
    if (nameById?.has(id)) return `\`${nameById.get(id)}\``;
    return `\`${id}\``;
}

function statusIcon(status) {
    if (status === "confirmed") return "🟢";
    if (status === "reported") return "🟠";
    return "🗓️";
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

/**
 * Service for publishing and refreshing fixture messages in Discord.
 * Manages Discord embed creation and message updates for weekly fixtures.
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
        const divNameById = new Map(divisions.map((d) => [d.id, d.name]));

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
            for (const p of players) {
                const name = p.display_name ?? p.discord_user_id;
                nameById.set(p.discord_user_id, name);
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

        const embed = new EmbedBuilder()
            .setTitle(`📅 Weekly Fixtures — ${season.name}`)
            .setDescription(
                `**Week ${week}**\n🗓️ to-play • 🟠 reported • 🟢 confirmed`
            )
            .setTimestamp();

        if (matches.length === 0) {
            embed.addFields({
                name: `Week ${week}`,
                value: "_No fixtures found for this week._",
                inline: false,
            });
        } else {
            const divIds = [...byDiv.keys()].sort((a, b) =>
                String(divNameById.get(a) ?? a).localeCompare(
                    divNameById.get(b) ?? b
                )
            );

            for (const divId of divIds) {
                const ms = byDiv.get(divId) ?? [];
                const divName = divNameById.get(divId) ?? `Division ${divId}`;

                const lines = ms.map((m) => {
                    const icon = statusIcon(m.status);
                    const mr = normalizeMatchResult(m);

                    let score = "";
                    let proof = "";

                    if (mr) {
                        score = ` — **${mr.legs_a}-${mr.legs_b}**`;
                        if (mr.proof_url)
                            proof = ` ([Match](${mr.proof_url}))`;
                    }

                    // show raw A vs B orientation; it's "fixtures", not personal view
                    return `${icon} ${fmtPlayer(
                        m.player_a_id,
                        nameById
                    )} vs ${fmtPlayer(m.player_b_id, nameById)}${score}${proof}`;
                });

                embed.addFields({
                    name: divName,
                    value: lines.join("\n"),
                    inline: false,
                });
            }
        }

        // Add section for past unreported matches
        if (pastMatches.length > 0) {
            const pastDivIds = [...pastByDiv.keys()].sort((a, b) =>
                String(divNameById.get(a) ?? a).localeCompare(
                    divNameById.get(b) ?? b
                )
            );

            for (const divId of pastDivIds) {
                const ms = pastByDiv.get(divId) ?? [];
                const divName = divNameById.get(divId) ?? `Division ${divId}`;

                const lines = ms.map((m) => {
                    const icon = statusIcon(m.status);
                    const mr = normalizeMatchResult(m);

                    let score = "";
                    let proof = "";

                    if (mr) {
                        score = ` — **${mr.legs_a}-${mr.legs_b}**`;
                        if (mr.proof_url)
                            proof = ` ([Match](${mr.proof_url}))`;
                    }

                    return `${icon} ${fmtPlayer(
                        m.player_a_id,
                        nameById
                    )} vs ${fmtPlayer(m.player_b_id, nameById)}${score}${proof}`;
                });

                embed.addFields({
                    name: `${divName} (Past Weeks)`,
                    value: lines.join("\n"),
                    inline: false,
                });
            }
        }

        await msg.edit({ content: "", embeds: [embed], components: [] });

        return { updated: true, skipped: false };
    }
}
