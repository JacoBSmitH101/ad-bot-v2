# 3. League Specification (Discord-only MVP)

## Season Lifecycle

draft → signups_open → signups_closed → active → closed

Rules:

-   signups only in signups_open
-   scheduling only in signups_closed
-   results only count in active

---

## Signups

/signup avg:54.3

Rules:

-   one signup per player per season
-   avg updatable while open
-   validated numeric range

Auto-close via signups_close_at.

---

## Divisions

/divisions create count:3

Auto assignment by snake draft using averages.

---

## Scheduling

-   Round robin per division
-   Proposed then approved
-   Written to matches

---

## Weekly Matches

Posted to weekly channel:
Div 1 – Week 3
@A vs @B

Players arrange matches in division channels.

---

## Results

/result @A 4-2 @B

-   order-insensitive
-   opponent/admin confirms
-   only confirmed results count

---

## Standings

Derived from confirmed matches.

---
