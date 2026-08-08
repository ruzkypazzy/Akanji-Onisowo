# Strategy — How Àkànjí Decides

This document explains, in plain English, exactly how Àkànjí Oníṣòwò decides what to trade, when to enter, and when to exit.

## The mental model

Àkànjí does not "predict" the market. He waits for **confluence** — multiple independent signals agreeing at the same time. When that happens, he enters. When conditions change, he exits.

## Entry: the scoring system

Every 30 seconds, Àkànjí scans the market. For each token, he computes a **score** from 0 to 5 based on 4 signals:

| Signal | What it means | Points |
|---|---|---:|
| **Whales** | 3+ top-50 profitable wallets bought this token in the last hour | +2 |
| **Whales (weak)** | 1-2 top-50 wallets bought it | +1 |
| **Volume spike** | 1h volume is 5x the 24h average | +1 |
| **Price up** | Price is up >5% in the last 15 minutes | +1 |
| **New pool** | Token was launched recently with sufficient liquidity | +1 |
| **Social buzz** | Unusual mention volume on X/Telegram | +0.5 |

**Threshold to enter: score ≥ 3.**

- Score 3-3.5: enter with **10% of capital** (smaller size, less conviction)
- Score 4+: enter with **20% of capital** (max size, high conviction)
- Score <3: skip

### Why this works

- **Whales alone** are not enough. Smart money can be wrong, or can be exit-liquidity providers.
- **Volume spike alone** can be a one-sided pump about to dump.
- **Multiple signals agreeing** = real momentum with multiple participants.

## Side selection: LONG vs SHORT

For tokens that pass the score threshold, Àkànjí determines direction:

- **LONG** if: trend is up + at least one signal, OR new pool with volume spike and positive momentum
- **SHORT** if: trend is down >5% + whales selling + price falling, OR volume spike with falling price
- **FLAT** if: signals conflict or are insufficient

**FLAT is a valid outcome.** Most signals will result in FLAT. Better to skip than force a trade.

## Exits: mandatory risk management

Every position, without exception, has these rules attached:

### Stop loss: -5%

If the position drops 5% from entry, exit immediately. No questions, no override.

### Take profit ladder: +10% then +20%

- At +10% (TP1): close **50%** of the position, lock in profit
- After TP1, move stop loss to **breakeven** (so worst case is zero loss)
- After TP1, activate **trailing stop** (locks in gains as price rises)
- At +20% (TP2): close remaining **50%**, full exit

### Trailing stop

After TP1 fires (or if the position reaches +15% profit), a trailing stop activates:
- If the position ever falls back to a tight distance from its high, exit.
- This protects gains when a winning trade starts to reverse.

### Time stop: 4 hours

If a position is held for 4 hours and is still roughly flat (±2%), close it. Dead trades block capital that could be used for better setups.

### Daily loss limit: -8%

If realized P&L for the day hits -8% of starting capital (24 USDT in 300 USDT mode), **stop trading until tomorrow UTC+8 midnight**. Existing positions still get monitored.

### Total drawdown kill switch: -20%

If the account drops 20% from its starting balance (60 USDT in 300 USDT mode), **close all positions and halt permanently**. Manual intervention required to restart.

## Position sizing: 20% max

- Max position size: **20% of capital** (60 USDT in 300 USDT mode)
- Min position size: **30 USDT** (below this, fees eat the trade)
- Max concurrent positions: **2**
- Max total exposure: **60% of capital** (180 USDT)

This means in normal operation, Àkànjí never has more than 120 USDT in the market at once, with 180 USDT always kept in reserve.

## What Àkànjí does NOT do

- ❌ Use an LLM in the decision path (too slow, too expensive, too non-deterministic)
- ❌ Adapt or "learn" mid-competition (all rules are hardcoded)
- ❌ Override the risk limits (no exceptions, ever)
- ❌ Hold positions overnight without TP/SL
- ❌ Trade tokens with <$10K liquidity or <1 day age

## The 5-minute rule

If a signal passes the threshold, but Àkànjí can't enter within 5 minutes (e.g. network issue, exchange lag), the signal is **discarded**. Stale signals = bad trades.

---

*This is discipline. It is not genius. It is not alpha. It is the opposite of YOLO. The market rewards consistency, not luck.*
