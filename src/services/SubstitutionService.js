import { DomainError } from "../utils/DomainError.js";

/**
 * Service for substituting one player for another within a season/division.
 *
 * Supported modes:
 * - full_replace: replace outgoing with incoming everywhere (requires 0 confirmed matches)
 * - future_only: keep confirmed matches; swap only future/unconfirmed matches from effective_week onward
 */
export class SubstitutionService {
    /**
     * @param {{
     *   seasons: import("../repositories/SeasonRepository.js").SeasonRepository,
     *   divisions: import("../repositories/DivisionRepository.js").DivisionRepository,
     *   players: import("../repositories/PlayersRepository.js").PlayersRepository,
     *   matches: import("../repositories/MatchRepository.js").MatchRepository,
     *   substitutions: import("../repositories/PlayerSubstitutionsRepository.js").PlayerSubstitutionsRepository,
     * }} deps
     */
    constructor({ seasons, divisions, players, matches, substitutions }) {
        this.seasons = seasons;
        this.divisions = divisions;
        this.players = players;
        this.matches = matches;
        this.substitutions = substitutions;
    }

    /**
     * Substitute a player in a division.
     * @param {{
     *   guildId: string,
     *   divisionName: string,
     *   outDiscordUserId: string,
     *   inDiscordUserId: string,
     *   mode: ('full_replace'|'future_only'),
     *   effectiveWeek?: (number|null),
     *   createdBy?: (string|null),
     *   note?: (string|null),
     * }} params
     * @returns {Promise<{season: any, division: any, updatedMatches: number, rosterChanged: boolean, substitution: any}>}
     */
    async substitute({
        guildId,
        divisionName,
        outDiscordUserId,
        inDiscordUserId,
        mode,
        effectiveWeek = null,
        createdBy = null,
        note = null,
    }) {
        const season = await this.seasons.getCurrentForGuild(guildId);
        if (!season) throw new DomainError("NO_SEASON", "No season found.");

        if (outDiscordUserId === inDiscordUserId) {
            throw new DomainError(
                "BAD_SUBSTITUTION",
                "Outgoing and incoming players must be different."
            );
        }

        const division = await this.divisions.getBySeasonAndName(
            season.id,
            divisionName
        );
        if (!division) {
            throw new DomainError(
                "BAD_DIVISION",
                `Division not found: ${divisionName}`
            );
        }

        // Guard against swapping into an existing roster slot (would create self-matches / duplicates).
        const roster = await this.divisions.listDivisionPlayers(division.id);
        const outInRoster = roster.some(
            (r) => r.discord_user_id === outDiscordUserId
        );
        if (!outInRoster) {
            throw new DomainError(
                "NOT_IN_DIVISION",
                "Outgoing player is not in this division."
            );
        }
        const inAlreadyInRoster = roster.some(
            (r) => r.discord_user_id === inDiscordUserId
        );
        if (inAlreadyInRoster) {
            throw new DomainError(
                "IN_ALREADY_IN_DIVISION",
                "Incoming player is already in this division."
            );
        }

        if (mode !== "full_replace" && mode !== "future_only") {
            throw new DomainError("BAD_MODE", `Invalid mode: ${mode}`);
        }

        if (mode === "future_only") {
            if (!Number.isInteger(effectiveWeek) || effectiveWeek < 1) {
                throw new DomainError(
                    "BAD_WEEK",
                    "effective_week must be an integer >= 1 for future_only."
                );
            }
        } else {
            effectiveWeek = null;
        }

        // Ensure the incoming player exists.
        await this.players.upsert({
            discordUserId: inDiscordUserId,
            displayName: null,
        });

        if (mode === "full_replace") {
            const confirmedCt =
                await this.matches.countConfirmedForPlayerInDivision({
                    seasonId: season.id,
                    divisionId: division.id,
                    discordUserId: outDiscordUserId,
                });

            if (confirmedCt > 0) {
                throw new DomainError(
                    "HAS_CONFIRMED_MATCHES",
                    "Cannot full-replace a player who already has confirmed matches. Use future_only."
                );
            }
        }

        let rosterChanged = false;
        let updatedMatches = 0;

        if (mode === "full_replace") {
            const rosterUpdated = await this.divisions.replacePlayerInDivision({
                divisionId: division.id,
                outDiscordUserId,
                inDiscordUserId,
            });
            rosterChanged = rosterUpdated > 0;

            updatedMatches = await this.matches.replacePlayerInDivisionMatches({
                seasonId: season.id,
                divisionId: division.id,
                outDiscordUserId,
                inDiscordUserId,
                mode: "full_replace",
                effectiveWeek: null,
            });
        } else {
            await this.divisions.ensurePlayerInDivision({
                divisionId: division.id,
                discordUserId: inDiscordUserId,
            });
            rosterChanged = true;

            updatedMatches = await this.matches.replacePlayerInDivisionMatches({
                seasonId: season.id,
                divisionId: division.id,
                outDiscordUserId,
                inDiscordUserId,
                mode: "future_only",
                effectiveWeek,
            });
        }

        const substitution = await this.substitutions.create({
            seasonId: season.id,
            divisionId: division.id,
            outDiscordUserId,
            inDiscordUserId,
            mode,
            effectiveWeek,
            createdBy,
            note,
        });

        return { season, division, updatedMatches, rosterChanged, substitution };
    }
}

