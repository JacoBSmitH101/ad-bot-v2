# AD Bot v2

Discord-only darts league bot. Node.js (ESM) + Discord slash commands, backed by Supabase (PostgreSQL). Handles signups, divisions, scheduling, fixtures, results review, standings publishing, and Autodarts match links/stat lookups.

---

## Stack

-   Node 18+ (ESM)
-   discord.js v14
-   Supabase client (service role key)
-   Azure DevOps pipelines in `azure-pipelines/` install deps then restart the service (no build step)

---

## Prerequisites

-   Node.js 18 or higher
-   A Discord bot application (get token from [Discord Developer Portal](https://discord.com/developers/applications))
-   A Supabase project with the required database schema (see [Database Setup](#database-setup))
-   An internal API for Autodarts integration (optional, but required for match stats)

---

## Running Locally

### 1. Clone and Install

```bash
git clone <repository-url>
cd ad-bot-v2
npm install
```

### 2. Environment Setup

Copy `.env.example` to `.env` and fill in your values:

```bash
cp .env.example .env
```

**Required Environment Variables:**

-   `DISCORD_TOKEN` - Your Discord bot token
-   `DISCORD_CLIENT_ID` - Your Discord application client ID
-   `GUILD_ID` - Your Discord server (guild) ID
-   `SUPABASE_URL` - Your Supabase project URL
-   `SUPABASE_SERVICE_ROLE_KEY` - Your Supabase service role key (not anon key)
-   `INTERNAL_API_BASE_URL` - Base URL for internal API (Autodarts integration)
-   `INTERNAL_API_KEY` - API key for internal API

**Optional Environment Variables:**

-   `SUPABASE_DB_SCHEMA` - Database schema name (defaults to `public`)
-   `RESULTS_REVIEW_CHANNEL` - Discord channel ID for result verification notifications
-   `ADMIN_USER_ID` - Single admin Discord user ID
-   `ADMIN_ROLE_ID` - Admin Discord role ID
-   `ADMIN_USER_IDS` - Comma-separated list of admin user IDs
-   `TZ` - Timezone for date/time formatting (e.g., `America/New_York`, `Europe/London`)

See `.env.example` for a complete template.

### 3. Database Setup

The bot requires a Supabase PostgreSQL database with the following tables. See `docs/basicdb.md` for the complete schema documentation.

**Core Tables:**
-   `seasons` - Season lifecycle and configuration
-   `players` - Player information
-   `signups` - Season signups with averages
-   `divisions` - Division definitions per season
-   `division_players` - Player assignments to divisions
-   `schedule_proposals` - Schedule proposals before approval
-   `matches` - Match fixtures and status
-   `match_results` - Match result scores and proof URLs

**Setup Options:**

1.  **Manual Setup**: Create tables manually using the schema documented in `docs/basicdb.md`
2.  **Supabase SQL Editor**: Run SQL migrations in the Supabase dashboard
3.  **Migration Files**: (Future) Use migration files if a migration system is added

Ensure your Supabase service role key has full access to these tables.

### 4. Register Commands and Run

```bash
npm run dev
```

This will:
1.  Register all slash commands with Discord
2.  Start the bot and connect to Discord

The bot will automatically refresh published signup embeds on startup to keep them in sync.

---

## Development

### Project Structure

```
src/
├── config/          # Environment configuration
├── db/             # Database client setup
├── discord/
│   ├── commands/   # Slash command handlers
│   └── handlers/   # Button interaction handlers
├── repositories/   # Data access layer (Supabase)
├── services/       # Business logic layer
└── utils/          # Utility functions and errors
```

### Available Scripts

-   `npm run dev` - Register commands and start bot
-   `npm run docs` - Generate JSDoc documentation
-   `npm run seed:fake` - Seed fake signups for testing

### Documentation

-   `docs/architecture.md` - System architecture overview
-   `docs/basicdb.md` - Database schema documentation
-   `docs/commands.md` - Complete command reference
-   `docs/league.md` - League specification and workflow
-   `docs/api/` - Generated JSDoc API documentation (run `npm run docs`)

---

## Deployment

See `docs/DEPLOYMENT.md` for detailed deployment instructions.

**Quick Summary:**
-   Designed to run as a long-lived service (systemd or similar)
-   Azure DevOps pipelines handle deployment
-   No Docker image required
-   Environment variables must be configured on the server
-   Bot automatically refreshes published messages on restart

---

## Troubleshooting

### Bot Not Responding to Commands

1.  Check that commands are registered: Commands must be registered with Discord before they appear. Run `npm run dev` or use `scripts/registerCommands.js`.
2.  Verify bot has proper permissions in Discord server
3.  Check bot is online in Discord
4.  Review console logs for errors

### Database Connection Issues

1.  Verify `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are correct
2.  Check Supabase project is active and accessible
3.  Verify service role key has proper permissions
4.  Check `SUPABASE_DB_SCHEMA` matches your schema name

### Command Errors

-   Most errors are caught and displayed to users as ephemeral messages
-   Check server console logs for detailed error information
-   Review `docs/commands.md` for command usage and requirements

### Published Messages Not Updating

-   Published messages are refreshed automatically on bot restart
-   Manual refresh: Use `/signups publish`, `/standingspublish`, or `/fixturespublish` commands
-   If messages are deleted, republish them using the appropriate commands

---

## Environment Variables Reference

| Variable                  | Required | Description                                    |
| ------------------------- | --------- | ---------------------------------------------- |
| `DISCORD_TOKEN`           | Yes       | Discord bot token                              |
| `DISCORD_CLIENT_ID`       | Yes       | Discord application client ID                  |
| `GUILD_ID`                | Yes       | Discord server (guild) ID                     |
| `SUPABASE_URL`            | Yes       | Supabase project URL                           |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes    | Supabase service role key                     |
| `INTERNAL_API_BASE_URL`   | Yes       | Internal API base URL                          |
| `INTERNAL_API_KEY`        | Yes       | Internal API authentication key                |
| `SUPABASE_DB_SCHEMA`      | No        | Database schema name (default: `public`)       |
| `RESULTS_REVIEW_CHANNEL`  | No        | Channel ID for result verification             |
| `ADMIN_USER_ID`           | No        | Single admin user ID                           |
| `ADMIN_ROLE_ID`           | No        | Admin role ID                                  |
| `ADMIN_USER_IDS`          | No        | Comma-separated admin user IDs                 |
| `TZ`                      | No        | Timezone (e.g., `America/New_York`)           |

---

## Contributing

1.  Follow the existing code structure (repositories → services → commands)
2.  Add JSDoc documentation for all new functions
3.  Use `DomainError` for business logic errors
4.  Test commands locally before deploying

---

## License

ISC
