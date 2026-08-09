import { describe, it, expect } from 'vitest';
import { passesFilters } from '../src/strategy/scorer.js';
import type { MarketData } from '../src/types.js';

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

describe('passesFilters — pre-trade safety', () => {
  it('rejects liquidity below $25K', () => {
    const r = passesFilters(makeMarket({ liquidityUSD: 24_999 }));
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/liquidity/);
  });

  it('accepts liquidity at $25K', () => {
    expect(passesFilters(makeMarket({ liquidityUSD: 25_000 })).ok).toBe(true);
  });

  it('rejects token less than 1 day old', () => {
    const r = passesFilters(makeMarket({ age: 0.5 }));
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/new/);
  });

  it('accepts token 1+ days old', () => {
    expect(passesFilters(makeMarket({ age: 1 })).ok).toBe(true);
  });

  it('rejects thin 24h volume (< $50K)', () => {
    const r = passesFilters(makeMarket({ volume24h: 49_999 }));
    expect(r.ok).toBe(false);
  });

  it('rejects crash (-50% in 24h)', () => {
    const r = passesFilters(makeMarket({ priceChange24h: -0.51 }));
    expect(r.ok).toBe(false);
  });

  it('rejects vertical pump (+200% in 24h)', () => {
    const r = passesFilters(makeMarket({ priceChange24h: 2.1 }));
    expect(r.ok).toBe(false);
  });

  it('accepts a healthy mature token', () => {
    expect(passesFilters(makeMarket()).ok).toBe(true);
  });
});
