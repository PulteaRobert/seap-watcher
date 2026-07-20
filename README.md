# SEAP Brasov Tender Watcher

Monitors Romanian public procurement ([SEAP](https://e-licitatie.ro))
for new tenders in **Brasov county** and sends **WhatsApp alerts**
once daily on weekdays.

## How It Works

```
┌──────────┐   ┌────────┐   ┌────────┐   ┌──────────┐
│ SEAP API │──▶│ SQLite │──▶│ Dedup  │──▶│ WhatsApp │
│ (1x/day) │   │(store) │   │ (diff) │   │ (alert)  │
└──────────┘   └────────┘   └────────┘   └──────────┘
```

1. **Fetches** tenders from SEAP (both sub-threshold DA and above-threshold CAN)
2. **Stores** them in a local SQLite database
3. **Deduplicates** against previously seen tenders
4. **Sends** a formatted WhatsApp message listing new tenders

## Quick Start (Local Development)

```bash
# 1. Clone and configure
cp .env.example .env
# Edit .env — at minimum set WHATSAPP_TO_PHONE

# 2. Install and build
npm install
npm run build

# 3. Run (use NO_OP mode to skip WhatsApp during dev)
NO_OP_WHATSAPP=1 npm start
```

### Development without WhatsApp

Set `NO_OP_WHATSAPP=1` to use a no-op WhatsApp client that logs
messages instead of sending them. Useful for testing the
fetch/dedup pipeline without connecting to WhatsApp Web.

### Running with live WhatsApp

```bash
npm start
# Scan the QR code printed to the terminal
```

## VPS Deployment

```bash
# On a fresh Ubuntu/Debian VPS (requires Node.js 18+ installed):
sudo bash deploy/setup.sh
```

This script:

1. Creates a `seap` system user
2. Installs the app to `/opt/seap-watcher`
3. Installs production dependencies and builds TypeScript
4. Installs and starts the systemd service
5. The service auto-restarts on crash and on boot

### Manual Deployment

```bash
# 1. Install Node.js 18+ (nvm or nodesource)
# 2. Clone to /opt/seap-watcher
# 3. npm ci --production && npm run build
# 4. Copy deploy/systemd/seap-watcher.service to /etc/systemd/system/
# 5. systemctl daemon-reload && systemctl enable --now seap-watcher
```

## Configuration

| Variable | Default | Description |
| --- | --- | --- |
| `WHATSAPP_TO_PHONE` | *(required)* | Phone(s) in E.164 format; comma-separated for multiple recipients (e.g. `40712345678,40798765432`) |
| `SEAP_COUNTY` | `Brasov` | County to monitor |
| `CRON_SCHEDULE` | `0 17 * * 1-5` | Daily check cron expression (Europe/Bucharest) |
| `DB_PATH` | `./data/seap-watcher.db` | SQLite DB path (relative paths resolve against the project root, not cwd) |
| `SESSION_PATH` | `./session` | Baileys WhatsApp session directory (same relative-path resolution as `DB_PATH`) |
| `LOG_LEVEL` | `info` | Log level (`debug`, `info`, `warn`, `error`) |
| `MAX_TENDERS_PER_RUN` | `200` | Max tenders fetched per run |
| `NO_OP_WHATSAPP` | *(empty)* | Set to `1` to skip live WhatsApp |

## Useful Commands

```bash
# View live logs
sudo journalctl -u seap-watcher -f

# Check health
bash scripts/health-check.sh

# Restart service
sudo systemctl restart seap-watcher

# Trigger a single manual check (fetch + alert), then exit —
# same pipeline the cron schedule runs, useful for testing.
# NOTE: only sends WhatsApp if there are new (unalerted) tenders, and
# shares the WhatsApp session with the live service — stop it first
# on the VPS or you'll get a connection conflict:
#   sudo systemctl stop seap-watcher
npm run run-once             # local dev
sudo -u seap NODE_ENV=production /usr/bin/node /opt/seap-watcher/dist/index.js --run-once   # on the VPS
#   sudo systemctl start seap-watcher

# Send a one-off WhatsApp test message to every configured recipient,
# regardless of whether there are new tenders — useful for verifying
# delivery after changing WHATSAPP_TO_PHONE. Same session-conflict
# caveat as run-once: stop the service first.
sudo -u seap NODE_ENV=production node scripts/test-send.js

# View database
sqlite3 data/seap-watcher.db '.tables'
sqlite3 data/seap-watcher.db 'SELECT * FROM tenders LIMIT 5;'
```

## Troubleshooting

| Problem | Solution |
| --- | --- |
| WhatsApp disconnected | `journalctl -u seap-watcher -f`, scan QR |
| No tenders found | Check `SEAP_COUNTY` spelling; verify SEAP up |
| DB errors | `sqlite3 data/seap-watcher.db 'PRAGMA integrity_check;'` |
| Service won't start | `journalctl -u seap-watcher -e` for details |
| Permission denied on data/ | `chown -R seap:seap data/ session/` |
| Session expired | Delete `session/` dir, restart for new QR |

## Project Structure

```text
├── src/
│   ├── config.ts          # Zod-validated config from env
│   ├── logger.ts          # Pino structured logger
│   ├── index.ts           # Main entry point
│   ├── scheduler.ts       # Cron scheduler (fetch → dedup → alert)
│   ├── seap/
│   │   ├── client.ts      # SEAP API HTTP client with retry
│   │   ├── fetch.ts       # Fetch orchestration (DA + CAN tiers)
│   │   └── types.ts       # Tender type definitions
│   ├── db/
│   │   ├── database.ts    # SQLite init and schema
│   │   └── operations.ts  # CRUD operations
│   ├── dedup/
│   │   └── engine.ts      # Diff engine (new / modified / unchanged)
│   ├── format/
│   │   └── message.ts     # WhatsApp message formatter (Romanian)
│   └── whatsapp/
│       ├── client.ts      # Baileys WhatsApp client
│       ├── noop.ts        # No-op client for dev
│       └── send.ts        # Send with retry logic
├── deploy/
│   ├── setup.sh           # VPS deployment script
│   └── systemd/
│       ├── seap-watcher.service
│       └── seap-watcher.journal.conf
└── scripts/
    └── health-check.sh    # Service health check
```

## References

- [SEAP (e-licitatie.ro)](https://e-licitatie.ro/)
- [n8n-nodes-seap (SEAP API patterns)](https://github.com/cata-g/n8n-nodes-seap)
- [Baileys (WhatsApp Web API)](https://github.com/WhiskeySockets/Baileys)
- [better-sqlite3](https://github.com/WiseLibs/better-sqlite3)
