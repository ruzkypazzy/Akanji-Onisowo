# Runbook — What to Do When

A quick reference for common situations during the trading competition.

## Daily checklist (5 min)

- [ ] Check the daily P&L email arrived (or look at `daily_pnl` table in DB)
- [ ] Open `bash run.sh logs` and skim for errors
- [ ] Verify `bash run.sh status` shows the agent is up
- [ ] Glance at open positions count (should be 0-2)

## If the agent loses 8% in a day

**Expected reaction: nothing.** The agent auto-pauses. Wait for tomorrow UTC+8 midnight. Check the email you got — it explains the daily loss.

If the loss is from a single bad trade that hit stop loss, that's normal. If it's from 3+ trades all losing, review the day's journal entries:
```bash
sqlite3 /opt/okx-trading-asp/data/journal.db \
  "SELECT ts, action, token, details FROM journal WHERE ts > strftime('%s', 'now', '-1 day') * 1000 ORDER BY ts DESC LIMIT 20"
```

## If the agent hits the 20% kill switch

**Expected reaction: investigate, then decide.**

The agent has closed all positions and halted. You need to:

1. Check the kill-switch email for the exact drawdown
2. Look at the journal to see what went wrong:
   ```bash
   sqlite3 /opt/okx-trading-asp/data/journal.db "SELECT * FROM trades WHERE exit_reason IS NOT NULL ORDER BY ts_close DESC LIMIT 10"
   ```
3. Decide: restart (if it was a market anomaly) or stop (if the strategy is wrong)

To restart:
```bash
bash run.sh stop && bash run.sh start
```

To permanently stop (don't restart):
```bash
bash run.sh stop
# Don't start it again
```

## If the heartbeat watchdog emails you

The agent has been silent for >90 seconds. Possible causes:

1. **Process crashed** — Docker should auto-restart, but check: `docker ps | grep okx-trading-asp`
2. **Network issue** — check: `curl -I https://web3.okx.com`
3. **Onchainos issue** — check: `onchainos wallet status`
4. **DB locked** — restart: `bash run.sh stop && bash run.sh start`

## If you want to manually close a position

```bash
# 1. SSH into VPS
# 2. Find the position in the DB
sqlite3 /opt/okx-trading-asp/data/journal.db "SELECT id, token, side, size_usdt, entry_price FROM trades WHERE ts_close IS NULL"
# 3. Manually close via onchainos
onchainos swap --from <token> --to <usdt> --amount <size> --chain xlayer --force
# 4. Update the DB
sqlite3 /opt/okx-trading-asp/data/journal.db "UPDATE trades SET ts_close = $(date +%s)000, exit_price = <p>, pnl_usdt = <p2>, pnl_pct = <p3>, exit_reason = 'MANUAL' WHERE id = <id>"
```

(Replace `<...>` with actual values)

## If you want to pause without stopping

```bash
# Pauses new entries, keeps monitoring existing positions
bash run.sh pause
# To resume:
bash run.sh resume
```

## If you want to update config without restarting

Most config changes require a restart. To do it without losing the in-memory tick number:
```bash
# 1. Edit .env
# 2. Trigger a graceful restart of the container (not the host)
docker restart okx-trading-asp
```

This restarts the Node process but keeps the SQLite DB.

## If X Layer DEX has an outage

The agent will:
- Log the failure in journal
- Continue trying every 30s
- Keep monitoring existing positions (on-chain TP/SL still works)
- Not enter new positions

You don't need to do anything. Just wait for OKX to fix it.

## If you want to take over manually

```bash
# 1. Pause the agent
bash run.sh pause
# 2. Take over via onchainos CLI directly
# 3. When done, resume the agent (it will read state from DB)
bash run.sh resume
```

The agent reconciles its in-memory state with the DB on every tick, so manual trades made during pause will be picked up correctly.

## Emergency: nuclear option

If everything is on fire:

```bash
bash run.sh stop-all
```

This:
- Sets the stop file (agent will close all positions and exit)
- Waits 5 seconds
- Stops the Docker container
- Removes the stop file

After this, the agent is fully offline. Existing on-chain TP/SL orders will still execute if prices hit them, but no more decisions will be made.

## Post-competition

1. **Claim any rewards** via the OKX.AI Trading Hackathon
2. **Withdraw remaining funds** from the adazycommunicator wallet to your main exchange
3. **Decide if you want to keep the agent running** for ongoing subscription revenue
4. **Either way, the agent stays listed on the marketplace** unless you remove it
