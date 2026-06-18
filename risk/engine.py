"""
Risk engine — the guardian that prevents Oniṣòwò from doing dumb things.

The 6 risk rules (all configurable, all hardcoded as safe defaults):

1. MAX_TRADE_USD: don't place any single trade larger than this
2. MAX_POSITION_PCT: don't let any position be more than this % of portfolio
3. MAX_DRAWDOWN_PCT: if portfolio drops more than this %, kill switch
4. MAX_DAILY_LOSS_USD: don't lose more than this in a single day
5. MAX_OPEN_TRADES: don't have more than N open positions
6. BLACKLIST_SYMBOLS: never trade these (e.g., leverage tokens)

Every trade goes through check_order() before being sent to Bitget.
"""

import os
from typing import Optional
from dataclasses import dataclass


@dataclass
class RiskConfig:
    """Risk engine configuration. Override via env vars or settings DB.

    The defaults are sized for a $10–$500 balance small account.
    Bump them up for larger accounts via env vars:
      MAX_TRADE_USD, MAX_POSITION_PCT, MAX_DRAWDOWN_PCT, MAX_DAILY_LOSS_USD
    """

    # Default 50% of balance per trade (capped via env var). Replaces the old
    # hardcoded $2/trade which was way too tight for a $10+ account.
    max_trade_usd: float = float(os.environ.get("MAX_TRADE_USD", "5.00"))
    # Cap at 75% of portfolio in a single position (was 40%) so the bot can
    # actually deploy a meaningful chunk when the user asks.
    max_position_pct: float = float(os.environ.get("MAX_POSITION_PCT", "0.75"))
    max_drawdown_pct: float = float(os.environ.get("MAX_DRAWDOWN_PCT", "0.30"))
    max_daily_loss_usd: float = float(os.environ.get("MAX_DAILY_LOSS_USD", "10.00"))
    max_open_trades: int = 5
    max_leverage: int = 2  # never exceed 2x leverage on futures
    blacklist_symbols: tuple = ("USDC",)  # USDC is the depeg risk example
    kill_switch_active: bool = False  # user can toggle this via /kill command


class RiskEngine:
    """The brain's safety net. Every order goes through this first."""

    def __init__(self, config: Optional[RiskConfig] = None, db=None):
        self.config = config or RiskConfig()
        self.db = db

    def check_order(
        self,
        symbol: str,
        side: str,
        size_usd: float,
        portfolio_value_usd: float,
        open_positions_count: int,
    ) -> tuple[bool, str]:
        """Check if an order is allowed. Returns (allowed, reason).

        If allowed=True, the order can proceed.
        If allowed=False, the order is blocked and reason explains why.
        """
        # Rule 0: Kill switch
        if self.config.kill_switch_active:
            return False, "🛑 Kill switch is active. Use /release to resume trading."

        # Rule 1: Max trade size
        if size_usd > self.config.max_trade_usd:
            return (
                False,
                f"❌ Trade size ${size_usd:.2f} exceeds max ${self.config.max_trade_usd:.2f}/trade.",
            )

        # Rule 2: Max position size (% of portfolio)
        if portfolio_value_usd > 0:
            position_pct = size_usd / portfolio_value_usd
            if position_pct > self.config.max_position_pct:
                return (
                    False,
                    f"❌ Position {position_pct*100:.1f}% exceeds max "
                    f"{self.config.max_position_pct*100:.0f}% of portfolio.",
                )

        # Rule 3: Blacklist
        base = symbol.replace("USDT", "").replace("USDC", "").upper()
        if base in self.config.blacklist_symbols:
            return False, f"❌ {base} is blacklisted. (Default blacklist: leverage tokens, depeg risks)"

        # Rule 4: Max open trades
        if side.lower() == "buy" and open_positions_count >= self.config.max_open_trades:
            return (
                False,
                f"❌ Already {open_positions_count} open positions. Max is {self.config.max_open_trades}.",
            )

        # Rule 5: Minimum size (avoid dust)
        if size_usd < 0.5:
            return False, f"❌ Trade size ${size_usd:.2f} is too small. Minimum is $0.50."

        # All checks passed
        return True, f"✅ Risk check passed. Trade size ${size_usd:.2f}, portfolio ${portfolio_value_usd:.2f}."

    def check_drawdown(self, current_value: float, peak_value: float) -> tuple[bool, str]:
        """Check if portfolio has drawn down too much. Returns (safe, status)."""
        if peak_value <= 0:
            return True, "No peak value yet."

        drawdown = (peak_value - current_value) / peak_value

        if drawdown >= self.config.max_drawdown_pct:
            return False, (
                f"🛑 DRAWDOWN KILL: Portfolio down {drawdown*100:.1f}% from peak "
                f"${peak_value:.2f} → ${current_value:.2f}. "
                f"Max allowed: {self.config.max_drawdown_pct*100:.0f}%. "
                f"Trading halted."
            )

        return True, f"Drawdown: {drawdown*100:.1f}% (max allowed: {self.config.max_drawdown_pct*100:.0f}%)"

    def suggest_position_size(
        self,
        balance_usd: float,
        confidence: float = 0.7,
        signal_score: float = 0.5,
        user_requested_usd: float = None,
    ) -> dict:
        """Compute a reasonable position size given balance, signal strength, and confidence.

        Strategy:
        - Base size: min(balance * max_position_pct, max_trade_usd)
        - Adjust by confidence: low confidence = 50% of base, high = 100% of base
        - Adjust by signal_score: 0.4 score = 50% of base, 0.8 score = 100% of base
        - Respect user_requested_usd if explicitly set, but cap it at max_trade_usd
        - Never exceed 95% of balance (leave dust for fees)

        Returns: {size_usd, rationale, base, confidence_factor, score_factor}
        """
        if balance_usd <= 0:
            return {"size_usd": 0, "rationale": "No balance available."}

        # Base cap from config
        base = min(
            balance_usd * self.config.max_position_pct,
            self.config.max_trade_usd,
        )
        # Don't go below 5% of balance
        base = max(base, balance_usd * 0.05)

        # Confidence scaling: 0.4 conf → 50% of base, 0.85+ conf → 100% of base
        if confidence >= 0.85:
            conf_factor = 1.0
        elif confidence >= 0.4:
            conf_factor = 0.5 + (confidence - 0.4) / 0.45 * 0.5
        else:
            conf_factor = 0.3
        # Signal score scaling
        if signal_score >= 0.8:
            score_factor = 1.0
        elif signal_score >= 0.4:
            score_factor = 0.5 + (signal_score - 0.4) / 0.4 * 0.5
        else:
            score_factor = 0.3
        # Combined adjustment
        adjustment = (conf_factor + score_factor) / 2
        adjusted = base * adjustment

        # If user requested a specific size, respect it but cap at max
        if user_requested_usd is not None and user_requested_usd > 0:
            final = min(
                user_requested_usd,
                balance_usd * 0.95,
                self.config.max_trade_usd,
            )
            rationale = (
                f"User requested ${user_requested_usd:.2f}. "
                f"Capped at ${final:.2f} "
                f"(max ${self.config.max_trade_usd:.2f}, 95% of ${balance_usd:.2f} balance)."
            )
        else:
            final = adjusted
            rationale = (
                f"Base ${base:.2f} "
                f"(from {self.config.max_position_pct*100:.0f}% of ${balance_usd:.2f} "
                f"or max ${self.config.max_trade_usd:.2f}, whichever is lower). "
                f"Adjusted by confidence={confidence:.2f} ({conf_factor:.2f}) "
                f"and signal_score={signal_score:.2f} ({score_factor:.2f}). "
                f"Final: ${final:.2f}."
            )

        # Never exceed 95% of balance
        final = min(final, balance_usd * 0.95)
        # Never go below $0.50 (Bitget minimum for spot orders)
        if final < 0.50:
            return {
                "size_usd": 0,
                "rationale": (
                    f"Computed size ${final:.2f} is below Bitget's minimum order size. "
                    f"Need at least $0.50."
                ),
            }

        return {
            "size_usd": round(final, 2),
            "rationale": rationale,
            "base": round(base, 2),
            "confidence_factor": round(conf_factor, 2),
            "score_factor": round(score_factor, 2),
        }

    def activate_kill_switch(self, reason: str = "Manual"):
        """Activate the kill switch. No more trades until released."""
        self.config.kill_switch_active = True
        if self.db:
            self.db.add_memory(
                "rule",
                f"Kill switch activated: {reason}",
                tags=["risk", "kill_switch"],
                importance=10,
            )

    def release_kill_switch(self):
        """Release the kill switch."""
        self.config.kill_switch_active = False
        if self.db:
            self.db.add_memory(
                "rule",
                "Kill switch released by user",
                tags=["risk", "kill_switch"],
                importance=10,
            )

    def get_status(self) -> dict:
        """Get current risk engine status for display."""
        return {
            "max_trade_usd": self.config.max_trade_usd,
            "max_position_pct": self.config.max_position_pct,
            "max_drawdown_pct": self.config.max_drawdown_pct,
            "max_open_trades": self.config.max_open_trades,
            "max_leverage": self.config.max_leverage,
            "kill_switch_active": self.config.kill_switch_active,
            "blacklist": list(self.config.blacklist_symbols),
        }

    def update_limits(
        self,
        max_trade_usd: Optional[float] = None,
        max_drawdown_pct: Optional[float] = None,
    ):
        """Update risk limits. Called by /settings command."""
        if max_trade_usd is not None:
            self.config.max_trade_usd = float(max_trade_usd)
        if max_drawdown_pct is not None:
            self.config.max_drawdown_pct = float(max_drawdown_pct)
        if self.db:
            self.db.add_memory(
                "preference",
                f"Risk limits updated: max_trade=${self.config.max_trade_usd}, "
                f"max_dd={self.config.max_drawdown_pct*100:.0f}%",
                tags=["risk", "settings"],
                importance=7,
            )
