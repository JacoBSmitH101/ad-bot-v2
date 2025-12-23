# Discord Commands Reference

This document provides an overview of all Discord slash commands available in the bot.

## Player Commands

### `/signup`
**Usage:** Sign up for the current season with your 3-dart average.

**Description:** Allows players to register for the current season. Requires signups to be open. If you've already signed up, this updates your average. Automatically refreshes the published signup list.

**Parameters:**
- `avg` (required): Your 3-dart average

**Restrictions:** Must be used in the designated signups channel if one is configured.

---

### `/dropout`
**Usage:** Unregister from the current season.

**Description:** Removes your signup from the current season. Only works when signups are open. Automatically refreshes the published signup list.

**Restrictions:** Must be used in the designated signups channel if one is configured.

---

### `/mymatches`
**Usage:** View all your matches for the current season.

**Description:** Displays all your scheduled matches grouped by week. Shows match status (scheduled, reported, confirmed) and opponent information. Includes indicators for "next up" matches.

**Response:** Ephemeral message with embeds showing matches by week.

---

### `/result`
**Usage:** Submit a match result for admin verification.

**Description:** Submit the result of a completed match. Requires an Autodarts match URL as proof. The result will be pending until an admin confirms or rejects it.

**Parameters:**
- `opponent` (required): Your opponent (Discord user)
- `you` (required): Legs you won
- `them` (required): Legs opponent won
- `url` (required): Autodarts match proof URL

**Restrictions:** Only works for active seasons. Match must exist and be in "scheduled" status.

---

### `/standings`
**Usage:** View current season standings.

**Description:** Displays division standings for the current season. Shows only confirmed results. Summary view shows top players with points. Full view includes detailed stats (wins, losses, legs, etc.).

**Parameters:**
- `view` (optional): "summary" (default) or "full"

**Response:** Ephemeral message with embeds. Summary view includes interactive buttons.

---

## Admin Commands

### `/ping`
**Usage:** Simple test command.

**Description:** Replies with "pong". Admin only. Used for testing bot responsiveness.

---

### `/season`
**Usage:** Manage season lifecycle.

**Description:** Admin-only command group for creating and managing seasons.

**Subcommands:**
- `create`: Create a new season (starts in "draft" status)
  - `name` (required): Season name
- `signups-open`: Open signups for the current season
  - `close_at` (optional): ISO timestamp for auto-closing signups
- `signups-close`: Close signups for the current season
- `start`: Start the season (move to "active" status, requires approved schedule)

---

### `/season-close`
**Usage:** Close the current season.

**Description:** Locks the season, preventing further changes. Refreshes standings and fixtures after closing.

---

### `/signups`
**Usage:** Admin tools for managing signup displays.

**Description:** Command group for viewing and publishing signup lists.

**Subcommands:**
- `list`: Display all signups for the current season
- `publish`: Publish/refresh the signup list message in the current channel

---

### `/divisions`
**Usage:** Manage divisions and player assignments.

**Description:** Admin-only command group for creating divisions and assigning players.

**Subcommands:**
- `create`: Create divisions for the current season
  - `count` (required): Number of divisions to create
  - Requires signups to be closed
- `assign-auto`: Automatically assign players to divisions by average (Div 1 = strongest)

---

### `/division`
**Usage:** View division information.

**Description:** Admin-only command to view divisions and their assigned players.

**Subcommands:**
- `list`: List all players in each division with their seed averages

---

### `/schedule`
**Usage:** Manage match schedules.

**Description:** Admin-only command group for generating, approving, and previewing schedules.

**Subcommands:**
- `propose`: Generate a round-robin schedule proposal for all divisions
- `approve`: Approve the latest schedule proposal and create all matches
- `preview`: Preview matches for a specific division and week
  - `division` (required): Division name (e.g., "Div 1")
  - `week` (required): Week number

---

### `/fixturespublish`
**Usage:** Publish weekly fixtures in a channel.

**Description:** Creates an embed showing scheduled matches for a specific week. The message can be automatically refreshed when results change.

**Parameters:**
- `week` (optional): Week number to display (defaults to current week or 1)

**Restrictions:** Admin only. Must be run in the channel where you want fixtures displayed.

---

### `/fixturesweek`
**Usage:** Change which week the fixtures message displays.

**Description:** Updates the season's fixtures_week field and refreshes the published fixtures message.

**Parameters:**
- `week` (required): Week number to display

**Restrictions:** Admin only.

---

### `/standingspublish`
**Usage:** Publish standings in a channel.

**Description:** Creates embeds showing standings for all divisions. One message per division. Messages are automatically refreshed when results change.

**Restrictions:** Admin only. Must be run in the channel where you want standings displayed.

---

### `/match-reset`
**Usage:** Reset a match back to scheduled status.

**Description:** Resets a match to "scheduled" status and deletes its result. Optionally clears stored result message references. Refreshes standings and fixtures after reset.

**Parameters:**
- `match_id` (required): Match UUID
- `clear_message_link` (optional): Also clear stored result message IDs

**Restrictions:** Admin only.

---

### `/match-void`
**Usage:** Void a match (no points awarded).

**Description:** Sets a match to "void" status and deletes its result. No points are awarded to either player. Optionally clears stored result message references. Refreshes standings and fixtures after voiding.

**Parameters:**
- `match_id` (required): Match UUID
- `clear_message_link` (optional): Also clear stored result message IDs

**Restrictions:** Admin only.

---

### `/result-edit`
**Usage:** Edit a match result.

**Description:** Admin-only command to manually edit the stored result (legs A and B) for a match. Optionally updates the proof URL. Refreshes standings and fixtures after editing.

**Parameters:**
- `match_id` (required): Match UUID
- `legs_a` (required): Legs for player A
- `legs_b` (required): Legs for player B
- `url` (optional): Proof URL

**Restrictions:** Admin only.

---

### `/unreported_before_week`
**Usage:** Find unreported matches from earlier weeks.

**Description:** Displays matches from weeks before the specified week that haven't been reported or confirmed. Useful for identifying overdue matches.

**Parameters:**
- `week` (required): Show matches from weeks before this number (must be > 1)

**Restrictions:** Admin only.

---

## Autodarts Integration Commands

### `/autodarts-status`
**Usage:** View Autodarts authentication status.

**Description:** Displays connection status, last refresh time, token expiry, errors, and queue size for the Autodarts integration.

**Restrictions:** Admin only.

---

### `/autodarts-set-token`
**Usage:** Set the Autodarts refresh token.

**Description:** Sets the refresh token on the internal API. The bot never stores or logs the token. Response is always ephemeral for security.

**Parameters:**
- `refresh_token` (required): Autodarts refresh token

**Restrictions:** Admin only.

---

### `/autodarts-refresh`
**Usage:** Force refresh Autodarts access token.

**Description:** Triggers a refresh of the Autodarts access token through the internal API. Used for troubleshooting authentication issues.

**Restrictions:** Admin only.

---

## Development Commands

### `/resultdev`
**Usage:** Submit a result against a fake player (dev only).

**Description:** Development-only command to submit results against fake player IDs (e.g., FAKE_001). Only available in non-production environments. Used for testing.

**Parameters:**
- `opponent_id` (required): Fake player Discord user ID (e.g., FAKE_001)
- `you` (required): Legs you won
- `them` (required): Legs opponent won
- `url` (required): Autodarts match proof URL

**Restrictions:** Admin only. Not available in production.

---

## Command Categories Summary

### Player-Facing Commands
- `/signup` - Register for season
- `/dropout` - Unregister from season
- `/mymatches` - View your matches
- `/result` - Submit match result
- `/standings` - View standings

### Season Management
- `/season` - Create and manage seasons
- `/season-close` - Close season
- `/signups` - Manage signup displays
- `/divisions` - Create and assign divisions
- `/division` - View divisions
- `/schedule` - Generate and approve schedules

### Publishing & Display
- `/fixturespublish` - Publish fixtures
- `/fixturesweek` - Change fixtures week
- `/standingspublish` - Publish standings

### Match Management
- `/match-reset` - Reset match
- `/match-void` - Void match
- `/result-edit` - Edit result
- `/unreported_before_week` - Find unreported matches

### Autodarts Integration
- `/autodarts-status` - View auth status
- `/autodarts-set-token` - Set refresh token
- `/autodarts-refresh` - Refresh token

### Development
- `/resultdev` - Test with fake players
- `/ping` - Test command

