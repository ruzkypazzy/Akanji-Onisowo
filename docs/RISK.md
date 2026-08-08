# Risk Management — The Rules

Every rule below is enforced by the code. There are no exceptions.

## Hard limits (never overridden)

| Rule | Value (300 USDT mode) | What it means |
|---|---|---|
| Max position size | 20% of capital (60 USDT) | One bad trade can lose at most 3 USDT |
| Max concurrent positions | 2 | Diversification, not concentration |
| Min position size | 30 USDT | Below this, fees eat the trade |
| Max total exposure | 60% of capital (180 USDT) | Always 40% cash reserve |
| Hard stop loss | -5% from entry | Per-position cap |
| Take profit 1 | +10%, close 50% | Partial gain lock |
| Take profit 2 | +20%, close 100% | Full exit |
| Time stop | 4 hours at flat | Kill dead trades |
| Daily loss limit | -8% of capital (-24 USDT) | Pause trading for the day |
| Total drawdown kill switch | -20% of capital (-60 USDT) | Hard halt, manual restart |

## How each rule protects the account

### Max position size
If a position hits stop loss, you lose 5% of the position. If the position is 20% of capital, that's **1% of total capital per losing trade**. Three losing trades in a row = -3%. Survivable.

Without this rule, a single trade could be 50% of capital = -2.5% on stop loss. One bad day could be -10% on a single trade.

### Max concurrent positions
Diversification. Two positions can both fail, but they likely won't both fail at the same time. The rule prevents "all eggs in one basket" mistakes.

### Hard stop loss
This is the single most important rule. Without it, a single bad trade can wipe out 20-30% of the account. With it, no trade can lose more than 5% of its size.

### Take profit ladder
Greed is the enemy. Without TP, a winning trade can reverse and become a loser. TP1 (+10%) locks in half the gain. TP2 (+20%) exits the rest. The trade can never become a loser once TP1 has fired (because stop moves to breakeven).

### Trailing stop
After TP1, the trade is "free" (worst case is breakeven). Trailing stop lets the position run for bigger gains, but exits automatically if momentum dies.

### Time stop
Capital tied up in a boring trade is capital not earning in a better trade. 4 hours is the maximum time Àkànjí will wait for a position to do its job.

### Daily loss limit
After 8% daily loss, decisions get emotional. Pausing for the rest of the day prevents revenge trading and lets the strategy reset.

### Total drawdown kill switch
This is the "break glass in case of emergency" rule. If the account drops 20%, something is fundamentally wrong. Stop everything, investigate, restart manually.

## Worst case scenarios (300 USDT mode)

| Scenario | Loss | % of capital |
|---|---:|---:|
| Both positions hit stop loss at -5% | -6 USDT | -2% |
| Both positions hit stop loss + 1 more bad day | -30 USDT | -10% |
| Hit daily loss limit twice in a row | -48 USDT | -16% (no kill switch yet) |
| Hit total drawdown kill switch | -60 USDT | -20% (HARD CAP) |
| Black swan / exchange hack | -60+ USDT | Beyond our control |

## What is NOT in the risk rules

These are intentionally NOT included:

- ❌ **Stop loss widening** — once set, SL never moves further away
- ❌ **"Hold and hope"** — no exceptions to time stop
- ❌ **Manual override of limits** — only kill switch is one-way (manual restart)
- ❌ **Adaptive position sizing** — fixed 20% regardless of "conviction"
- ❌ **Leverage** — spot only, no margin

## What if the agent process crashes?

1. Docker auto-restarts (via `restart: always`)
2. Agent reads open positions from SQLite on startup
3. The strategy orders (TP/SL) are **on-chain** — they execute even if the agent is offline
4. Heartbeat watchdog alerts via email if no heartbeat for 90 seconds
5. External cron runs `ops/healthcheck.sh` every 5 minutes

## What if OKX goes down?

1. Agent detects the failure (no response from onchainos)
2. Agent keeps retrying with exponential backoff
3. Existing positions are unaffected (TP/SL orders are on-chain)
4. No new entries attempted until OKX is reachable
5. Heartbeat keeps firing so we know the agent itself is alive

---

*Risk management is the part of trading you can't skip. Àkànjí is built to lose small and win consistently, not to chase glory.*
