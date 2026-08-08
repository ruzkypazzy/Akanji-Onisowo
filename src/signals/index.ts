/**
 * Signal sources — stub implementations.
 *
 * The real implementations will use onchainos CLI to fetch live data.
 * These stubs return deterministic test data so the rest of the system
 * can be built and tested without the CLI.
 */

import type { TokenSignals, MarketData } from '../types.js';

/**
 * Whale activity: how many top-50 wallets bought this token recently.
 * Stub: returns a fixed count for testing.
 */
export async function checkWhaleActivity(tokenAddress: string): Promise<number> {
  // TODO: replace with onchainos tracker call
  //   onchainos tracker activities --address <wallet> --type swap --chain xlayer
  return 0;
}

/**
 * Volume spike: 5x normal 1h volume?
 * Stub: always false.
 */
export async function checkVolumeSpike(tokenAddress: string): Promise<boolean> {
  // TODO: replace with onchainos market call
  return false;
}

/**
 * New pool: was this token launched recently with sufficient liquidity?
 * Stub: always false.
 */
export async function checkNewPool(tokenAddress: string): Promise<boolean> {
  // TODO: replace with onchainos memepump call
  return false;
}

/**
 * Social buzz: mention spike on X/Telegram?
 * Stub: always false.
 */
export async function checkSocialBuzz(tokenAddress: string): Promise<boolean> {
  // TODO: replace with onchainos social call
  return false;
}

/**
 * Gather all signals for a single token.
 */
export async function gatherSignals(tokenAddress: string): Promise<TokenSignals> {
  const [whaleCount, volumeSpike, newPool, socialBuzz] = await Promise.all([
    checkWhaleActivity(tokenAddress),
    checkVolumeSpike(tokenAddress),
    checkNewPool(tokenAddress),
    checkSocialBuzz(tokenAddress),
  ]);

  // priceUp is derived from volume spike + positive momentum (placeholder)
  const priceUp = volumeSpike;

  return {
    tokenAddress,
    whaleCount,
    volumeSpike,
    priceUp,
    newPool,
    socialBuzz,
  };
}

/**
 * Get market data for a token.
 * Stub: returns safe defaults.
 */
export async function getMarketData(tokenAddress: string): Promise<MarketData> {
  // TODO: replace with onchainos market call
  return {
    tokenAddress,
    price: 0,
    volume1h: 0,
    volume24h: 0,
    priceChange24h: 0,
    liquidityUSD: 0,
    age: 30,  // assume mature by default
  };
}
