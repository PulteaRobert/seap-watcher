#!/usr/bin/env bash
#
# SEAP Watcher — VPS deployment script
#
# Run as root (or with sudo) on a fresh Ubuntu/Debian VPS.
# Deploys the app to /opt/seap-watcher and installs a systemd service.
#
set -euo pipefail

APP_DIR="/opt/seap-watcher"
SERVICE_NAME="seap-watcher"
SERVICE_USER="seap"

info() { echo "ℹ  $*"; }
ok() { echo "✅ $*"; }
fail() {
	echo "❌ $*" >&2
	exit 1
}

# ── Pre-flight checks ──────────────────────────────────────────────

command -v node >/dev/null 2>&1 || fail "Node.js not found. Install via nvm or nodesource first."
command -v npm >/dev/null 2>&1 || fail "npm not found."

# ── 1. Create system user ──────────────────────────────────────────

if id "$SERVICE_USER" >/dev/null 2>&1; then
	info "User $SERVICE_USER already exists — skipping."
else
	info "Creating system user $SERVICE_USER..."
	useradd --system --no-create-home "$SERVICE_USER" || fail "useradd failed"
fi

# ── 2. Install app to /opt/seap-watcher ────────────────────────────

SRC_DIR="$(cd "$(dirname "$0")/.." && pwd)"

if [ -d "$APP_DIR" ]; then
	info "Directory $APP_DIR exists — updating in place."
else
	info "Creating $APP_DIR..."
	mkdir -p "$APP_DIR"
fi

# Copy everything except node_modules, dist, data, session, .git
rsync -a --exclude=node_modules --exclude=dist --exclude=data --exclude=session \
	--exclude=.git --exclude=.rpiv "$SRC_DIR/" "$APP_DIR/"

# ── 3. Install dependencies & build ────────────────────────────────

info "Installing production dependencies..."
cd "$APP_DIR"
npm ci --production --ignore-scripts 2>/dev/null || npm ci --production

info "Building TypeScript..."
npm run build || fail "TypeScript build failed"

# ── 4. Create data directories ─────────────────────────────────────

mkdir -p "$APP_DIR/data" "$APP_DIR/session"
chown -R "$SERVICE_USER:$SERVICE_USER" "$APP_DIR"

# ── 5. Create .env if missing ──────────────────────────────────────

if [ ! -f "$APP_DIR/.env" ]; then
	info "No .env found — copying from .env.example (edit manually!)"
	if [ -f "$APP_DIR/.env.example" ]; then
		cp "$APP_DIR/.env.example" "$APP_DIR/.env"
		chown "$SERVICE_USER:$SERVICE_USER" "$APP_DIR/.env"
		echo "   ⚠️  Edit $APP_DIR/.env and set YOUR WhatsApp number before starting."
	fi
fi

# ── 6. Install systemd service ─────────────────────────────────────

SERVICE_FILE="$(dirname "$0")/systemd/${SERVICE_NAME}.service"

if [ ! -f "$SERVICE_FILE" ]; then
	fail "Service file not found at $SERVICE_FILE"
fi

cp "$SERVICE_FILE" "/etc/systemd/system/${SERVICE_NAME}.service"
systemctl daemon-reload
systemctl enable "$SERVICE_NAME"
systemctl restart "$SERVICE_NAME"

# ── 7. Verify ──────────────────────────────────────────────────────

sleep 2
STATUS="$(systemctl is-active "$SERVICE_NAME" 2>/dev/null || echo 'unknown')"

if [ "$STATUS" = "active" ]; then
	ok "$SERVICE_NAME is running!"
	echo ""
	echo "  Check logs:    sudo journalctl -u $SERVICE_NAME -f"
	echo "  Health check:  $APP_DIR/scripts/health-check.sh"
	echo "  Stop service:  sudo systemctl stop $SERVICE_NAME"
	echo ""
	echo "  If this is the first run, scan the WhatsApp QR code from the logs."
else
	echo "⚠️  Service status: $STATUS"
	echo "   Check logs: sudo journalctl -u $SERVICE_NAME -e"
fi
