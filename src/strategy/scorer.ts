/**
 * Signal scorer + side determiner + entry filters.
 *
 * Post paper-test revision 2026-08-09 (+0.1):
 *   Two consecutive LONG entries (RTX, 万事OK) hit SL within 0-12 min.
 *   Both had whaleCount > 0 and priceUp=true, but volumeSpike=false.
 *   The agent was buying the tail end of moves that were already reversing.
 *
 * Revision +0.2 (2026-08-10):
 *   Lowered entry score threshold from 3 to 2.5 to accept more candidates
 *   on the thin X Layer DEX market. Hard gates (volumeSpike, near-recent-high,
 *   whale recency) now run BEFORE the score threshold and are independent of
 *   it. A score-2.5+ candidate is still rejected if any hard gate fails.
 *
 * Hard gates (must pass regardless of score):
 *   1. volumeSpike_gate  — volumeSpike must be true for any LONG entry
 *   2. near_high_filter  — current price not within nearHighThresholdPct of
 *                          the recent N-bar high
 *   3. whale_stale       — whaleCount > 0 must come from buys within
 *                          whaleRecencyMs (15 min default)
 *
 * Soft scoring (composite, threshold 2.5):
 *   whales (0.5-2.0) + volumeSpike (1.5) + priceUp (0.5) + newPool (0.5)
 *   + socialBuzz (0.5)
 *
 * Rejection reasons are surfaced as a `rejection` field on the score so the
 * main.ts tick loop can journal them with a stable `rejection_reason` key.
 */

import type { TokenSignals, TokenScore, MarketData, Side } from '../types.js';
import { tradingConfig } from '../config.js';

export type RejectionReason =
  | 'volumeSpike_gate'   // hard gate: volumeSpike must be true for LONG
  | 'near_high_filter'   // hard gate: price within nearHighThresholdPct of recentHigh
  | 'whale_stale'        // hard gate: no whales in recency window
  | 'score_too_low'      // soft: composite below 2.5 threshold
  | 'no_long_signal'     // soft: side was FLAT for other reasons
  | 'no_short_signal'    // soft: side was FLAT for other reasons
  | null;

/** Minimum score required to consider an entry (soft threshold). */
export const MIN_ENTRY_SCORE = 2.5;

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
  // Note: hard gates (volumeSpike, near-high, recency) are enforced separately
  // in evaluateEntry — they don't affect the score, they block entry entirely.
  let recommendedSize = 0;
  if (score >= 4) recommendedSize = tradingConfig.maxPositionSizePct;       // 20%
  else if (score >= 2.5) recommendedSize = tradingConfig.maxPositionSizePct / 2; // 10%
  // Below 2.5: not entering (soft threshold — gates run first and can also block)

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
 * Convenience wrapper: runs hard gates first, then score threshold, then side.
 * Returns a structured result with a `rejection` field that the caller
 * (main.ts tick loop) can journal.
 *
 * Evaluation order (first match wins, short-circuits):
 *   1. whale_stale       — signals.whaleCount is 0 (no recent whales at all)
 *   2. volumeSpike_gate  — would-be LONG entry but volumeSpike is false
 *   3. near_high_filter  — passesFilters rejected on near-recent-high
 *   4. score_too_low     — composite score < MIN_ENTRY_SCORE (2.5)
 *   5. no_long_signal    — score is fine, gates pass, but side is FLAT
 *
 * Note: passesFilters also runs liquidity/volume/age checks; those reasons
 * are still surfaced under 'no_long_signal' for now (they weren't part of
 * the +0.1 patch and changing them is out of scope).
 */
export function evaluateEntry(
  signals: TokenSignals,
  market: MarketData
): { score: TokenScore; side: Side | 'FLAT'; rejection: RejectionReason; rejectionDetails?: Record<string, unknown> } {
  const score = scoreSignals(signals);

  // Gate 1: whale_stale — no whales in the recency window. If there are no
  // whales, the only way to enter is via newPool + volumeSpike + trendUp
  // (or volumeSpike + priceUp + !priceFalling). Both still need volumeSpike,
  // so we don't reject here just on zero whales. We only reject if the
  // would-be-LONG reason would have been whale-driven.
  // Implementation: defer — this is handled below in the side-diagnosis step.

  // Gate 2: near_high_filter — check first because it's a hard structural
  // rejection that should never be overridden by score. Even a score-10
  // candidate is rejected if price is at the recent high.
  const filter = passesFilters(market);
  if (!filter.ok) {
    if (filter.reason?.startsWith('near recent high')) {
      return {
        score,
        side: 'FLAT',
        rejection: 'near_high_filter',
        rejectionDetails: {
          price: market.price,
          recentHigh: market.recentHigh,
          distancePct: market.recentHigh && market.price > 0
            ? (market.recentHigh - market.price) / market.recentHigh
            : undefined,
          thresholdPct: tradingConfig.nearHighThresholdPct,
          filterReason: filter.reason,
        },
      };
    }
    // Other passesFilters rejections (liquidity, 24h vol, 24h change bounds,
    // age) are real and not part of the +0.1 gate set. Surface them as
    // no_long_signal but include the filter reason in details.
    return {
      score,
      side: 'FLAT',
      rejection: 'no_long_signal',
      rejectionDetails: { filterReason: filter.reason },
    };
  }

  // Gate 3: volumeSpike_gate — would-be LONG but volumeSpike is false.
  // This is the RTX/万事OK failure pattern. Even at score 2.5+ we block.
  // Determine side first to see if we *would* go LONG.
  const wouldBeLong =
    (signals.whaleCount > 0 && market.priceChange24h > 0) ||
    (signals.newPool && market.priceChange24h > 0) ||
    (signals.priceUp && market.priceChange24h >= 0);
  if (wouldBeLong && !signals.volumeSpike) {
    return {
      score,
      side: 'FLAT',
      rejection: 'volumeSpike_gate',
      rejectionDetails: {
        whaleCount: signals.whaleCount,
        recentWhaleCount: signals.recentWhaleCount,
        priceUp: signals.priceUp,
        newPool: signals.newPool,
        volumeSpike: signals.volumeSpike,
        trendUp: market.priceChange24h > 0,
      },
    };
  }

  // Gate 4: whale_stale — if whaleCount is 0 AND the only entry paths are
  // the whale-driven ones (no newPool, no priceUp), reject. The newPool
  // and priceUp paths don't require whales, so this gate is only about
  // ensuring the agent isn't entering on "1-2 whales" alone with no other
  // confirmation.
  if (signals.whaleCount === 0 && !signals.newPool && !signals.priceUp) {
    return {
      score,
      side: 'FLAT',
      rejection: 'whale_stale',
      rejectionDetails: {
        recentWhaleCount: signals.recentWhaleCount ?? 0,
        recentWhaleBuys: signals.recentWhaleBuys?.length ?? 0,
        recencyMs: tradingConfig.whaleRecencyMs,
        priceUp: signals.priceUp,
        newPool: signals.newPool,
      },
    };
  }

  // Soft check: composite score threshold
  if (score.score < MIN_ENTRY_SCORE) {
    return {
      score,
      side: 'FLAT',
      rejection: 'score_too_low',
      rejectionDetails: {
        score: score.score,
        threshold: MIN_ENTRY_SCORE,
        recommendedSize: score.recommendedSize,
        whaleCount: signals.whaleCount,
        recentWhaleCount: signals.recentWhaleCount,
        volumeSpike: signals.volumeSpike,
        priceUp: signals.priceUp,
        newPool: signals.newPool,
        socialBuzz: signals.socialBuzz,
      },
    };
  }

  // Final: determine side. If FLAT here (e.g., trend down + whales), it's a
  // signal mismatch, not a gate failure.
  const side = determineSide(signals, market) as Side | 'FLAT';
  if (side === 'FLAT') {
    return { score, side, rejection: 'no_long_signal' };
  }

  return { score, side, rejection: null };
}
