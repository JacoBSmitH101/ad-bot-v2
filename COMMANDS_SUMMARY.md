# Discord Bot Commands Summary

## Player Commands (Public)

### `/signup`
- **What it does:** Register for the current season with your 3-dart average
- **Parameters:** `avg` (required) - Your 3-dart average (must be between 10.0-120.0)
- **Notes:** 
  - Can be used to update your average if you've already signed up
  - Must be used in the designated signups channel if one is configured
  - Only works when signups are open
  - Automatically updates the published signup list

### `/dropout`
- **What it does:** Remove yourself from the current season
- **Notes:**
  - Only works when signups are open
  - Must be used in the designated signups channel if one is configured
  - Automatically updates the published signup list

### `/mymatches`
- **What it does:** View all your scheduled matches for the current season, grouped by week
- **Shows:** Match status (scheduled 🗓️, reported 🟠, confirmed 🟢), opponent info, and "next up" indicators
- **Response:** Private message (ephemeral)

### `/result`
- **What it does:** Submit a match result for admin verification
- **Parameters:**
  - `opponent` (required) - Your opponent (Discord user)
  - `you` (required) - Legs you won
  - `them` (required) - Legs opponent won
  - `url` (required) - Autodarts match proof URL (must be valid Autodarts match link)
- **Notes:**
  - Result is pending until admin confirms/rejects
  - Only works for active seasons
  - Match must exist and be in "scheduled" status
  - Creates a public message that admins can verify

### `/standings`
- **What it does:** View current season standings
- **Parameters:** `view` (optional) - "summary" (default) or "full"
- **Shows:** Division standings with confirmed results only
  - Summary: Top players with points
  - Full: Detailed stats (wins, losses, legs, etc.)
- **Response:** Private message (ephemeral) with interactive buttons

---

## Admin Commands

### Season Management

#### `/season`
- **Subcommands:**
  - `create` - Create a new season (starts in "draft" status)
    - `name` (required) - Season name
  - `signups-open` - Open signups for current season
    - `close_at` (optional) - ISO timestamp for auto-closing signups
  - `signups-close` - Close signups for current season
  - `start` - Start the season (move to "active" status, requires approved schedule)

#### `/season-close`
- **What it does:** Close/lock the current season, preventing further changes
- **Notes:** Refreshes standings and fixtures after closing

#### `/signups`
- **Subcommands:**
  - `list` - Display all signups for current season
  - `publish` - Publish/refresh the signup list message in the current channel
    - Creates a new message that auto-updates when signups change
    - If a message already exists in a different channel, creates a new one (old one becomes orphaned)

### Division Management

#### `/divisions`
- **Subcommands:**
  - `create` - Create divisions for current season
    - `count` (required) - Number of divisions to create
    - Requires signups to be closed
  - `assign-auto` - Automatically assign players to divisions by average (Div 1 = strongest)

#### `/division`
- **Subcommands:**
  - `list` - List all players in each division with their seed averages

### Scheduling

#### `/schedule`
- **Subcommands:**
  - `propose` - Generate a round-robin schedule proposal for all divisions
  - `approve` - Approve the latest schedule proposal and create all matches
  - `preview` - Preview matches for a specific division and week
    - `division` (required) - Division name (e.g., "Div 1")
    - `week` (required) - Week number

### Publishing & Display

#### `/fixturespublish`
- **What it does:** Publish weekly fixtures in the current channel
- **Parameters:** `week` (optional) - Week number to display (defaults to current week or 1)
- **Notes:** Creates an embed that auto-refreshes when results change

#### `/fixturesweek`
- **What it does:** Change which week the fixtures message displays
- **Parameters:** `week` (required) - Week number to display
- **Notes:** Updates the season's fixtures_week and refreshes the published message

#### `/standingspublish`
- **What it does:** Publish standings in the current channel
- **Notes:** Creates one message per division that auto-refreshes when results change

### Match Management

#### `/match-reset`
- **What it does:** Reset a match back to "scheduled" status and delete its result
- **Parameters:**
  - `match_id` (required) - Match UUID
  - `clear_message_link` (optional) - Also clear stored result message IDs
- **Notes:** Refreshes standings and fixtures after reset

#### `/match-void`
- **What it does:** Void a match (no points awarded to either player)
- **Parameters:**
  - `match_id` (required) - Match UUID
  - `clear_message_link` (optional) - Also clear stored result message IDs
- **Notes:** Deletes result, refreshes standings and fixtures

#### `/result-edit`
- **What it does:** Manually edit a match result (legs and proof URL)
- **Parameters:**
  - `match_id` (required) - Match UUID
  - `legs_a` (required) - Legs for player A
  - `legs_b` (required) - Legs for player B
  - `url` (optional) - Proof URL
- **Notes:** Refreshes standings and fixtures after editing

#### `/unreported_before_week`
- **What it does:** Find unreported matches from weeks before the specified week
- **Parameters:** `week` (required) - Show matches from weeks before this number (must be > 1)
- **Notes:** Useful for identifying overdue matches

### Autodarts Integration

#### `/autodarts-status`
- **What it does:** View Autodarts authentication status
- **Shows:** Connection status, last refresh time, token expiry, errors, queue size

#### `/autodarts-set-token`
- **What it does:** Set the Autodarts refresh token on the internal API
- **Parameters:** `refresh_token` (required) - Autodarts refresh token
- **Notes:** Response is always ephemeral for security

#### `/autodarts-refresh`
- **What it does:** Force refresh Autodarts access token
- **Notes:** Used for troubleshooting authentication issues

### Utility

#### `/ping`
- **What it does:** Simple test command (replies with "pong")

#### `/resultdev`
- **What it does:** Submit a result against a fake player (dev/testing only)
- **Parameters:**
  - `opponent_id` (required) - Fake player Discord user ID (e.g., FAKE_001)
  - `you` (required) - Legs you won
  - `them` (required) - Legs opponent won
  - `url` (required) - Autodarts match proof URL
- **Notes:** Not available in production

---

## Quick Reference for User Updates

### Signup Process
1. Admin opens signups with `/season signups-open`
2. Players use `/signup avg:<number>` in the designated channel
3. Admin can view signups with `/signups list`
4. Admin can publish signup list with `/signups publish` (creates auto-updating message)
5. Players can update their average by using `/signup` again
6. Players can remove themselves with `/dropout` (only while signups open)

### Match Reporting Process
1. Players view their matches with `/mymatches`
2. After playing, players submit results with `/result` (requires Autodarts match URL)
3. Result is pending until admin verifies
4. Once confirmed, standings and fixtures auto-update

### Viewing Information
- `/standings` - View current standings (private)
- `/mymatches` - View your matches (private)
- Published messages in channels show signups, fixtures, and standings (public, auto-updating)

