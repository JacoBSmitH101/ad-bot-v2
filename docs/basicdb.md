# 4. Database Design (v2 MVP)

## Core Tables

seasons:

-   id
-   guild_id
-   name
-   status
-   signups_close_at
-   signups_channel_id
-   weekly_channel_id
-   created_at
-   updated_at

signups:

-   season_id
-   discord_user_id
-   avg_3dart
-   created_at
-   updated_at

divisions:

-   id
-   season_id
-   name
-   sort_order
-   channel_id
-   created_at
-   updated_at

division_players:

-   division_id
-   discord_user_id
-   seed_avg
-   joined_at

matches:

-   id
-   season_id
-   division_id
-   week
-   player_a_id
-   player_b_id
-   status
-   reported_at
-   confirmed_at
-   disputed_at
-   created_at
-   updated_at

match_results:

-   match_id
-   legs_a
-   legs_b
-   created_at
-   updated_at

---

## Stored vs Derived

Stored:

-   scorelines
-   statuses
-   timestamps

Derived:

-   standings
-   stats
-   form

---
