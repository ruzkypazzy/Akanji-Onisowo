/**
 * Risk limits — gate every trade decision
 */

import { tradingConfig } from '../config.js';
import type { Position } from '../types.js';

export interface RiskState {
  canEnter: boolean;
  reason: string;
  currentExposure: number;
  openPositionCount: number;
  dailyPnL: number;
  drawdownPct: number;
}

export interface RiskCheckInput {
  openPositions: Position[];
  dailyRealizedPnL: number;  // in USDT
  totalCapital: number;
  startingCapital: number;
}

/**
 * Check if we can open a new position. Returns full state for logging.
 */
export function checkRiskLimits(input: RiskCheckInput): RiskState {
  const { openPositions, dailyRealizedPnL, totalCapital, startingCapital } = input;

  // Current exposure = sum of open position sizes
  const currentExposure = openPositions.reduce((sum, p) => sum + p.sizeUSDT, 0);

  // Max concurrent positions
  if (openPositions.length >= tradingConfig.maxConcurrentPositions) {
    return {
      canEnter: false,
      reason: `max concurrent reached (${openPositions.length}/${tradingConfig.maxConcurrentPositions})`,
      currentExposure,
      openPositionCount: openPositions.length,
      dailyPnL: dailyRealizedPnL,
      drawdownPct: calcDrawdown(startingCapital, totalCapital),
    };
  }

  // Max total exposure
  const maxExposure = startingCapital * tradingConfig.maxTotalExposurePct;
  if (currentExposure >= maxExposure) {
    return {
      canEnter: false,
      reason: `max exposure reached ($${currentExposure.toFixed(2)}/$${maxExposure.toFixed(2)})`,
      currentExposure,
      openPositionCount: openPositions.length,
      dailyPnL: dailyRealizedPnL,
      drawdownPct: calcDrawdown(startingCapital, totalCapital),
    };
  }

  // Daily loss limit (in USDT)
  const dailyLossLimit = startingCapital * tradingConfig.dailyLossLimitPct;
  if (dailyRealizedPnL <= -dailyLossLimit) {
    return {
      canEnter: false,
      reason: `daily loss limit hit (-$${Math.abs(dailyRealizedPnL).toFixed(2)}/$${dailyLossLimit.toFixed(2)})`,
      currentExposure,
      openPositionCount: openPositions.length,
      dailyPnL: dailyRealizedPnL,
      drawdownPct: calcDrawdown(startingCapital, totalCapital),
    };
  }

  // Total drawdown kill switch
  const drawdown = calcDrawdown(startingCapital, totalCapital);
  if (drawdown >= tradingConfig.killSwitchPct) {
    return {
      canEnter: false,
      reason: `KILL SWITCH: drawdown ${(drawdown * 100).toFixed(1)}% >= ${(tradingConfig.killSwitchPct * 100).toFixed(1)}%`,
      currentExposure,
      openPositionCount: openPositions.length,
      dailyPnL: dailyRealizedPnL,
      drawdownPct: drawdown,
    };
  }

  return {
    canEnter: true,
    reason: 'all checks pass',
    currentExposure,
    openPositionCount: openPositions.length,
    dailyPnL: dailyRealizedPnL,
    drawdownPct: drawdown,
  };
}

/**
 * Calculate drawdown as a fraction of starting capital.
 * Returns 0 if no loss, 0.10 if down 10%, etc.
 */
export function calcDrawdown(startingCapital: number, currentCapital: number): number {
  if (currentCapital >= startingCapital) return 0;
  return (startingCapital - currentCapital) / startingCapital;
}
