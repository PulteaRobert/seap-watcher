#!/usr/bin/env bash
#
# SEAP Watcher — remote deploy script
#
# Intended to be executed on the VPS via SSH (e.g., from GitHub Actions).
# Pulls latest code, rebuilds, and restarts the service.
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

cd "$APP_DIR" || fail "Cannot cd to $APP_DIR"

# $APP_DIR is owned by $SERVICE_USER, not the SSH deploy user, so every
# privileged step below runs via sudo (deploy user needs passwordless sudo).
sudo git config --global --add safe.directory "$APP_DIR"

info "Pulling latest changes..."
BEFORE="$(sudo git rev-parse HEAD)"
# Fetch + hard reset rather than `pull`: the VPS checkout should always
# mirror origin/master exactly, so any local drift (e.g. an npm install
# run by hand on the box) never blocks an automated deploy.
sudo git fetch origin master || fail "git fetch failed"
sudo git reset --hard origin/master || fail "git reset failed"
AFTER="$(sudo git rev-parse HEAD)"

if [ "$BEFORE" = "$AFTER" ]; then
	info "No new changes — skipping rebuild."
	exit 0
fi

info "Updated $BEFORE → $AFTER"

# ── Install dependencies & build ───────────────────────────────────

info "Installing production dependencies..."
sudo npm ci --production || fail "npm ci failed"

info "Building TypeScript..."
sudo npm run build || fail "TypeScript build failed"

# ── Ensure data dirs & ownership ───────────────────────────────────

sudo mkdir -p "$APP_DIR/data" "$APP_DIR/session"
sudo chown -R "$SERVICE_USER:$SERVICE_USER" "$APP_DIR"

# ── Update service file if changed ─────────────────────────────────

SERVICE_FILE="$APP_DIR/deploy/systemd/${SERVICE_NAME}.service"
if [ -f "$SERVICE_FILE" ]; then
	sudo cp "$SERVICE_FILE" "/etc/systemd/system/${SERVICE_NAME}.service"
	sudo systemctl daemon-reload
	info "Service file updated."
fi

# ── Restart & verify ───────────────────────────────────────────────

info "Restarting $SERVICE_NAME..."
sudo systemctl restart "$SERVICE_NAME" || fail "systemctl restart failed"

sleep 3
STATUS="$(sudo systemctl is-active "$SERVICE_NAME" 2>/dev/null || echo 'unknown')"

if [ "$STATUS" = "active" ]; then
	ok "$SERVICE_NAME is running!"
else
	fail "$SERVICE_NAME status: $STATUS"
fi
