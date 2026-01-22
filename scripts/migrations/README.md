# Database migrations

Run these in your Supabase SQL editor (Dashboard → SQL Editor) or via `psql`.

- **001_add_stats_columns_to_seasons.sql** — Adds `stats_channel_id` and `stats_message_id` to `seasons`. Fixes PGRST204: *"Could not find the 'stats_channel_id' column of 'seasons' in the schema cache"*. Required for `/statspublish` and stats leaders refresh after result confirm.
