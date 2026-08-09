import { describe, it, expect } from 'vitest';
import { scoreSignals, determineSide, passesFilters, computePositionSize } from '../src/strategy/scorer.js';
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

describe('scorer', () => {
  it('whales + volume = strong enter (score 3, size 10%)', () => {
    const s = scoreSignals(makeSignals({ whaleCount: 3, volumeSpike: true }));
    expect(s.score).toBe(3);
    expect(s.recommendedSize).toBe(0.10);
  });

  it('whales only = wait (score 2, no entry)', () => {
    const s = scoreSignals(makeSignals({ whaleCount: 5 }));
    expect(s.score).toBe(2);
    expect(s.recommendedSize).toBe(0);
  });

  it('volume spike only = wait (score 1.5, no entry)', () => {
    const s = scoreSignals(makeSignals({ volumeSpike: true }));
    expect(s.score).toBe(1.5);
    expect(s.recommendedSize).toBe(0);
  });

  it('new pool alone = too risky (score 0.5, no entry)', () => {
    const s = scoreSignals(makeSignals({ newPool: true }));
    expect(s.score).toBe(0.5);
    expect(s.recommendedSize).toBe(0);
  });

  it('4 strong signals = strong enter (size 20%)', () => {
    const s = scoreSignals(makeSignals({ whaleCount: 3, volumeSpike: true, priceUp: true, newPool: true }));
    expect(s.score).toBe(4);
    expect(s.recommendedSize).toBe(0.20);
  });

  it('social buzz alone is too weak (score 0.5, no entry)', () => {
    const s = scoreSignals(makeSignals({ socialBuzz: true }));
    expect(s.score).toBe(0.5);
    expect(s.recommendedSize).toBe(0);
  });

  it('1-2 whales is weaker than 5+ whales', () => {
    const a = scoreSignals(makeSignals({ whaleCount: 1 })).score;
    const b = scoreSignals(makeSignals({ whaleCount: 2 })).score;
    const c = scoreSignals(makeSignals({ whaleCount: 3 })).score;
    const d = scoreSignals(makeSignals({ whaleCount: 5 })).score;
    expect(a).toBe(0.5);
    expect(b).toBe(0.5);
    expect(c).toBe(1.5);
    expect(d).toBe(2);
  });
});

describe('determineSide', () => {
  it('trend up + whales = LONG', () => {
    const side = determineSide(makeSignals({ whaleCount: 3 }), makeMarket({ priceChange24h: 0.05 }));
    expect(side).toBe('LONG');
  });

  it('trend down + whales + falling = SHORT', () => {
    const side = determineSide(makeSignals({ whaleCount: 3 }), makeMarket({ priceChange24h: -0.10 }));
    expect(side).toBe('SHORT');
  });

  it('conflicting signals = FLAT', () => {
    const side = determineSide(makeSignals({ whaleCount: 0, volumeSpike: true }), makeMarket({ priceChange24h: 0 }));
    expect(side).toBe('FLAT');
  });

  it('no signals = FLAT', () => {
    expect(determineSide(makeSignals(), makeMarket())).toBe('FLAT');
  });
});

describe('passesFilters', () => {
  it('rejects low liquidity', () => {
    const r = passesFilters(makeMarket({ liquidityUSD: 5_000 }));
    expect(r.ok).toBe(false);
  });

  it('rejects very new tokens', () => {
    const r = passesFilters(makeMarket({ age: 0.5 }));
    expect(r.ok).toBe(false);
  });

  it('rejects thin volume', () => {
    const r = passesFilters(makeMarket({ volume24h: 10_000 }));
    expect(r.ok).toBe(false);
  });

  it('rejects crash (24h drop > 50%)', () => {
    const r = passesFilters(makeMarket({ priceChange24h: -0.6 }));
    expect(r.ok).toBe(false);
  });

  it('rejects vertical pump (24h > 200%)', () => {
    const r = passesFilters(makeMarket({ priceChange24h: 3.0 }));
    expect(r.ok).toBe(false);
  });

  it('accepts healthy token', () => {
    expect(passesFilters(makeMarket()).ok).toBe(true);
  });
});

describe('computePositionSize', () => {
  it('caps at max position size', () => {
    const size = computePositionSize(1000, 0.50);
    expect(size).toBeLessThanOrEqual(60);  // MAX_POSITION_SIZE_USDT
  });

  it('returns 0 if below min size', () => {
    const size = computePositionSize(100, 0.05);  // 5 USDT < 30 min
    expect(size).toBe(0);
  });
});
