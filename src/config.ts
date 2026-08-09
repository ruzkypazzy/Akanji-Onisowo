/**
 * Àkànjí Oníṣòwò — Configuration
 *
 * All tunable parameters in one place. No magic numbers anywhere else.
 */

import 'dotenv/config';

function envFloat(key: string, defaultVal: number): number {
  const v = process.env[key];
  if (!v) return defaultVal;
  const n = parseFloat(v);
  return isNaN(n) ? defaultVal : n;
}

function envInt(key: string, defaultVal: number): number {
  const v = process.env[key];
  if (!v) return defaultVal;
  const n = parseInt(v, 10);
  return isNaN(n) ? defaultVal : n;
}

function envStr(key: string, defaultVal: string): string {
  return process.env[key] || defaultVal;
}

export interface TradingConfig {
  // Capital
  totalCapitalUSDT: number;
  tradingMode: 'paper' | 'live';

  // Position sizing
  maxPositionSizePct: number;
  maxPositionSizeUSDT: number;
  minPositionSizeUSDT: number;
  maxConcurrentPositions: number;
  maxTotalExposurePct: number;
  cashReservePct: number;

  // Stops
  stopLossPct: number;
  takeProfit1Pct: number;
  takeProfit2Pct: number;
  trailingStopActivationPct: number;
  trailingStopDistancePct: number;
  timeStopHours: number;
  maxFeeAsPctOfExpectedGain: number;

  // Limits
  dailyLossLimitPct: number;
  killSwitchPct: number;

  // Network
  chainId: number;
  chainName: string;
  chainRpc: string;
  usdtTokenAddress: string;

  // Runtime
  logLevel: string;
  tickIntervalSeconds: number;

  // Entry gating (post-paper-test revision 2026-08-09, +0.1)
  /** Whales older than this many ms do not count as recent signals. Default 15 min. */
  whaleRecencyMs: number;
  /** Reject entry if current price >= (1 - this) * recentHigh. Default 0.02 = 2% below high. */
  nearHighThresholdPct: number;
  /** Number of 1h bars to look back for the recent-high calculation. */
  nearHighWindowBars: number;
}

export interface WalletConfig {
  address: string;
  agentId: string;
  email: string;
}

export interface EmailConfig {
  apiKey: string;
  from: string;
  to: string;
}

export const tradingConfig: TradingConfig = {
  totalCapitalUSDT: envFloat('TRADING_CAPITAL_USDT', 300),
  tradingMode: envStr('TRADING_MODE', 'paper') as 'paper' | 'live',

  maxPositionSizePct: envFloat('MAX_POSITION_SIZE_PCT', 0.20),
  maxPositionSizeUSDT: envFloat('MAX_POSITION_SIZE_USDT', 60),
  minPositionSizeUSDT: envFloat('MIN_POSITION_SIZE_USDT', 30),
  maxConcurrentPositions: envInt('MAX_CONCURRENT_POSITIONS', 2),
  maxTotalExposurePct: envFloat('MAX_TOTAL_EXPOSURE_PCT', 0.60),
  cashReservePct: envFloat('CASH_RESERVE_PCT', 0.40),

  stopLossPct: envFloat('STOP_LOSS_PCT', 0.05),
  takeProfit1Pct: envFloat('TAKE_PROFIT_1_PCT', 0.10),
  takeProfit2Pct: envFloat('TAKE_PROFIT_2_PCT', 0.20),
  trailingStopActivationPct: envFloat('TRAILING_STOP_ACTIVATION_PCT', 0.15),
  trailingStopDistancePct: envFloat('TRAILING_STOP_DISTANCE_PCT', 0.01),
  timeStopHours: envFloat('TIME_STOP_HOURS', 4),
  maxFeeAsPctOfExpectedGain: envFloat('MAX_FEE_AS_PCT_OF_EXPECTED_GAIN', 0.30),

  dailyLossLimitPct: envFloat('DAILY_LOSS_LIMIT_PCT', 0.08),
  killSwitchPct: envFloat('KILL_SWITCH_PCT', 0.20),

  chainId: envInt('CHAIN_ID', 196),
  chainName: envStr('CHAIN_NAME', 'xlayer'),
  chainRpc: envStr('CHAIN_RPC', 'https://rpc.xlayer.tech'),
  usdtTokenAddress: envStr('USDT_TOKEN_ADDRESS', '0x779ded0c9e1022225f8e0630b35a9b54be713736'),

  logLevel: envStr('LOG_LEVEL', 'info'),
  tickIntervalSeconds: envInt('TICK_INTERVAL_SECONDS', 30),

  whaleRecencyMs: envInt('WHALE_RECENCY_MS', 15 * 60 * 1000),
  nearHighThresholdPct: envFloat('NEAR_HIGH_THRESHOLD_PCT', 0.02),
  nearHighWindowBars: envInt('NEAR_HIGH_WINDOW_BARS', 5),
};

export const walletConfig: WalletConfig = {
  address: envStr('OKX_WALLET_ADDRESS', ''),
  agentId: envStr('OKX_AGENT_ID', ''),
  email: envStr('OKX_ACCOUNT_EMAIL', ''),
};

export const emailConfig: EmailConfig = {
  apiKey: envStr('RESEND_API_KEY', ''),
  from: envStr('EMAIL_FROM', 'akanji@resend.dev'),
  to: envStr('EMAIL_TO', ''),
};

/**
 * Validate the config. Throws if anything required is missing.
 * Call this at startup before doing anything.
 */
export function validateConfig(): void {
  const errors: string[] = [];

  if (!walletConfig.address) {
    errors.push('OKX_WALLET_ADDRESS is required');
  }
  if (!walletConfig.email) {
    errors.push('OKX_ACCOUNT_EMAIL is required');
  }
  if (tradingConfig.tradingMode === 'live' && !walletConfig.agentId) {
    errors.push('OKX_AGENT_ID is required for live trading');
  }
  if (tradingConfig.totalCapitalUSDT <= 0) {
    errors.push('TRADING_CAPITAL_USDT must be > 0');
  }
  if (tradingConfig.maxConcurrentPositions < 1) {
    errors.push('MAX_CONCURRENT_POSITIONS must be >= 1');
  }

  if (errors.length > 0) {
    throw new Error(`Invalid configuration:\n  - ${errors.join('\n  - ')}`);
  }
}
