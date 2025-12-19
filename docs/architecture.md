# 2. Architecture (Code Structure)

## Layered Design

Discord Commands
↓
Domain / Services (business rules)
↓
Repositories (DB access)
↓
Database

---

## Discord Commands

Responsibilities:

-   parse slash commands
-   handle button interactions
-   permission checks
-   format embeds/messages

Commands do not:

-   enforce league rules
-   talk to the database
-   generate schedules

---

## Services (Domain Logic)

Services enforce:

-   season lifecycle
-   signup rules
-   division assignment
-   scheduling
-   result confirmation
-   standings calculation

Examples:

-   SeasonService
-   DivisionService
-   ScheduleService
-   MatchService
-   StandingsService

---

## Repositories

Repositories:

-   read/write database rows
-   contain no business logic

---

## Database Client (db)

-   Single shared client
-   Created once at startup
-   Used only by repositories

---

## Object Lifecycle

At startup:
const seasonRepo = new SeasonRepository(db);
const seasonService = new SeasonService(seasonRepo);

---

## Golden Rules

1. Commands never contain business logic
2. Services never contain Discord or SQL
3. Repositories never contain rules
4. DB client is created once
5. State transitions live in one place

---
