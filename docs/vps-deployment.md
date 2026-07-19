# VPS Deployment Guide — SEAP Brasov Tender Watcher

Step-by-step guide to deploying the SEAP Watcher on a fresh Ubuntu/Debian VPS.

## Requirements

- **OS**: Ubuntu 22.04+ or Debian 12+ (anything with systemd)
- **RAM**: 512 MB minimum (1 GB recommended)
- **Disk**: 10 GB minimum (SQLite + Node.js deps ~200 MB)
- **Node.js**: 18+ (installed via NodeSource or nvm)
- **Network**: Outbound HTTPS (port 443) to `e-licitatie.ro` and WhatsApp servers

## Quick Deploy (One Command)

If you already have Node.js 18+ installed:

```bash
sudo bash deploy/setup.sh
```

This creates a system user, installs the app to `/opt/seap-watcher`, builds it, and starts the systemd service.

---

## Manual Step-by-Step

### 1. Install Node.js

```bash
# Using NodeSource (Node.js 20 LTS)
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# Verify
node -v   # v20.x.x
npm -v    # 10.x.x
```

### 2. Clone the Repository

```bash
# Option A: clone directly to /opt
sudo git clone <your-repo-url> /opt/seap-watcher

# Option B: clone locally then copy
git clone <your-repo-url> /tmp/seap-watcher
sudo cp -r /tmp/seap-watcher /opt/
sudo rm -rf /tmp/seap-watcher
```

### 3. Create System User

```bash
sudo useradd --system --no-create-home seap
```

### 4. Install Dependencies and Build

```bash
cd /opt/seap-watcher

# Install production dependencies
npm ci --production

# Build TypeScript
npm run build

# Verify build output exists
ls dist/index.js
```

### 5. Configure Environment

```bash
cd /opt/seap-watcher

# Copy from example
cp .env.example .env

# Edit — at minimum set your WhatsApp number
nano .env
```

Key variables to set:

| Variable | Value | Required |
| --- | --- | --- |
| `WHATSAPP_TO_PHONE` | Your number, e.g. `40712345678` | ✅ Yes |
| `SEAP_COUNTY` | `Brasov` (default) | No |
| `CRON_MORNING` | `0 7 * * 1-5` (09:00 EET) | No |
| `CRON_AFTERNOON` | `0 13 * * 1-5` (15:00 EET) | No |
| `LOG_LEVEL` | `info` (default) | No |

Set ownership:

```bash
sudo chown seap:seap .env
```

### 6. Create Data Directories

```bash
cd /opt/seap-watcher
mkdir -p data session
sudo chown -R seap:seap data session
```

### 7. Install Systemd Service

```bash
# Copy the service file
sudo cp deploy/systemd/seap-watcher.service /etc/systemd/system/

# Reload systemd and enable the service
sudo systemctl daemon-reload
sudo systemctl enable seap-watcher

# Start it
sudo systemctl start seap-watcher
```

### 8. Verify Deployment

```bash
# Check service status
sudo systemctl status seap-watcher

# View live logs
sudo journalctl -u seap-watcher -f

# Run health check
bash /opt/seap-watcher/scripts/health-check.sh
```

---

## First Run — WhatsApp QR Code

On first run (or after session expiry), the service prints a QR code to the journal logs:

```bash
sudo journalctl -u seap-watcher -f | grep -A 20 "QR"
```

Or simply:

```bash
sudo journalctl -u seap-watcher -f
```

**Scan the QR code** with WhatsApp on your phone:

1. Open WhatsApp → Linked Devices → Link a Device
2. Scan the QR code from the terminal
3. The service will connect and start the scheduled checks

> **Tip**: If you can't see the QR code clearly, increase terminal width or use `tmux`/`screen`.

---

## Testing Instantly

Use `--run-once` to trigger a single fetch without waiting for cron:

```bash
# As root (via sudo -u seap)
sudo -u seap /usr/bin/node /opt/seap-watcher/dist/index.js --run-once

# Or with NO_OP mode (logs messages, doesn't send WhatsApp)
sudo -u seap NO_OP_WHATSAPP=1 /usr/bin/node /opt/seap-watcher/dist/index.js --run-once
```

Watch the logs in real-time:

```bash
sudo journalctl -u seap-watcher -f
```

---

## Updating the Application

### Manual Update

```bash
cd /opt/seap-watcher

# Pull latest changes
sudo git pull

# Rebuild
npm ci --production
npm run build

# Restart service
sudo systemctl restart seap-watcher

# Verify
sudo journalctl -u seap-watcher -n 20
```

### Automatic Deployment via GitHub Actions

Push to `master` and the VPS auto-updates. Requires one-time SSH key setup.

#### 1. Generate an SSH deploy key

```bash
ssh-keygen -t ed25519 -C "gh-actions-deploy" -f ~/.ssh/seap-watcher-deploy -N ""
```

#### 2. Add public key to VPS

```bash
# Copy the public key to your VPS and add it to authorized_keys
ssh-copy-id -i ~/.ssh/seap-watcher-deploy.pub root@YOUR_VPS_IP
# or manually: cat ~/.ssh/seap-watcher-deploy.pub >> ~/.ssh/authorized_keys
```

#### 3. Add GitHub Secrets

In your repo settings → Secrets and variables → Actions, add:

| Secret | Value |
| --- | --- |
| `DEPLOY_HOST` | Your VPS IP or hostname |
| `DEPLOY_USER` | SSH username (e.g. `root`) |
| `DEPLOY_KEY` | Contents of the **private** key file |

```bash
# Copy the private key content to your clipboard
cat ~/.ssh/seap-watcher-deploy
```

#### 4. Done

Every push to `master` triggers a deploy. You can also manually trigger from the Actions tab.

> **Note**: The workflow runs a local build check before deploying, so broken code never reaches the VPS.

---

## Troubleshooting

### Service won't start

```bash
# Check detailed logs
sudo journalctl -u seap-watcher -e --no-pager

# Common issues:
# - Missing .env file → copy from .env.example
# - Wrong file permissions → sudo chown -R seap:seap /opt/seap-watcher
# - Node.js not in PATH → check ExecStart path in service file
```

### WhatsApp keeps disconnecting

```bash
# Delete old session and get a fresh QR
sudo -u seap rm -rf /opt/seap-watcher/session/*
sudo systemctl restart seap-watcher
sudo journalctl -u seap-watcher -f  # scan new QR
```

### No tenders found

- Verify `SEAP_COUNTY` matches the actual county name (case-sensitive on SEAP)
- Check that SEAP is accessible: `curl -s https://e-licitatie.ro`
- Try a manual run with debug logging: `LOG_LEVEL=debug npm run run-once`

### Database issues

```bash
# Check DB integrity
sudo -u seap sqlite3 /opt/seap-watcher/data/seap-watcher.db 'PRAGMA integrity_check;'

# View tables
sudo -u seap sqlite3 /opt/seap-watcher/data/seap-watcher.db '.tables'

# Count tenders
sudo -u seap sqlite3 /opt/seap-watcher/data/seap-watcher.db 'SELECT COUNT(*) FROM tenders;'
```

### Disk space

```bash
# Check disk usage
du -sh /opt/seap-watcher/data/
du -sh /opt/seap-watcher/session/
df -h /

# Clean old run logs (keep last 100)
sudo -u seap sqlite3 /opt/seap-watcher/data/seap-watcher.db \
  "DELETE FROM run_log WHERE id NOT IN (SELECT id FROM run_log ORDER BY id DESC LIMIT 100);"
```

---

## Service Management

| Action | Command |
| --- | --- |
| Start | `sudo systemctl start seap-watcher` |
| Stop | `sudo systemctl stop seap-watcher` |
| Restart | `sudo systemctl restart seap-watcher` |
| Status | `sudo systemctl status seap-watcher` |
| Live logs | `sudo journalctl -u seap-watcher -f` |
| Last 50 log lines | `sudo journalctl -u seap-watcher -n 50` |
| Health check | `bash /opt/seap-watcher/scripts/health-check.sh` |
| Manual instant run | `sudo -u seap node /opt/seap-watcher/dist/index.js --run-once` |

---

## Security Notes

- The systemd service runs as the unprivileged `seap` user
- `ProtectSystem=strict` prevents writing outside `data/` and `session/`
- `NoNewPrivileges=true` prevents privilege escalation
- `.env` contains your phone number — keep it private (`chmod 600`)
- WhatsApp session files in `session/` are sensitive — restrict access
