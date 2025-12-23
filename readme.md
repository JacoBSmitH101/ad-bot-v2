## Overview

Discord-only darts league bot. Node.js (ESM) + Discord slash commands, backed by Supabase (PostgreSQL). Handles signups, divisions, scheduling, fixtures, results review, standings publishing, and Autodarts match links/stat lookups.

---

## Stack

-   Node 18+ (ESM)
-   discord.js v14
-   Supabase client (service role key)
-   Azure DevOps pipelines in `azure-pipelines/` install deps then restart the service (no build step)

---

## Running locally

1) Copy `.env.example` (or create `.env`) with values for the keys validated in `src/config/env.js`:
    -   `DISCORD_TOKEN`, `DISCORD_CLIENT_ID`, `GUILD_ID`
    -   `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, optional `SUPABASE_DB_SCHEMA`
    -   `INTERNAL_API_BASE_URL`, `INTERNAL_API_KEY` (used for match stats)
    -   optional `RESULTS_REVIEW_CHANNEL`, `ADMIN_USER_ID`, `ADMIN_ROLE_ID`
2) Install dependencies: `npm install`
3) Register commands + run the bot: `npm run dev`  
    (dev script registers slash commands then starts `src/index.js`)

---

## Deployment / Ops

-   Designed to run as a long-lived service (systemd or similar) pointing at the same code and environment variables used locally.
-   Pipelines simply pull, install, and restart; no Docker image is required.
-   On restart the bot refreshes any published signup embeds to stay in sync.

---
