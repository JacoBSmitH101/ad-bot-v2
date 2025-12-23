# Architecture

## Layers (actual)

Discord commands / button handlers  
↓ call  
Services (domain + orchestration)  
↓ call  
Repositories (Supabase access)  
↓  
Supabase (PostgreSQL)

`src/index.js` wires a single Supabase client and instantiates repositories + services once, then registers slash commands dynamically from `src/discord/commands`.

---

## Discord Entrypoints

-   Slash commands in `src/discord/commands/*` handle parsing, ephemeral errors, and embed formatting.
-   Button handlers in `src/discord/handlers/*` gate admin actions (results + standings) and call services.
-   Command modules never import Supabase directly; they rely on `interaction.client.services` / `interaction.client.repos`.

---

## Services

-   SeasonService: lifecycle guards (open/close signups, start/close season).
-   SignupService: validation, rounding, dropout, and player upserts.
-   DivisionService: min/max division rules, auto assignment by average.
-   ScheduleService: proposal/approval pipeline and match creation.
-   MatchesService: player-facing match views/unreported lookups.
-   ResultService: score validation, match selection, report/confirm/reject/reset/void flows.
-   Publisher services: signups, fixtures, standings embeds with stored message/channel ids.
-   StandingsService/MatchStatsService/ResultsNotifierService provide derived data + external stats fetch.

Services do not know Discord types; they receive ids/strings and throw DomainError on violations.

---

## Repositories

Thin Supabase wrappers per table:

-   Seasons, Players, Signups, Divisions (+division_players), ScheduleProposals, Matches, MatchResults.
-   Responsible only for SQL-like reads/writes and small convenience ordering/filtering.

---

## Config / Environment

-   `.env` validated by `src/config/env.js` (Discord IDs/tokens, Supabase URL/service key, optional admin ids/roles, internal API for stats).
-   Optional `SUPABASE_DB_SCHEMA` to target a non-public schema.

---

## Notable Flows

-   Startup: ping Supabase, load commands, refresh published signups for each guild.
-   Confirmation buttons: confirm → refresh standings embed (with movement), update fixtures.
-   Publish flows remember channel/message ids so embeds can be refreshed on restart.

---
