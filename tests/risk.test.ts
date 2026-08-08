import { describe, it, expect } from 'vitest';
import { checkRiskLimits, calcDrawdown } from '../src/risk/limits.js';
import type { Position } from '../src/types.js';

function makePosition(overrides: Partial<Position> = {}): Position {
  return {
    id: '1',
    tokenAddress: '0xtoken',
    side: 'LONG',
    entryPrice: 1.0,
    sizeUSDT: 50,
    state: 'HOLDING',
    openTime: Date.now(),
    stopLoss: 0.95,
    takeProfit1: 1.10,
    takeProfit2: 1.20,
    trailingStopActive: false,
    signals: {
      tokenAddress: '0xtoken',
      whaleCount: 0,
      volumeSpike: false,
      priceUp: false,
      newPool: false,
      socialBuzz: false,
    },
    ...overrides,
  };
}

describe('checkRiskLimits', () => {
  it('allows entry with no open positions', () => {
    const r = checkRiskLimits({
      openPositions: [],
      dailyRealizedPnL: 0,
      totalCapital: 300,
      startingCapital: 300,
    });
    expect(r.canEnter).toBe(true);
  });

  it('blocks at max concurrent positions (2)', () => {
    const r = checkRiskLimits({
      openPositions: [makePosition(), makePosition()],
      dailyRealizedPnL: 0,
      totalCapital: 300,
      startingCapital: 300,
    });
    expect(r.canEnter).toBe(false);
    expect(r.reason).toMatch(/concurrent/);
  });

  it('blocks when daily loss limit hit', () => {
    const r = checkRiskLimits({
      openPositions: [],
      dailyRealizedPnL: -25,  // 8% of 300 = 24
      totalCapital: 275,
      startingCapital: 300,
    });
    expect(r.canEnter).toBe(false);
    expect(r.reason).toMatch(/daily/);
  });

  it('triggers kill switch at 20% drawdown', () => {
    const r = checkRiskLimits({
      openPositions: [],
      dailyRealizedPnL: 0,
      totalCapital: 235,  // -21.7% from 300
      startingCapital: 300,
    });
    expect(r.canEnter).toBe(false);
    expect(r.reason).toMatch(/KILL/);
  });

  it('NOTE: exposure limit is mathematically unreachable in 300 USDT mode', () => {
    // With 20% max position size + 2 max concurrent = 40% max exposure.
    // The 60% exposure limit is a safety net for future configs with larger position sizes.
    // For 300 USDT mode, the concurrent-position check is the binding constraint.
    const r = checkRiskLimits({
      openPositions: [makePosition()],
      dailyRealizedPnL: 0,
      totalCapital: 300,
      startingCapital: 300,
    });
    expect(r.canEnter).toBe(true);
  });
});

describe('calcDrawdown', () => {
  it('returns 0 when no loss', () => {
    expect(calcDrawdown(300, 300)).toBe(0);
    expect(calcDrawdown(300, 350)).toBe(0);
  });

  it('returns fraction of loss', () => {
    expect(calcDrawdown(300, 270)).toBeCloseTo(0.10, 5);
    expect(calcDrawdown(300, 240)).toBeCloseTo(0.20, 5);
  });
});
