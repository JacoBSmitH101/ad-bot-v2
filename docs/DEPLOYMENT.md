# Deployment Runbook

This document provides step-by-step instructions for deploying the AD Bot v2 to production.

---

## Prerequisites

-   Server/VM with Node.js 18+ installed
-   Systemd or similar process manager
-   Access to Azure DevOps (if using CI/CD pipelines)
-   Discord bot token and application credentials
-   Supabase project with database schema set up
-   Internal API credentials (for Autodarts integration)

---

## Pre-Deployment Checklist

-   [ ] Database schema is created and up-to-date (see `docs/basicdb.md`)
-   [ ] All environment variables are documented and ready
-   [ ] Discord bot application is created and configured
-   [ ] Bot has proper permissions in Discord server
-   [ ] Supabase project is configured with service role key
-   [ ] Internal API is accessible from deployment server

---

## Deployment Methods

### Method 1: Azure DevOps Pipelines (Recommended)

The project includes Azure DevOps pipeline configurations in `azure-pipelines/`.

#### Setup

1.  **Configure Pipeline Variables**

    In Azure DevOps, add the following pipeline variables (mark sensitive ones as secret):

    -   `DISCORD_TOKEN` (secret)
    -   `DISCORD_CLIENT_ID`
    -   `GUILD_ID`
    -   `SUPABASE_URL`
    -   `SUPABASE_SERVICE_ROLE_KEY` (secret)
    -   `INTERNAL_API_BASE_URL`
    -   `INTERNAL_API_KEY` (secret)
    -   `SUPABASE_DB_SCHEMA` (optional)
    -   `RESULTS_REVIEW_CHANNEL` (optional)
    -   `ADMIN_USER_ID` (optional)
    -   `ADMIN_ROLE_ID` (optional)
    -   `ADMIN_USER_IDS` (optional)
    -   `TZ` (optional)

2.  **Configure Pipeline**

    -   Point pipeline to `azure-pipelines/prod.yml` (or `dev.yml` for dev environment)
    -   Configure deployment target (server SSH details, etc.)
    -   Ensure pipeline has access to deployment server

3.  **Deploy**

    -   Push to main branch (or trigger pipeline manually)
    -   Pipeline will:
        1.  Pull latest code
        2.  Install dependencies (`npm install`)
        3.  Register Discord commands
        4.  Restart the service

#### Pipeline Configuration

The pipeline assumes:

-   Code is cloned to a specific directory on the server
-   A systemd service is configured (see Method 2)
-   Service name is `ad-bot-v2` (adjust in pipeline if different)

---

### Method 2: Manual Deployment

#### Step 1: Server Setup

1.  **Create Deployment Directory**

    ```bash
    sudo mkdir -p /opt/ad-bot-v2
    sudo chown $USER:$USER /opt/ad-bot-v2
    ```

2.  **Clone Repository**

    ```bash
    cd /opt/ad-bot-v2
    git clone <repository-url> .
    ```

3.  **Install Dependencies**

    ```bash
    npm install --production
    ```

#### Step 2: Environment Configuration

1.  **Create `.env` File**

    ```bash
    cp .env.example .env
    nano .env  # or your preferred editor
    ```

2.  **Fill in All Required Variables**

    See `readme.md` for environment variable reference.

3.  **Secure the `.env` File**

    ```bash
    chmod 600 .env
    ```

#### Step 3: Register Discord Commands

```bash
node scripts/registerCommands.js
```

This only needs to be run once, or when commands change.

#### Step 4: Create Systemd Service

Create `/etc/systemd/system/ad-bot-v2.service`:

```ini
[Unit]
Description=AD Bot v2 - Discord Darts League Bot
After=network.target

[Service]
Type=simple
User=your-username
WorkingDirectory=/opt/ad-bot-v2
Environment="NODE_ENV=production"
ExecStart=/usr/bin/node src/index.js
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
```

**Important:** Replace `your-username` with the actual user account.

**Note:** Environment variables from `.env` are loaded automatically via `dotenv/config` in the code.

#### Step 5: Enable and Start Service

```bash
sudo systemctl daemon-reload
sudo systemctl enable ad-bot-v2
sudo systemctl start ad-bot-v2
```

#### Step 6: Verify Deployment

```bash
# Check service status
sudo systemctl status ad-bot-v2

# View logs
sudo journalctl -u ad-bot-v2 -f

# Test bot in Discord
# Try /ping command (admin only)
```

---

## Post-Deployment

### Initial Setup

1.  **Verify Bot is Online**

    -   Check Discord server - bot should appear online
    -   Run `/ping` command (admin only) to test

2.  **Publish Initial Messages**

    -   `/signups publish` - Publish signup list (if signups are open)
    -   `/standingspublish` - Publish standings (if season is active)
    -   `/fixturespublish` - Publish fixtures (if season is active)

3.  **Verify Database Connection**

    -   Check logs for "✅ Supabase connected" message
    -   Test a command that requires database access

### Ongoing Maintenance

#### Updating the Bot

**With Azure DevOps:**

-   Push changes to main branch
-   Pipeline handles deployment automatically

**Manual Update:**

```bash
cd /opt/ad-bot-v2
git pull
npm install --production
sudo systemctl restart ad-bot-v2
```

**If Commands Changed:**

```bash
node scripts/registerCommands.js
sudo systemctl restart ad-bot-v2
```

#### Monitoring

**Check Service Status:**

```bash
sudo systemctl status ad-bot-v2
```

**View Recent Logs:**

```bash
sudo journalctl -u ad-bot-v2 -n 100
```

**Follow Logs in Real-Time:**

```bash
sudo journalctl -u ad-bot-v2 -f
```

**Check for Errors:**

```bash
sudo journalctl -u ad-bot-v2 --since "1 hour ago" | grep -i error
```

#### Restarting the Bot

```bash
sudo systemctl restart ad-bot-v2
```

The bot will automatically refresh published signup embeds on restart.

---

## Troubleshooting

### Bot Won't Start

1.  **Check Service Status**

    ```bash
    sudo systemctl status ad-bot-v2
    ```

2.  **Check Logs**

    ```bash
    sudo journalctl -u ad-bot-v2 -n 50
    ```

3.  **Common Issues**

    -   Missing environment variables - Check `.env` file exists and has all required variables
    -   Invalid Discord token - Verify token in Discord Developer Portal
    -   Database connection failed - Check Supabase URL and service role key
    -   Port conflicts - Bot doesn't use ports, but check for other issues
    -   Permissions - Ensure service user has read access to code directory

### Bot Starts But Doesn't Respond

1.  **Verify Bot is Online in Discord**
2.  **Check Commands are Registered**

    ```bash
    node scripts/registerCommands.js
    ```

3.  **Check Bot Permissions**

    -   Bot needs "Use Application Commands" permission
    -   Bot needs access to channels where commands are used

4.  **Review Logs for Errors**

    ```bash
    sudo journalctl -u ad-bot-v2 -f
    ```

### Database Errors

1.  **Verify Supabase Connection**

    -   Check `SUPABASE_URL` is correct
    -   Verify `SUPABASE_SERVICE_ROLE_KEY` is valid (not anon key)
    -   Check `SUPABASE_DB_SCHEMA` matches your schema

2.  **Check Database Schema**

    -   Ensure all tables exist (see `docs/basicdb.md`)
    -   Verify service role has proper permissions

3.  **Test Connection**

    ```bash
    # From server, test Supabase connection
    # Check logs for "✅ Supabase connected" message
    ```

### Published Messages Not Updating

1.  **Manual Refresh**

    -   Use `/signups publish`, `/standingspublish`, or `/fixturespublish`
    -   Or restart the bot (auto-refreshes on startup)

2.  **Check Message IDs**

    -   If messages were deleted, republish them
    -   Bot stores message IDs in database - if messages are deleted, IDs become invalid

3.  **Verify Channel Permissions**

    -   Bot needs "Send Messages" and "Embed Links" permissions
    -   Bot needs "Manage Messages" to edit embeds

---

## Rollback Procedure

### Quick Rollback

```bash
cd /opt/ad-bot-v2
git checkout <previous-commit-hash>
npm install --production
sudo systemctl restart ad-bot-v2
```

### Full Rollback

1.  Stop service: `sudo systemctl stop ad-bot-v2`
2.  Restore previous code version
3.  Restore previous `.env` if changed
4.  Install dependencies: `npm install --production`
5.  Register commands if changed: `node scripts/registerCommands.js`
6.  Start service: `sudo systemctl start ad-bot-v2`

---

## Security Considerations

1.  **Environment Variables**

    -   Never commit `.env` file to repository
    -   Use secure storage for production secrets
    -   Restrict file permissions: `chmod 600 .env`

2.  **Service Account**

    -   Run bot as non-root user
    -   Limit service account permissions
    -   Use principle of least privilege

3.  **Discord Token**

    -   Keep token secure
    -   Rotate token if compromised
    -   Use environment variables, never hardcode

4.  **Database Access**

    -   Use service role key (not anon key)
    -   Restrict Supabase RLS policies if applicable
    -   Monitor database access logs

5.  **Network**

    -   Bot only makes outbound connections
    -   No inbound ports required
    -   Consider firewall rules if needed

---

## Backup and Recovery

### Database Backups

Supabase handles automatic backups. For manual backups:

1.  Use Supabase dashboard backup feature
2.  Or use `pg_dump` if you have direct database access

### Configuration Backup

```bash
# Backup .env file
cp /opt/ad-bot-v2/.env /opt/ad-bot-v2/.env.backup
```

### Recovery

1.  Restore database from Supabase backup
2.  Restore `.env` file
3.  Restore code from git
4.  Restart service

---

## Performance Considerations

-   Bot is lightweight and uses minimal resources
-   Main resource usage: Discord API rate limits
-   Database queries are optimized but monitor Supabase usage
-   Consider connection pooling if scaling to multiple instances

---

## Support

For issues or questions:

1.  Check logs: `sudo journalctl -u ad-bot-v2 -f`
2.  Review documentation: `docs/` directory
3.  Check troubleshooting section in `readme.md`
