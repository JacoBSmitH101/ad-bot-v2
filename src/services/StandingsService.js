import { DomainError } from "../utils/DomainError.js";
import { supabase } from "../db/supabase.js";
import { extractAutodartsMatchId } from "../utils/autodarts.js";

function normalizeMatchResult(match) {
    const raw = match?.match_results;
    return Array.isArray(raw) ? raw[0] : raw;
}

function findPlayerStatsByLegsWon({
    matchStats,
    legsA,
    legsB,
    playerAId,
    targetPlayerId,
}) {
    const first = matchStats?.[0];
    const second = matchStats?.[1];
    if (!first || !second) return null;

    const firstLegs = Number(first.legsWon);
    const secondLegs = Number(second.legsWon);
    const targetLegs = Number(
        targetPlayerId === playerAId ? legsA : legsB
    );
    const otherLegs = Number(
        targetPlayerId === playerAId ? legsB : legsA
    );

    if (firstLegs === targetLegs) return first;
    if (secondLegs === targetLegs) return second;
    if (firstLegs === otherLegs) return second;
    if (secondLegs === otherLegs) return first;
    return null;
}

export function sortStandingsRows(rows) {
    rows.sort((x, y) => {
        if (y.points !== x.points) return y.points - x.points;
        if (y.legDiff !== x.legDiff) return y.legDiff - x.legDiff;
        if (y.legsFor !== x.legsFor) return y.legsFor - x.legsFor;

        const xAverage =
            x.average != null && Number.isFinite(Number(x.average))
                ? Number(x.average)
                : Number.NEGATIVE_INFINITY;
        const yAverage =
            y.average != null && Number.isFinite(Number(y.average))
                ? Number(y.average)
                : Number.NEGATIVE_INFINITY;
        if (yAverage !== xAverage) return yAverage - xAverage;

        return String(x.name).localeCompare(String(y.name));
    });
    return rows;
}

/**
 * @typedef {Object} StandingsRow
 * @property {string} discordUserId
 * @property {string} name
 * @property {number} played
 * @property {number} totalMatches
 * @property {number} wins
 * @property {number} losses
 * @property {number} legsFor
 * @property {number} legsAgainst
 * @property {number} legDiff
 * @property {number} points
 * @property {number|null} average
 */

/**
 * Service for computing and retrieving standings.
 * Calculates player statistics from confirmed matches.
 */
export class StandingsService {
    /**
     * @param {{ seasons: SeasonRepository, divisions: DivisionRepository, divisionPlayers: DivisionPlayersRepository, matches: MatchRepository, statsDb?: Object }} deps
     * @param {SeasonRepository} deps.seasons Season repository instance.
     * @param {DivisionRepository} deps.divisions Division repository instance.
     * @param {DivisionPlayersRepository} deps.divisionPlayers Division players repository instance.
     * @param {MatchRepository} deps.matches Match repository instance.
     * @param {Object} [deps.statsDb] Supabase-compatible stats client.
     */
    constructor({
        seasons,
        divisions,
        divisionPlayers,
        matches,
        statsDb = supabase,
    }) {
        this.seasons = seasons;
        this.divisions = divisions;
        this.divisionPlayers = divisionPlayers;
        this.matches = matches;
        this.statsDb = statsDb;
    }

    async getPlayerAveragesFromConfirmed(confirmedMatches) {
        const matchEntries = confirmedMatches
            .map((match) => {
                const result = normalizeMatchResult(match);
                const autodartsMatchId = result?.proof_url
                    ? extractAutodartsMatchId(result.proof_url)
                    : null;
                return autodartsMatchId
                    ? { match, result, autodartsMatchId }
                    : null;
            })
            .filter(Boolean);
        const matchIds = [
            ...new Set(
                matchEntries.map((entry) => entry.autodartsMatchId)
            ),
        ];
        if (matchIds.length === 0) return new Map();

        let data;
        let error;
        try {
            ({ data, error } = await this.statsDb
                .from("autodarts_match_stats_cache")
                .select("match_id, stats")
                .in("match_id", matchIds));
        } catch (queryError) {
            console.warn(
                "Could not load averages for standings:",
                queryError
            );
            return new Map();
        }
        if (error || !data) {
            console.warn(
                "Could not load averages for standings:",
                error?.message ?? error
            );
            return new Map();
        }

        const statsByMatchId = new Map(
            data.map((row) => [String(row.match_id), row.stats])
        );
        const valuesByPlayer = new Map();

        for (const entry of matchEntries) {
            try {
                const rawStats = statsByMatchId.get(
                    String(entry.autodartsMatchId)
                );
                const stats =
                    typeof rawStats === "string"
                        ? JSON.parse(rawStats)
                        : rawStats;
                const matchStats =
                    stats?.stats?.matchStats ??
                    stats?.matchStats ??
                    stats;
                if (!Array.isArray(matchStats) || matchStats.length < 2) {
                    continue;
                }

                for (const playerId of [
                    entry.match.player_a_id,
                    entry.match.player_b_id,
                ]) {
                    const playerStats = findPlayerStatsByLegsWon({
                        matchStats,
                        legsA: entry.result.legs_a,
                        legsB: entry.result.legs_b,
                        playerAId: entry.match.player_a_id,
                        targetPlayerId: playerId,
                    });
                    if (playerStats?.average == null) continue;
                    const average = Number(playerStats.average);
                    if (!Number.isFinite(average)) continue;
                    if (!valuesByPlayer.has(playerId)) {
                        valuesByPlayer.set(playerId, []);
                    }
                    valuesByPlayer.get(playerId).push(average);
                }
            } catch (error) {
                console.warn(
                    `Could not parse stats for match ${entry.match.id}:`,
                    error
                );
            }
        }

        return new Map(
            [...valuesByPlayer.entries()].map(([playerId, values]) => [
                playerId,
                values.reduce((sum, value) => sum + value, 0) /
                    values.length,
            ])
        );
    }

    /**
     * Get standings for all divisions in the current season.
     * @param {{ guildId: string }} params
     * @returns {Promise<{season: Season, divisions: Array.<{division: Division, standings: Array.<StandingsRow>}>}>}
     * @throws {DomainError} If no season, invalid season state, or no divisions found.
     */
    async getStandingsForCurrentSeason({ guildId }) {
        const season = await this.seasons.getCurrentForGuild(guildId);
        return this.getStandingsForSeason({ season });
    }

    /**
     * Get standings for a supplied active or closed season.
     * @param {{ season: Season|null }} params
     * @returns {Promise<{season: Season, divisions: Array.<{division: Division, standings: Array.<StandingsRow>}>}>}
     * @throws {DomainError} If no season, invalid season state, or no divisions found.
     */
    async getStandingsForSeason({ season }) {
        if (!season) throw new DomainError("NO_SEASON", "No season found.");

        // Allow standings in active OR closed (useful)
        if (!["active", "closed"].includes(season.status)) {
            throw new DomainError(
                "INVALID_STATE",
                `Standings are only available when season is active/closed (current: ${season.status})`
            );
        }

        const divisions = await this.divisions.listForSeason(season.id);
        if (divisions.length === 0) {
            throw new DomainError(
                "NO_DIVISIONS",
                "No divisions found for this season."
            );
        }

        const out = [];

        for (const div of divisions) {
            const roster = await this.divisionPlayers.listPlayersForDivision(
                div.id
            );

            // base table so players with 0 games still appear
            const table = new Map();
            for (const p of roster) {
                table.set(p.discord_user_id, {
                    discordUserId: p.discord_user_id,
                    name: p.display_name ?? p.discord_user_id,
                    played: 0,
                    totalMatches: 0,
                    wins: 0,
                    losses: 0,
                    legsFor: 0,
                    legsAgainst: 0,
                    legDiff: 0,
                    points: 0,
                });
            }

            // Get all matches for the division (excluding void) to calculate total matches
            const allMatches = await this.matches.listAllForDivision({
                seasonId: season.id,
                divisionId: div.id,
            });

            // Count total matches per player
            for (const m of allMatches) {
                const aId = m.player_a_id;
                const bId = m.player_b_id;
                
                if (table.has(aId)) {
                    table.get(aId).totalMatches += 1;
                }
                if (table.has(bId)) {
                    table.get(bId).totalMatches += 1;
                }
            }

            const confirmed =
                await this.matches.listConfirmedWithResultsForDivision({
                    seasonId: season.id,
                    divisionId: div.id,
                });

            for (const m of confirmed) {
                // Supabase can return match_results as object or array; handle both
                const mrRaw = m.match_results;
                const mr = Array.isArray(mrRaw) ? mrRaw[0] : mrRaw;

                if (!mr) continue; // confirmed match should have result, but just in case

                const aId = m.player_a_id;
                const bId = m.player_b_id;
                const legsA = Number(mr.legs_a);
                const legsB = Number(mr.legs_b);

                // ensure both players exist in table (just in case roster mismatch)
                if (!table.has(aId)) {
                    table.set(aId, {
                        discordUserId: aId,
                        name: aId,
                        played: 0,
                        totalMatches: 0,
                        wins: 0,
                        losses: 0,
                        legsFor: 0,
                        legsAgainst: 0,
                        legDiff: 0,
                        points: 0,
                    });
                }
                if (!table.has(bId)) {
                    table.set(bId, {
                        discordUserId: bId,
                        name: bId,
                        played: 0,
                        totalMatches: 0,
                        wins: 0,
                        losses: 0,
                        legsFor: 0,
                        legsAgainst: 0,
                        legDiff: 0,
                        points: 0,
                    });
                }

                const A = table.get(aId);
                const B = table.get(bId);

                // played
                A.played += 1;
                B.played += 1;

                // legs
                A.legsFor += legsA;
                A.legsAgainst += legsB;

                B.legsFor += legsB;
                B.legsAgainst += legsA;

                // winner
                const aWon = legsA > legsB;
                const bWon = legsB > legsA;

                if (aWon) {
                    A.wins += 1;
                    B.losses += 1;
                    // points: 1 per leg + 2 win bonus
                    A.points += legsA + 2;
                    B.points += legsB;
                } else if (bWon) {
                    B.wins += 1;
                    A.losses += 1;
                    B.points += legsB + 2;
                    A.points += legsA;
                } else {
                    // should never happen (no draws) but keep safe
                    A.points += legsA;
                    B.points += legsB;
                }
            }

            const playerAverages =
                await this.getPlayerAveragesFromConfirmed(confirmed);

            // compute leg diff + sort
            const rows = [...table.values()].map((r) => ({
                ...r,
                legDiff: r.legsFor - r.legsAgainst,
                average: playerAverages.get(r.discordUserId) ?? null,
            }));

            sortStandingsRows(rows);

            out.push({
                division: div,
                standings: rows,
            });
        }

        return { season, divisions: out };
    }

    /**
     * Get standings for a specific division.
     * @param {{ guildId: string, divisionId: number }} params
     * @returns {Promise<{season: Season, standings: Array.<StandingsRow>}>}
     * @throws {DomainError} If no season or invalid season state.
     */
    async getDivisionStandings({ guildId, divisionId }) {
        const season = await this.seasons.getCurrentForGuild(guildId);
        if (!season) throw new DomainError("NO_SEASON", "No season found.");

        if (!["active", "closed"].includes(season.status)) {
            throw new DomainError(
                "INVALID_STATE",
                `Standings are only available when season is active/closed (current: ${season.status})`
            );
        }

        // roster
        const roster = await this.divisionPlayers.listPlayersForDivision(
            divisionId
        );

        const table = new Map();
        for (const p of roster) {
            table.set(p.discord_user_id, {
                discordUserId: p.discord_user_id,
                name: p.display_name ?? p.discord_user_id,
                played: 0,
                totalMatches: 0,
                wins: 0,
                losses: 0,
                legsFor: 0,
                legsAgainst: 0,
                legDiff: 0,
                points: 0,
            });
        }

        // Get all matches for the division (excluding void) to calculate total matches
        const allMatches = await this.matches.listAllForDivision({
            seasonId: season.id,
            divisionId,
        });

        // Count total matches per player
        for (const m of allMatches) {
            const aId = m.player_a_id;
            const bId = m.player_b_id;
            
            if (table.has(aId)) {
                table.get(aId).totalMatches += 1;
            }
            if (table.has(bId)) {
                table.get(bId).totalMatches += 1;
            }
        }

        const confirmed =
            await this.matches.listConfirmedWithResultsForDivision({
                seasonId: season.id,
                divisionId,
            });

        for (const m of confirmed) {
            const mrRaw = m.match_results;
            const mr = Array.isArray(mrRaw) ? mrRaw[0] : mrRaw;
            if (!mr) continue;

            const aId = m.player_a_id;
            const bId = m.player_b_id;
            const legsA = Number(mr.legs_a);
            const legsB = Number(mr.legs_b);

            if (!table.has(aId)) {
                table.set(aId, {
                    discordUserId: aId,
                    name: aId,
                    played: 0,
                    totalMatches: 0,
                    wins: 0,
                    losses: 0,
                    legsFor: 0,
                    legsAgainst: 0,
                    legDiff: 0,
                    points: 0,
                });
            }
            if (!table.has(bId)) {
                table.set(bId, {
                    discordUserId: bId,
                    name: bId,
                    played: 0,
                    totalMatches: 0,
                    wins: 0,
                    losses: 0,
                    legsFor: 0,
                    legsAgainst: 0,
                    legDiff: 0,
                    points: 0,
                });
            }

            const A = table.get(aId);
            const B = table.get(bId);

            A.played += 1;
            B.played += 1;

            A.legsFor += legsA;
            A.legsAgainst += legsB;

            B.legsFor += legsB;
            B.legsAgainst += legsA;

            const aWon = legsA > legsB;
            const bWon = legsB > legsA;

            // your points system: 1 per leg +2 for win
            if (aWon) {
                A.wins += 1;
                B.losses += 1;
                A.points += legsA + 2;
                B.points += legsB;
            } else if (bWon) {
                B.wins += 1;
                A.losses += 1;
                B.points += legsB + 2;
                A.points += legsA;
            } else {
                A.points += legsA;
                B.points += legsB;
            }
        }

        const playerAverages =
            await this.getPlayerAveragesFromConfirmed(confirmed);
        const rows = [...table.values()].map((r) => ({
            ...r,
            legDiff: r.legsFor - r.legsAgainst,
            average: playerAverages.get(r.discordUserId) ?? null,
        }));

        sortStandingsRows(rows);

        return { season, standings: rows };
    }
}
