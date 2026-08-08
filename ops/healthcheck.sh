#!/bin/bash
# Healthcheck watchdog for Àkànjí Oníṣòwò
# Runs every 5 minutes via cron, alerts if agent has been silent > 90 seconds

set -e

INSTALL_DIR="/opt/okx-trading-asp"
DB="$INSTALL_DIR/data/journal.db"
EMAIL_TO="pazzycamero@gmail.com"
MAX_AGE_SECONDS=120  # heartbeat should be at most 90s old, give 30s buffer

if [ ! -f "$DB" ]; then
  echo "🚨 No journal.db found — agent has never run or data was wiped"
  exit 1
fi

# Get the latest heartbeat timestamp
LAST_TS=$(sqlite3 "$DB" "SELECT ts FROM heartbeat ORDER BY ts DESC LIMIT 1;" 2>/dev/null || echo "0")
NOW=$(date +%s)000  # ms

if [ -z "$LAST_TS" ] || [ "$LAST_TS" = "0" ]; then
  echo "🚨 No heartbeat recorded"
  exit 1
fi

AGE_MS=$((NOW - LAST_TS))
AGE_SECONDS=$((AGE_MS / 1000))

if [ "$AGE_SECONDS" -gt "$MAX_AGE_SECONDS" ]; then
  echo "🚨 Last heartbeat was $AGE_SECONDS seconds ago (max $MAX_AGE_SECONDS)"
  # Send alert
  if command -v mail &> /dev/null; then
    echo "Àkànjí heartbeat stale: $AGE_SECONDS seconds" | mail -s "🚨 Àkànjí unresponsive" "$EMAIL_TO"
  fi
  exit 1
fi

echo "✅ Heartbeat OK ($AGE_SECONDS seconds old)"
exit 0
