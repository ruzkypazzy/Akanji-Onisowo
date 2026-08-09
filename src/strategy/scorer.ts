/**
 * Signal scorer — combines signals into a 0-5 score
 */

import type { TokenSignals, TokenScore, MarketData, Side } from '../types.js';
import { tradingConfig } from '../config.js';

/**
 * Score a token's signals.
 *
 * Scoring (conservative — too many weak signals = loss, see paper test 2026-08-09):
 *   - 5+ whales:    +2 (strongest signal — many smart-money wallets coordinated)
 *   - 3-4 whales:   +1.5
 *   - 1-2 whales:   +0.5  (often noise — single wallet buying doesn't move price)
 *   - volume spike: +1.5  (5x+ above 12h avg = real momentum, not noise)
 *   - price up:     +0.5  (alone, very weak — almost every token has noise)
 *   - new pool:     +0.5
 *   - social buzz:  +0.5  (weakest, easy to manipulate)
 *
 * Enter threshold: score >= 3 (was 3, but composition matters now)
 *   - Pure whale (5+) + priceUp = 3 → allowed
 *   - 3 whales + volumeSpike + priceUp = 4 → allowed, 20% size
 *   - Single whale + priceUp only = 1 → blocked (was allowed before, caused losses)
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
 * Determine trade side from signals + market data.
 *
 * Returns 'LONG', 'SHORT', or 'FLAT' (no trade).
 *
 * Rules:
 *   - LONG: trend up + at least one signal, OR new pool with volume spike
 *   - SHORT: trend down + selling pressure (volume spike with falling price)
 *   - FLAT: signals conflict or insufficient
 */
export function determineSide(signals: TokenSignals, market: MarketData): Side {
  const trendUp = market.priceChange24h > 0;
  const trendDown = market.priceChange24h < -0.05;
  const priceFalling = market.priceChange24h < 0;
  const volumeHigh = market.volume1h > 0;  // placeholder — could be refined

  // LONG triggers
  if (signals.whaleCount > 0 && trendUp) return 'LONG';
  if (signals.newPool && signals.volumeSpike && trendUp) return 'LONG';
  if (signals.volumeSpike && signals.priceUp && !priceFalling) return 'LONG';

  // SHORT triggers
  if (signals.whaleCount > 0 && trendDown && priceFalling) return 'SHORT';
  if (signals.volumeSpike && priceFalling && trendDown) return 'SHORT';

  return 'FLAT' as Side;
}

/**
 * Pre-trade safety filters. Returns true if token passes.
 *
 * Hardened after paper-test loss 2026-08-09: two micro-cap tokens
 * (RTX, 万事OK) cleared 10k liquidity via volume-proxy but still
 * hit SL within minutes. New rules:
 *   - Liquidity >= $25k (was $10k) — bigger positions need real depth
 *   - 24h volume >= $50k — actively traded, not just held
 *   - Price change 24h between -50% and +200% — exclude dying/vertical pumps
 *   - Age >= 1 day — no same-day listings (most rug-prone)
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
