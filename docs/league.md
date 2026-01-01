# League Specification (as implemented)

## Season Lifecycle

`draft` → `signups_open` → `signups_closed` → `active` → `closed`

-   Opening signups optionally sets `signups_close_at`.
-   `startSeason` requires an approved schedule (matches exist) and moves to `active`, setting `started_at/current_week`.

---

## Signups

`/signup avg:54.3`

-   One row per player per season (upsert allowed while open).
-   Average is rounded to 1 decimal, must be 10.0–120.0.
-   `/dropout` only works while `signups_open`.
-   If `signups_close_at` is in the past, signup attempts are blocked (status is not auto-flipped).
-   `/signups` publishes an embed to a configured channel and auto-refreshes on change.

---

## Divisions

`/divisions create count:3`

-   Allowed only once signups are closed.
-   Minimum 7 players per division; at most 10 divisions.
-   Auto assignment sorts by average high → low and chunks evenly (not snake draft).

---

## Scheduling

-   `/schedule propose` builds a round-robin per division and stores a JSON proposal.
-   `/schedule approve` wipes existing matches, inserts new `scheduled` matches, and is required before the season can start.
-   `/schedule preview` inspects a specific division/week from the latest proposal.

---

## Weekly Fixtures

-   `/fixtures publish [week]` posts the week embed and stores channel/message/target week.
-   `/fixtures setweek` updates the stored week and re-renders.
-   Shows status icons: 🗓️ scheduled, 🟠 reported, 🟢 confirmed.

---

## Results

`/result @A 4-2 @B url:<autodarts link>`

-   Autodarts match URL is required.
-   Finds the best matching scheduled/reported/disputed match between the two players.
-   Marks the match as `reported`, stores score + proof URL, and sends an admin review message with buttons.
-   Admins (via configured user/role) confirm/reject via buttons; confirm sets `confirmed` and refreshes standings/fixtures.
-   `void`/`reset` admin commands clear results or status when needed.

---

## Standings

-   Computed from confirmed matches per division.
-   `/standings publish` posts one message per division; `/standings refresh` auto-runs after confirmations.
-   Movement lines included when a confirmation supplies before/after context.

---
