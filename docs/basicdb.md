# Database (current schema – Supabase)

## Core Tables

`seasons`

-   id
-   guild_id
-   name
-   status (`draft` | `signups_open` | `signups_closed` | `active` | `closed`)
-   signups_close_at
-   signups_channel_id
-   signups_message_id
-   standings_channel_id
-   standings_message_ids (json map `division:{id}` → message id)
-   fixtures_channel_id
-   fixtures_message_id
-   fixtures_week
-   started_at
-   current_week
-   created_at
-   updated_at

`players`

-   discord_user_id (PK)
-   display_name
-   created_at
-   updated_at

`signups`

-   season_id (FK seasons.id)
-   discord_user_id (FK players.discord_user_id)
-   avg_3dart
-   created_at
-   updated_at

`divisions`

-   id
-   season_id
-   name (`Div 1`, `Div 2`, …)
-   sort_order
-   channel_id
-   created_at
-   updated_at

`division_players`

-   division_id
-   discord_user_id
-   seed_avg
-   seed_rank
-   created_at
-   updated_at

`schedule_proposals`

-   id
-   season_id
-   created_by
-   payload (json: divisions + weeks)
-   status (`proposed` | `approved`)
-   created_at
-   updated_at

`matches`

-   id
-   season_id
-   division_id
-   week
-   player_a_id
-   player_b_id
-   status (`scheduled` | `reported` | `confirmed` | `disputed` | `void`)
-   reported_by
-   reported_at
-   confirmed_by
-   confirmed_at
-   disputed_at
-   result_channel_id
-   result_message_id
-   created_at
-   updated_at

`match_results`

-   match_id
-   legs_a
-   legs_b
-   proof_url
-   created_at
-   updated_at

---

## Stored vs Derived

Stored:

-   scorelines (`match_results`)
-   match state (`matches.status` + audit columns)
-   publish targets (channel/message ids)
-   timestamps / scheduling proposals

Derived:

-   standings (from confirmed matches + division membership)
-   fixture/standing embeds
-   stats pulled from Autodarts links

---
