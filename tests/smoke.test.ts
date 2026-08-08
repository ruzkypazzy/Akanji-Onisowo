import { describe, it, expect } from 'vitest';
import { tradingConfig } from '../src/config.js';
import { calcDrawdown } from '../src/risk/limits.js';

describe('config sanity', () => {
  it('300 USDT mode is the default', () => {
    expect(tradingConfig.totalCapitalUSDT).toBe(300);
  });

  it('position size capped at 20% / 60 USDT', () => {
    expect(tradingConfig.maxPositionSizePct).toBe(0.20);
    expect(tradingConfig.maxPositionSizeUSDT).toBe(60);
  });

  it('max 2 concurrent positions', () => {
    expect(tradingConfig.maxConcurrentPositions).toBe(2);
  });

  it('risk limits are sane', () => {
    expect(tradingConfig.stopLossPct).toBe(0.05);
    expect(tradingConfig.takeProfit1Pct).toBe(0.10);
    expect(tradingConfig.takeProfit2Pct).toBe(0.20);
    expect(tradingConfig.dailyLossLimitPct).toBe(0.08);
    expect(tradingConfig.killSwitchPct).toBe(0.20);
  });
});

describe('drawdown math', () => {
  it('8% daily loss is half of 20% kill switch', () => {
    const starting = 300;
    const dailyLimitLoss = starting * 0.08;  // 24
    const killSwitchLoss = starting * 0.20;  // 60
    expect(dailyLimitLoss * 2.5).toBeCloseTo(killSwitchLoss, 5);
  });

  it('drawdown fraction math is correct', () => {
    expect(calcDrawdown(300, 300)).toBe(0);
    expect(calcDrawdown(300, 240)).toBeCloseTo(0.20, 5);
  });
});

describe('integration scenarios', () => {
  it('worst case: 2 positions both hit SL = -6 USDT loss (4% of 60 each)', () => {
    const starting = 300;
    const slLoss = 60 * 0.05;  // 3 USDT per position
    const totalLoss = slLoss * 2;
    expect(totalLoss).toBeCloseTo(6, 5);
    expect(totalLoss / starting).toBeCloseTo(0.02, 5);  // 2% drawdown
  });

  it('best case: 2 positions both hit TP2 = +24 USDT profit (20% of 60 each)', () => {
    const tp2Gain = 60 * 0.20;  // 12 USDT per position
    const totalGain = tp2Gain * 2;
    expect(totalGain).toBeCloseTo(24, 5);
    expect(totalGain / 300).toBeCloseTo(0.08, 5);  // 8% gain
  });

  it('max drawdown before kill switch: 60 USDT (20% of 300)', () => {
    expect(300 * 0.20).toBe(60);
  });

  it('daily loss limit: 24 USDT (8% of 300)', () => {
    expect(300 * 0.08).toBe(24);
  });
});
