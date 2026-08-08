#!/bin/bash
# Àkànjí Oníṣòwò — Quick start/stop/status commands

set -e

case "$1" in
  start)
    echo "🌅 Starting Àkànjí Oníṣòwò..."
    cd /opt/okx-trading-asp
    docker compose up -d
    echo "✅ Started. Logs: docker compose logs -f"
    ;;
  stop)
    echo "🛑 Stopping Àkànjí Oníṣòwò..."
    cd /opt/okx-trading-asp
    docker compose down
    echo "✅ Stopped"
    ;;
  pause)
    echo "⏸️  Pausing trading (will keep monitoring open positions)..."
    touch /tmp/pause-trading
    echo "✅ Trading paused. Remove with: rm /tmp/pause-trading"
    ;;
  resume)
    echo "▶️  Resuming trading..."
    rm -f /tmp/pause-trading
    echo "✅ Trading resumed"
    ;;
  stop-all)
    echo "🚨 Emergency stop: closing all positions and shutting down..."
    touch /tmp/stop-trading
    sleep 5
    cd /opt/okx-trading-asp
    docker compose down
    rm -f /tmp/stop-trading
    echo "✅ All positions should be closed, agent stopped"
    ;;
  status)
    echo "📊 Àkànjí Oníṣòwò status..."
    cd /opt/okx-trading-asp
    docker compose ps
    echo ""
    if [ -f /tmp/pause-trading ]; then echo "⏸️  Trading is PAUSED"; fi
    if [ -f /tmp/stop-trading ]; then echo "🚨 Stop is REQUESTED"; fi
    ;;
  logs)
    cd /opt/okx-trading-asp
    docker compose logs -f
    ;;
  *)
    echo "Usage: $0 {start|stop|pause|resume|stop-all|status|logs}"
    exit 1
    ;;
esac
