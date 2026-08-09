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
  it('trend up + whales + volumeSpike = LONG', () => {
    const side = determineSide(
      makeSignals({ whaleCount: 3, volumeSpike: true }),
      makeMarket({ priceChange24h: 0.05 })
    );
    expect(side).toBe('LONG');
  });

  it('trend up + whales WITHOUT volumeSpike = FLAT (volume gate required)', () => {
    // Post paper-test revision: whale-driven LONG requires volume confirmation.
    // This is the exact failure pattern of RTX (16 whales, no vol spike) and 万事OK.
    const side = determineSide(
      makeSignals({ whaleCount: 16, priceUp: true }),
      makeMarket({ priceChange24h: 0.05 })
    );
    expect(side).toBe('FLAT');
  });

  it('trend down + whales + falling = SHORT', () => {
    const side = determineSide(makeSignals({ whaleCount: 3 }), makeMarket({ priceChange24h: -0.10 }));
    expect(side).toBe('SHORT');
  });

  it('volumeSpike + priceUp + !priceFalling = LONG (works without whales)', () => {
    const side = determineSide(
      makeSignals({ volumeSpike: true, priceUp: true }),
      makeMarket({ priceChange24h: 0.02 })
    );
    expect(side).toBe('LONG');
  });

  it('conflicting signals = FLAT', () => {
    const side = determineSide(makeSignals({ whaleCount: 0, volumeSpike: true }), makeMarket({ priceChange24h: 0 }));
    expect(side).toBe('FLAT');
  });

  it('no signals = FLAT', () => {
    expect(determineSide(makeSignals(), makeMarket())).toBe('FLAT');
  });
});

describe('countRecentWhales — recency window for whale buys', () => {
  it('keeps only buys within the recency window', async () => {
    const { countRecentWhales } = await import('../src/strategy/scorer.js');
    const now = 1_000_000_000_000;
    const buys = [
      { ts: now - 5 * 60 * 1000, wallet: 'a' },     // 5 min ago — keep
      { ts: now - 12 * 60 * 1000, wallet: 'b' },    // 12 min ago — keep
      { ts: now - 20 * 60 * 1000, wallet: 'c' },    // 20 min ago — drop
      { ts: now - 60 * 60 * 1000, wallet: 'd' },    // 60 min ago — drop
    ];
    const { recentCount, recentBuys } = countRecentWhales(buys, now, 15 * 60 * 1000);
    expect(recentCount).toBe(2);
    expect(recentBuys.map((b) => b.wallet).sort()).toEqual(['a', 'b']);
  });

  it('returns 0 for empty/undefined input', async () => {
    const { countRecentWhales } = await import('../src/strategy/scorer.js');
    expect(countRecentWhales(undefined).recentCount).toBe(0);
    expect(countRecentWhales([]).recentCount).toBe(0);
  });
});

describe('isNearRecentHigh — near-high entry filter', () => {
  it('rejects when price is within 2% of recent high', async () => {
    const { isNearRecentHigh } = await import('../src/strategy/scorer.js');
    const market = makeMarket({ price: 0.99, recentHigh: 1.00 });
    const r = isNearRecentHigh(market, 0.02);
    expect(r.isNear).toBe(true);
    expect(r.distancePct).toBeCloseTo(0.01, 5);
  });

  it('accepts when price is more than 2% below recent high', async () => {
    const { isNearRecentHigh } = await import('../src/strategy/scorer.js');
    const market = makeMarket({ price: 0.95, recentHigh: 1.00 });
    const r = isNearRecentHigh(market, 0.02);
    expect(r.isNear).toBe(false);
    expect(r.distancePct).toBeCloseTo(0.05, 5);
  });

  it('accepts when recentHigh is missing (no data, no rejection)', async () => {
    const { isNearRecentHigh } = await import('../src/strategy/scorer.js');
    const market = makeMarket({ price: 1.0 });
    const r = isNearRecentHigh(market, 0.02);
    expect(r.isNear).toBe(false);
  });
});

describe('evaluateEntry — structured rejection reporting', () => {
  it('reports volume_spike_required when whales + trendUp but no volumeSpike', async () => {
    const { evaluateEntry } = await import('../src/strategy/scorer.js');
    const r = evaluateEntry(
      makeSignals({ whaleCount: 16, priceUp: true }),
      makeMarket({ priceChange24h: 0.05 })
    );
    expect(r.side).toBe('FLAT');
    expect(r.rejection).toBe('volume_spike_required');
  });

  it('reports near_recent_high when passesFilters rejects on near-high', async () => {
    const { evaluateEntry } = await import('../src/strategy/scorer.js');
    const r = evaluateEntry(
      makeSignals({ whaleCount: 5, volumeSpike: true, priceUp: true }),
      makeMarket({ priceChange24h: 0.05, price: 0.995, recentHigh: 1.00 })
    );
    expect(r.rejection).toBe('near_recent_high');
    expect(r.rejectionDetails?.filterReason).toMatch(/near recent high/);
  });

  it('passes when whales + volumeSpike + trendUp + not near high', async () => {
    const { evaluateEntry } = await import('../src/strategy/scorer.js');
    const r = evaluateEntry(
      makeSignals({ whaleCount: 5, volumeSpike: true, priceUp: true }),
      makeMarket({ priceChange24h: 0.05, price: 0.95, recentHigh: 1.00 })
    );
    expect(r.rejection).toBe(null);
    expect(r.side).toBe('LONG');
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
