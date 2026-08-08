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
  it('rejects liquidity below $10K', () => {
    const r = passesFilters(makeMarket({ liquidityUSD: 9_999 }));
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/liquidity/);
  });

  it('accepts liquidity exactly $10K', () => {
    expect(passesFilters(makeMarket({ liquidityUSD: 10_000 })).ok).toBe(true);
  });

  it('rejects token less than 1 day old', () => {
    const r = passesFilters(makeMarket({ age: 0.5 }));
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/new/);
  });

  it('accepts token 1+ days old', () => {
    expect(passesFilters(makeMarket({ age: 1 })).ok).toBe(true);
  });

  it('accepts a healthy mature token', () => {
    expect(passesFilters(makeMarket()).ok).toBe(true);
  });
});
