#!/usr/bin/env bash
#
# SEAP Watcher — health check script
#
# Quick status check for the service, database, and recent runs.
# Run as the service user or root.
#
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/seap-watcher}"
DB_PATH="${APP_DIR}/data/seap-watcher.db"
SERVICE_NAME="seap-watcher"

echo "=== SEAP Watcher Health ==="
echo ""

# ── Service status ─────────────────────────────────────────────────
if command -v systemctl >/dev/null 2>&1; then
  STATUS="$(systemctl is-active "$SERVICE_NAME" 2>/dev/null || echo 'not running')"
  echo "Service:   $STATUS"
else
  echo "Service:   systemctl not available"
fi

# ── Database ───────────────────────────────────────────────────────
if [ -f "$DB_PATH" ]; then
  DB_SIZE="$(du -h "$DB_PATH" | cut -f1)"
  echo "DB size:   $DB_SIZE"

  if command -v sqlite3 >/dev/null 2>&1; then
    TOTAL="$(sqlite3 "$DB_PATH" 'SELECT COUNT(*) FROM tenders;' 2>/dev/null || echo '?')"
    ALERTED="$(sqlite3 "$DB_PATH" 'SELECT COUNT(*) FROM tenders WHERE alerted=1;' 2>/dev/null || echo '?')"
    echo "Tenders:   $TOTAL total, $ALERTED alerted"

    echo ""
    echo "Last run:"
    sqlite3 -header -column "$DB_PATH" \
      'SELECT run_at, cron_slot, total_fetched, new_tenders, alerted_count, status FROM run_log ORDER BY id DESC LIMIT 1;' \
      2>/dev/null || echo "  (no runs recorded)"
  else
    echo "(install sqlite3 for detailed stats)"
  fi
else
  echo "DB:        not created yet"
fi

echo ""
echo "Log tail (last 5 lines):"
journalctl -u "$SERVICE_NAME" -n 5 --no-pager 2>/dev/null || echo "  (no journal entries)"
