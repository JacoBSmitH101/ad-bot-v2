# Availability rollout

The real system is implemented in the local bot code. The database migration has been tested locally against PostgreSQL, but has **not** been applied to Supabase and the code has **not** been deployed to the live bot.

## 1. Run the matching SQL file

Check the running bot's `SUPABASE_DB_SCHEMA` setting:

- `public`: run **scripts/migrations/002_league_availability_public.sql** in Supabase Dashboard → SQL Editor.
- `dev`: run **scripts/migrations/002_league_availability_dev.sql** instead. Your current local `.env` uses `dev`.

Run the whole matching file, not only its CREATE TABLE statements. The functions are required for atomic reply updates, extension approvals and message delivery leases. Each file creates four small tables: fixture releases, match availability, DM delivery records and change history. It does not change scores, points or match results. It supports UUID or numeric existing match IDs.

The migration restricts these tables/functions to the bot's server-side `service_role`, with RLS enabled and no access for anonymous or ordinary authenticated web clients. Do not put the service-role key in a website or player-facing application. See [Supabase database functions](https://supabase.com/docs/guides/database/functions) and [RLS documentation](https://supabase.com/docs/guides/database/postgres/row-level-security).

## 2. Configure and deploy the bot

After the SQL succeeds, add to the **running bot's** environment:

```env
AVAILABILITY_ENABLED=true
AVAILABILITY_REVIEW_CHANNEL=YOUR_PRIVATE_ADMIN_CHANNEL_ID
```

The review channel is optional. If absent/blank, the bot uses `RESULTS_REVIEW_CHANNEL`. If neither is configured, requests remain available through `/availability-admin` without posting channel notifications. Channel notices contain only match/request information, not hidden availability notes.

Deploy the changed code, install dependencies using the project's normal deployment process, re-register slash commands, and restart the bot. The flag defaults to `false` so deploying code before installing SQL does not start sending availability messages.

## 3. Release week 1

- Start the season normally with `/season start` after approving its schedule.
- Publish the fixtures with `/fixturespublish week:1`. Once the season is active, this also creates the saved availability records and DMs both players in each open fixture.
- If fixtures were already published before `/season start`, starting the season releases availability for that published week.
- If the season is already active and its fixture message already exists, run `/fixturesweek week:1` to release availability without posting another set of public fixture graphics.
- Later, `/fixturesweek week:2`, etc., releases that week's availability.

Normal refreshes after results do not release DMs. Releasing the same week preserves its original date and existing answers, and edits the stored DMs rather than deliberately sending new copies. A deleted DM can be replaced. Delivery leases and Discord nonces also reduce duplicate sends during retries; Discord and PostgreSQL do not share a transaction, so an exceptional crash between sending and recording a message still has a best-effort recovery window.

## Player experience

- Real opponent, week, and a day/date play-by deadline.
- “Yes, I can play”: optional dated tick boxes and a note. “Edit my days” restores current choices.
- “No, I can’t play”: optional reason. Absence reasons are shown only to the player and admins, not to the opponent.
- Opponent availability, chosen days and their available-note are hidden until both answer. Once revealed they stay visible after edits.
- Choosing days does not book a match: players still contact one another to agree a time.
- No holiday feature, automatic forfeits, wins or disqualifications.
- A single reminder is sent after 48 hours if a player has not answered. It stops once answered or once the play-by date passes.
- `/availability` returns a private real match card in the server, including when DMs are closed. Optional `week` opens an earlier released week.
- `/availability-test` remains a separate, temporary practice match. Its sample answers never change real availability.

## Extra time

The standard date is the Sunday **after** fixture release. A Sunday release gets seven days. The extra week ends the following Sunday; there is no time displayed.

- A first request made and agreed before/on the original date is approved after the opponent agrees.
- Pending requests do not change the date. Silence is not approval.
- A refusal, request for help, late request, or request after an admin refusal goes to admin review.
- Admins can approve or keep the current date. An admin approval cannot create a date after the one extra week has already passed.
- Each fixture can receive this one-week extension only once. Further exceptions require manual league management.
- Approved extra time removes the fixture from overdue displays until its new date. Result submission/verification stays under the existing league process; these dates do not automatically award or reject results.

## Admin commands

```text
/availability-admin action:status
/availability-admin action:status week:1
/availability-admin action:approve match:MATCH_ID
/availability-admin action:keep match:MATCH_ID
/availability-admin action:history match:MATCH_ID
/availability-admin action:retry week:1
```

The status view includes unanswered players, private notes, extension state, match IDs and failed DMs. It is restricted to the configured league admin user/role or a server administrator. Retry updates existing DMs and retries failures. Failed sends retry in the background at intervals, within the active play-by period; restarting resumes stored work rather than losing answers.

After substitutions, re-release the affected week. The bot resets replies for changed pairings, rejects old participants' interactions, preserves the week's original date, and contacts the current players.

## First live check

After migration/deployment, confirm two players receive their real week-1 cards. Check that the first reply stays hidden, the second reveals both, editing days updates the opponent's DM, and `/availability` works for a player with DMs closed. Try one mutually agreed extension and check both dates. Confirm admin status and its private review channel. These Discord/Supabase live checks have not been performed by this task.

For rollback, set `AVAILABILITY_ENABLED=false` and restart. Keep the tables so recorded answers and history are preserved; the rest of the league bot continues to operate.

## Verification

120 automated checks passed, including PostgreSQL migration/workflow tests for both `public` and `dev`, UUID/numeric match IDs, repeated releases, reveal behavior, authorization, extension decisions, substitutions, reminder leases, delivery retries and overdue filtering.
