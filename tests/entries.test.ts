import { describe, it, expect } from 'vitest';
import { determineSide } from '../src/strategy/scorer.js';
import type { TokenSignals, MarketData } from '../src/types.js';

function makeSignals(overrides: Partial<TokenSignals> = {}): TokenSignals {
  return {
    tokenAddress: '0xtoken',
    whaleCount: 0,
    volumeSpike: false,
    priceUp: false,
    newPool: false,
    socialBuzz: false,
    ...overrides,
  };
}

function makeMarket(overrides: Partial<MarketData> = {}): MarketData {
  return {
    tokenAddress: '0xtoken',
    price: 1.0,
    volume1h: 100_000,
    volume24h: 1_000_000,
    priceChange24h: 0,
    liquidityUSD: 100_000,
    age: 30,
    ...overrides,
  };
}

describe('determineSide — would have caught the SHORT bug', () => {
  it('LONG: trend up + whales → LONG (not just defaulting to LONG)', () => {
    expect(determineSide(makeSignals({ whaleCount: 3 }), makeMarket({ priceChange24h: 0.05 }))).toBe('LONG');
  });

  it('SHORT: trend down + whales + falling → SHORT (this is the bug Àkànjí had)', () => {
    const side = determineSide(makeSignals({ whaleCount: 3 }), makeMarket({ priceChange24h: -0.10 }));
    expect(side).toBe('SHORT');  // not 'LONG' (the bug), not 'FLAT' (the other bug)
  });

  it('SHORT: volume spike + falling price → SHORT', () => {
    const side = determineSide(makeSignals({ volumeSpike: true }), makeMarket({ priceChange24h: -0.10 }));
    expect(side).toBe('SHORT');
  });

  it('FLAT: no signals, neutral market', () => {
    expect(determineSide(makeSignals(), makeMarket())).toBe('FLAT');
  });

  it('FLAT: conflicting signals (whales but flat price)', () => {
    expect(determineSide(makeSignals({ whaleCount: 3 }), makeMarket({ priceChange24h: 0 }))).toBe('FLAT');
  });

  it('SHORT signal at exactly -5% (boundary) → FLAT (needs >5% drop)', () => {
    // At -5% exactly, the SHORT condition `trendDown = priceChange24h < -0.05` is false
    // So it should be FLAT
    const side = determineSide(makeSignals({ whaleCount: 3 }), makeMarket({ priceChange24h: -0.05 }));
    expect(side).toBe('FLAT');
  });
});
