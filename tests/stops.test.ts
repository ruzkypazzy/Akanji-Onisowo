import { describe, it, expect } from 'vitest';
import { evaluatePosition, calcPnL, onTP1Hit, shouldActivateTrailing } from '../src/risk/stops.js';
import type { Position } from '../src/types.js';

function makePosition(overrides: Partial<Position> = {}): Position {
  return {
    id: '1',
    tokenAddress: '0xtoken',
    side: 'LONG',
    entryPrice: 1.0,
    sizeUSDT: 50,
    state: 'HOLDING',
    openTime: Date.now() - 1000 * 60 * 60,  // 1 hour ago
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

describe('calcPnL', () => {
  it('LONG: profit when price up', () => {
    const { pnlUSDT, pnlPct } = calcPnL(makePosition({ side: 'LONG', sizeUSDT: 100 }), 1.10);
    expect(pnlPct).toBeCloseTo(0.10, 5);
    expect(pnlUSDT).toBeCloseTo(10, 5);
  });

  it('SHORT: profit when price down', () => {
    const { pnlUSDT, pnlPct } = calcPnL(makePosition({ side: 'SHORT', sizeUSDT: 100 }), 0.90);
    expect(pnlPct).toBeCloseTo(0.10, 5);
    expect(pnlUSDT).toBeCloseTo(10, 5);
  });

  it('LONG: loss when price down', () => {
    const { pnlPct } = calcPnL(makePosition({ side: 'LONG' }), 0.95);
    expect(pnlPct).toBeCloseTo(-0.05, 5);
  });
});

describe('evaluatePosition', () => {
  it('SL triggers at -5%', () => {
    const action = evaluatePosition(makePosition(), 0.94, Date.now());
    expect(action.type).toBe('CLOSE_SL');
  });

  it('TP1 fires at +10%', () => {
    const action = evaluatePosition(makePosition(), 1.10, Date.now());
    expect(action.type).toBe('CLOSE_TP1');
  });

  it('TP1 fires at +20% from HOLDING (state still HOLDING, so first close is TP1)', () => {
    // When state is HOLDING and price hits +20%, the first action is TP1 (close 50%).
    // On the NEXT tick, state would be TP1_HIT and the remaining 50% would close via TP2.
    const action = evaluatePosition(makePosition(), 1.20, Date.now());
    expect(action.type).toBe('CLOSE_TP1');
  });

  it('TP2 fires at +20% from TP1_HIT state', () => {
    const action = evaluatePosition(makePosition({ state: 'TP1_HIT' }), 1.20, Date.now());
    expect(action.type).toBe('CLOSE_TP2');
  });

  it('HOLD between -5% and +10%', () => {
    const action = evaluatePosition(makePosition(), 1.05, Date.now());
    expect(action.type).toBe('HOLD');
  });

  it('time stop fires at 4h if flat (±2%)', () => {
    const oldPos = makePosition({ openTime: Date.now() - 5 * 60 * 60 * 1000 });  // 5h ago
    const action = evaluatePosition(oldPos, 1.01, Date.now());
    expect(action.type).toBe('CLOSE_TIME');
  });

  it('SHORT position: SL triggers when price up', () => {
    const action = evaluatePosition(makePosition({ side: 'SHORT', entryPrice: 1.0 }), 1.06, Date.now());
    expect(action.type).toBe('CLOSE_SL');
  });
});

describe('onTP1Hit', () => {
  it('moves stop to breakeven, halves size, activates trailing', () => {
    const updated = onTP1Hit(makePosition({ entryPrice: 1.0, sizeUSDT: 60 }));
    expect(updated.stopLoss).toBe(1.0);
    expect(updated.sizeUSDT).toBe(30);
    expect(updated.trailingStopActive).toBe(true);
    expect(updated.state).toBe('TP1_HIT');
  });
});

describe('shouldActivateTrailing', () => {
  it('activates after +15%', () => {
    expect(shouldActivateTrailing(makePosition(), 1.16)).toBe(true);
  });

  it('does not activate below +15%', () => {
    expect(shouldActivateTrailing(makePosition(), 1.10)).toBe(false);
  });

  it('does not re-activate if already active', () => {
    expect(shouldActivateTrailing(makePosition({ trailingStopActive: true }), 1.20)).toBe(false);
  });
});
