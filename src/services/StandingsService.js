// src/services/StandingsService.js
import { DomainError } from "../utils/DomainError.js";

export class StandingsService {
    /**
     * @param {{ seasons: any, divisions: any, divisionPlayers: any, matches: any }} deps
     */
    constructor({ seasons, divisions, divisionPlayers, matches }) {
        this.seasons = seasons;
        this.divisions = divisions;
        this.divisionPlayers = divisionPlayers;
        this.matches = matches;
    }

    async getStandingsForCurrentSeason({ guildId }) {
        const season = await this.seasons.getCurrentForGuild(guildId);
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
                    wins: 0,
                    losses: 0,
                    legsFor: 0,
                    legsAgainst: 0,
                    legDiff: 0,
                    points: 0,
                });
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

            // compute leg diff + sort
            const rows = [...table.values()].map((r) => ({
                ...r,
                legDiff: r.legsFor - r.legsAgainst,
            }));

            rows.sort((x, y) => {
                // points desc
                if (y.points !== x.points) return y.points - x.points;
                // leg diff desc
                if (y.legDiff !== x.legDiff) return y.legDiff - x.legDiff;
                // legs for desc
                if (y.legsFor !== x.legsFor) return y.legsFor - x.legsFor;
                // name asc
                return String(x.name).localeCompare(String(y.name));
            });

            out.push({
                division: div,
                standings: rows,
            });
        }

        return { season, divisions: out };
    }
    // Add inside StandingsService class
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
                wins: 0,
                losses: 0,
                legsFor: 0,
                legsAgainst: 0,
                legDiff: 0,
                points: 0,
            });
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

        const rows = [...table.values()].map((r) => ({
            ...r,
            legDiff: r.legsFor - r.legsAgainst,
        }));

        rows.sort((x, y) => {
            if (y.points !== x.points) return y.points - x.points;
            if (y.legDiff !== x.legDiff) return y.legDiff - x.legDiff;
            if (y.legsFor !== x.legsFor) return y.legsFor - x.legsFor;
            return String(x.name).localeCompare(String(y.name));
        });

        return { season, standings: rows };
    }
}
