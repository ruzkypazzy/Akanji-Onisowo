/**
 * Signal scorer + side determiner + entry filters.
 *
 * Post paper-test revision 2026-08-09 (+0.1):
 *   Two consecutive LONG entries (RTX, 万事OK) hit SL within 0-12 min.
 *   Both had whaleCount > 0 and priceUp=true, but volumeSpike=false.
 *   The agent was buying the tail end of moves that were already reversing.
 *
 * New gates (entry-side only — risk/stops unchanged):
 *   1. determineSide LONG now requires volumeSpike when driven by whales.
 *      Whale count alone is no longer sufficient.
 *   2. passesFilters rejects "near recent high" entries via nearHighFilter.
 *      Pulls highest close from the last N 1h bars (default 5) and rejects
 *      if current price is within nearHighThresholdPct (default 2%) of it.
 *   3. countRecentWhales trims the whale count to buys within whaleRecencyMs
 *      (default 15 min), so stale 30-min-old buys don't drive entries.
 *
 * Rejection reasons are surfaced as a `rejection` field on the score so the
 * main.ts tick loop can journal them with a stable `rejection_reason` key.
 */

import type { TokenSignals, TokenScore, MarketData, Side } from '../types.js';
import { tradingConfig } from '../config.js';

export type RejectionReason =
  | 'volume_spike_required'
  | 'near_recent_high'
  | 'whales_too_stale'
  | 'no_long_signal'
  | 'no_short_signal'
  | null;

export interface ScoredWithRejection {
  score: TokenScore;
  side: Side | 'FLAT';
  rejection: RejectionReason;
  rejectionDetails?: Record<string, unknown>;
}

/**
 * Score a token's signals.
 *
 * Scoring:
 *   - 5+ whales:    +2 (strongest signal — many smart-money wallets coordinated)
 *   - 3-4 whales:   +1.5
 *   - 1-2 whales:   +0.5  (often noise — single wallet buying doesn't move price)
 *   - volume spike: +1.5  (5x+ above 12h avg = real momentum, not noise)
 *   - price up:     +0.5  (alone, very weak — almost every token has noise)
 *   - new pool:     +0.5
 *   - social buzz:  +0.5  (weakest, easy to manipulate)
 *
 * Note: `signals.whaleCount` is expected to already be filtered to recent
 * buys (last `whaleRecencyMs`) by `countRecentWhales()` upstream.
 */
export function scoreSignals(signals: TokenSignals): TokenScore {
  let score = 0;

  if (signals.whaleCount >= 5) score += 2;
  else if (signals.whaleCount >= 3) score += 1.5;
  else if (signals.whaleCount >= 1) score += 0.5;

  if (signals.volumeSpike) score += 1.5;
  if (signals.priceUp) score += 0.5;
  if (signals.newPool) score += 0.5;
  if (signals.socialBuzz) score += 0.5;

  // Size: stronger signal = larger position
  let recommendedSize = 0;
  if (score >= 4) recommendedSize = tradingConfig.maxPositionSizePct;       // 20%
  else if (score >= 3) recommendedSize = tradingConfig.maxPositionSizePct / 2; // 10%
  // Below 3: not entering

  return {
    tokenAddress: signals.tokenAddress,
    score,
    signals,
    recommendedSize,
  };
}

/**
 * Trim a list of whale buys to those within the recency window.
 * Returns the count and the filtered list. Used by signals/gatherSignals to
 * recompute `whaleCount` from a timestamped buy list.
 */
export function countRecentWhales(
  buys: { ts: number; wallet: string }[] | undefined,
  now: number = Date.now(),
  recencyMs: number = tradingConfig.whaleRecencyMs
): { recentCount: number; recentBuys: { ts: number; wallet: string }[] } {
  if (!buys || buys.length === 0) return { recentCount: 0, recentBuys: [] };
  const cutoff = now - recencyMs;
  const recent = buys.filter((b) => b.ts >= cutoff);
  return { recentCount: recent.length, recentBuys: recent };
}

/**
 * Pre-entry filter: is current price within `nearHighThresholdPct` of the
 * highest close in the last N 1h bars?
 *
 * Designed to reject entries at the top of a whale-driven pump — the kind of
 * entry where price is about to revert. Requires `market.recentHigh`.
 */
export function isNearRecentHigh(
  market: MarketData,
  thresholdPct: number = tradingConfig.nearHighThresholdPct
): { isNear: boolean; highPrice?: number; distancePct?: number } {
  if (!market.recentHigh || market.recentHigh <= 0 || market.price <= 0) {
    return { isNear: false };
  }
  const distancePct = (market.recentHigh - market.price) / market.recentHigh;
  return {
    isNear: distancePct <= thresholdPct,
    highPrice: market.recentHigh,
    distancePct,
  };
}

/**
 * Determine trade side from signals + market data.
 *
 * Returns 'LONG', 'SHORT', or 'FLAT' (no trade).
 *
 * Post paper-test revision 2026-08-09: the whale-driven LONG path is now
 * gated behind `volumeSpike`. Whale count alone is not enough — without
 * volume confirming demand, the move is already exhausted and the entry
 * becomes a tail-end loser.
 *
 *   LONG (revised rules — all require volumeSpike unless noted):
 *     1. whales + trend up + volumeSpike
 *     2. new pool + volumeSpike + trend up
 *     3. volumeSpike + priceUp + !priceFalling
 *     (Removed: "whaleCount > 0 + trendUp" — this was the failing path)
 *
 *   SHORT (unchanged):
 *     1. whales + trend down + priceFalling
 *     2. volumeSpike + priceFalling + trend down
 */
export function determineSide(signals: TokenSignals, market: MarketData): Side {
  const trendUp = market.priceChange24h > 0;
  const trendDown = market.priceChange24h < -0.05;
  const priceFalling = market.priceChange24h < 0;

  // LONG triggers — all now require volumeSpike
  if (signals.whaleCount > 0 && trendUp && signals.volumeSpike) return 'LONG';
  if (signals.newPool && signals.volumeSpike && trendUp) return 'LONG';
  if (signals.volumeSpike && signals.priceUp && !priceFalling) return 'LONG';

  // SHORT triggers (unchanged — shorting without volume is a different problem)
  if (signals.whaleCount > 0 && trendDown && priceFalling) return 'SHORT';
  if (signals.volumeSpike && priceFalling && trendDown) return 'SHORT';

  return 'FLAT' as Side;
}

/**
 * Pre-trade safety filters. Returns true if token passes.
 *
 * Hardened progressively:
 *   - Liquidity >= $25k
 *   - 24h volume >= $50k
 *   - 24h price change between -50% and +200%
 *   - Age >= 1 day
 *   - NOT within nearHighThresholdPct of recentHigh (the +0.1 fix —
 *     avoids entering right as a whale-driven pump tops out)
 */
export function passesFilters(market: MarketData): { ok: boolean; reason?: string } {
  if (market.liquidityUSD < 25_000) {
    return { ok: false, reason: `liquidity too low: $${market.liquidityUSD.toFixed(0)} < $25k` };
  }
  if (market.volume24h < 50_000) {
    return { ok: false, reason: `24h volume too low: $${market.volume24h.toFixed(0)} < $50k` };
  }
  if (market.priceChange24h < -0.50) {
    return { ok: false, reason: `24h drop too steep: ${(market.priceChange24h * 100).toFixed(1)}%` };
  }
  if (market.priceChange24h > 2.0) {
    return { ok: false, reason: `24h pump too vertical: ${(market.priceChange24h * 100).toFixed(0)}% — likely dump next` };
  }
  if (market.age < 1) {
    return { ok: false, reason: `token too new: ${market.age.toFixed(1)}d` };
  }
  const nearHigh = isNearRecentHigh(market);
  if (nearHigh.isNear) {
    return {
      ok: false,
      reason: `near recent high: $${market.price.toFixed(8)} vs high $${(nearHigh.highPrice ?? 0).toFixed(8)} (${((nearHigh.distancePct ?? 0) * 100).toFixed(2)}% below, threshold ${(tradingConfig.nearHighThresholdPct * 100).toFixed(1)}%)`,
    };
  }
  return { ok: true };
}

/**
 * Compute position size in USDT given a recommended size fraction and capital.
 * Enforces min/max from config.
 */
export function computePositionSize(capital: number, recommendedSizePct: number): number {
  const raw = capital * recommendedSizePct;
  const capped = Math.min(raw, tradingConfig.maxPositionSizeUSDT);
  if (capped < tradingConfig.minPositionSizeUSDT) return 0;  // too small, skip
  return capped;
}

/**
 * Convenience wrapper: runs scoreSignals + determineSide + passesFilters
 * and returns a structured result with a `rejection` field that the caller
 * (main.ts tick loop) can journal.
 *
 * Rejection reasons (in evaluation order, first match wins):
 *   - 'no_long_signal' / 'no_short_signal' — determineSide returned FLAT
 *     but we still passed everything else
 *   - 'volume_spike_required' — determineSide returned FLAT specifically
 *     because the whale-path LONG needs volumeSpike
 *   - 'near_recent_high' — passesFilters rejected on near-high
 *   - 'whales_too_stale' — recentWhaleCount below threshold (informational;
 *     set by the caller before invoking this function)
 */
export function evaluateEntry(
  signals: TokenSignals,
  market: MarketData
): { score: TokenScore; side: Side | 'FLAT'; rejection: RejectionReason; rejectionDetails?: Record<string, unknown> } {
  const score = scoreSignals(signals);
  const side = determineSide(signals, market) as Side | 'FLAT';

  // Pre-filter check (liquidity, volume, age, near-high)
  const filter = passesFilters(market);
  if (!filter.ok) {
    const reason: RejectionReason = filter.reason?.startsWith('near recent high')
      ? 'near_recent_high'
      : null;
    return { score, side, rejection: reason, rejectionDetails: { filterReason: filter.reason } };
  }

  if (side === 'FLAT') {
    // Diagnose why: if there were whales + priceUp but no volumeSpike,
    // call it out as volume_spike_required so the journal makes the cause clear.
    const wouldBeLongIfVolume =
      signals.whaleCount > 0 && market.priceChange24h > 0;
    if (wouldBeLongIfVolume && !signals.volumeSpike) {
      return {
        score,
        side,
        rejection: 'volume_spike_required',
        rejectionDetails: { whaleCount: signals.whaleCount, trendUp: market.priceChange24h > 0 },
      };
    }
    return { score, side, rejection: 'no_long_signal' };
  }

  return { score, side, rejection: null };
}
