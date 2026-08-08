/**
 * Stop / take-profit logic
 *
 * Pure functions — given position state + current price, decide what action to take.
 */

import type { Position, ExitReason } from '../types.js';
import { tradingConfig } from '../config.js';

export type StopAction =
  | { type: 'HOLD' }
  | { type: 'CLOSE_TP1'; reason: 'TP1' }
  | { type: 'CLOSE_TP2'; reason: 'TP2' }
  | { type: 'CLOSE_SL'; reason: 'SL' }
  | { type: 'CLOSE_TRAIL'; reason: 'TRAIL' }
  | { type: 'CLOSE_TIME'; reason: 'TIME' };

/**
 * Calculate P&L percentages for a position.
 */
export function calcPnL(position: Position, currentPrice: number): { pnlUSDT: number; pnlPct: number } {
  const direction = position.side === 'LONG' ? 1 : -1;
  const pnlPct = ((currentPrice - position.entryPrice) / position.entryPrice) * direction;
  const pnlUSDT = position.sizeUSDT * pnlPct;
  return { pnlUSDT, pnlPct };
}

/**
 * Decide what action to take on a position, given current state.
 */
export function evaluatePosition(position: Position, currentPrice: number, now: number): StopAction {
  const { pnlPct } = calcPnL(position, currentPrice);
  const heldHours = (now - position.openTime) / (1000 * 60 * 60);

  // 1. Hard stop loss (highest priority) — use epsilon for float safety
  if (pnlPct <= -tradingConfig.stopLossPct - 1e-9) {
    return { type: 'CLOSE_SL', reason: 'SL' };
  }

  // 2. TP1 — close 50% at first target
  if (pnlPct >= tradingConfig.takeProfit1Pct - 1e-9 && position.state === 'HOLDING') {
    return { type: 'CLOSE_TP1', reason: 'TP1' };
  }

  // 3. TP2 — close 100% at full target
  if (pnlPct >= tradingConfig.takeProfit2Pct - 1e-9) {
    return { type: 'CLOSE_TP2', reason: 'TP2' };
  }

  // 3. Trailing stop — once activated, close if price retraces
  if (position.trailingStopActive) {
    // trailing stop is encoded as: if current SL was ratcheted up to a certain level,
    // close if price drops back to that level
    // For simplicity, we use a fixed trailing distance from the high
    if (pnlPct < tradingConfig.trailingStopDistancePct) {
      return { type: 'CLOSE_TRAIL', reason: 'TRAIL' };
    }
  }

  // 4. Time stop — flat position held too long
  if (heldHours >= tradingConfig.timeStopHours && Math.abs(pnlPct) < 0.02) {
    return { type: 'CLOSE_TIME', reason: 'TIME' };
  }

  return { type: 'HOLD' };
}

/**
 * After TP1 fires, update the position for the remaining 50%:
 *   - Move stop loss to breakeven
 *   - Activate trailing stop
 *   - Halve the remaining size
 */
export function onTP1Hit(position: Position): Position {
  return {
    ...position,
    state: 'TP1_HIT',
    sizeUSDT: position.sizeUSDT / 2,  // half was closed
    stopLoss: position.entryPrice,    // breakeven
    trailingStopActive: true,
  };
}

/**
 * Check if trailing stop should be activated (after enough profit).
 */
export function shouldActivateTrailing(position: Position, currentPrice: number): boolean {
  const { pnlPct } = calcPnL(position, currentPrice);
  return pnlPct >= tradingConfig.trailingStopActivationPct && !position.trailingStopActive;
}
