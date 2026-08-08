/**
 * Signal scorer — combines signals into a 0-5 score
 */

import type { TokenSignals, TokenScore, MarketData, Side } from '../types.js';
import { tradingConfig } from '../config.js';

/**
 * Score a token's signals.
 *
 * Scoring:
 *   - 3+ whales: +2 (strongest signal)
 *   - 1-2 whales: +1
 *   - volume spike: +1
 *   - price up: +1
 *   - new pool: +1
 *   - social buzz: +0.5 (weakest, easy to fake)
 *
 * Enter threshold: score >= 3
 */
export function scoreSignals(signals: TokenSignals): TokenScore {
  let score = 0;

  if (signals.whaleCount >= 3) score += 2;
  else if (signals.whaleCount >= 1) score += 1;

  if (signals.volumeSpike) score += 1;
  if (signals.priceUp) score += 1;
  if (signals.newPool) score += 1;
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
 */
export function passesFilters(market: MarketData): { ok: boolean; reason?: string } {
  if (market.liquidityUSD < 10_000) {
    return { ok: false, reason: `liquidity too low: $${market.liquidityUSD.toFixed(0)}` };
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
