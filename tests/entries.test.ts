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

describe('determineSide — entry-side signal gating (post 2026-08-09 paper loss)', () => {
  it('LONG: trend up + whales + volumeSpike → LONG', () => {
    expect(determineSide(
      makeSignals({ whaleCount: 3, volumeSpike: true }),
      makeMarket({ priceChange24h: 0.05 })
    )).toBe('LONG');
  });

  it('LONG: trend up + whales WITHOUT volumeSpike → FLAT (the RTX/万事OK failure pattern)', () => {
    // Post paper-test revision: whale-driven LONG requires volume confirmation.
    // 16 whales + priceUp + no vol spike = the exact losing entry shape.
    const side = determineSide(
      makeSignals({ whaleCount: 16, priceUp: true }),
      makeMarket({ priceChange24h: 0.05 })
    );
    expect(side).toBe('FLAT');
  });

  it('SHORT: trend down + whales + falling → SHORT (this is the bug Àkànjí had)', () => {
    const side = determineSide(makeSignals({ whaleCount: 3 }), makeMarket({ priceChange24h: -0.10 }));
    expect(side).toBe('SHORT');
  });

  it('SHORT: volume spike + falling price → SHORT', () => {
    const side = determineSide(makeSignals({ volumeSpike: true }), makeMarket({ priceChange24h: -0.10 }));
    expect(side).toBe('SHORT');
  });

  it('FLAT: no signals, neutral market', () => {
    expect(determineSide(makeSignals(), makeMarket())).toBe('FLAT');
  });

  it('FLAT: conflicting signals (whales but flat price, no vol spike)', () => {
    expect(determineSide(makeSignals({ whaleCount: 3 }), makeMarket({ priceChange24h: 0 }))).toBe('FLAT');
  });

  it('SHORT signal at exactly -5% (boundary) → FLAT (needs >5% drop)', () => {
    const side = determineSide(makeSignals({ whaleCount: 3 }), makeMarket({ priceChange24h: -0.05 }));
    expect(side).toBe('FLAT');
  });
});
