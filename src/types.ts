/**
 * Shared types for Àkànjí Oníṣòwò
 */

export type Side = 'LONG' | 'SHORT';
export type PositionState =
  | 'WATCHING'
  | 'SIGNALED'
  | 'ENTERING'
  | 'HOLDING'
  | 'TP1_HIT'
  | 'EXITED'
  | 'COOLDOWN';
export type ExitReason = 'TP1' | 'TP2' | 'SL' | 'TIME' | 'KILL' | 'TRAIL' | 'MANUAL' | 'SIGNAL';

export interface TokenSignals {
  tokenAddress: string;
  tokenSymbol?: string;
  whaleCount: number;        // 0+ top-50 wallets that bought
  volumeSpike: boolean;      // 5x normal 1h volume
  priceUp: boolean;         // >5% in last 15m
  newPool: boolean;         // recently launched
  socialBuzz: boolean;      // mention spike
  /**
   * Whale buys with timestamps (ms). Stale buys (older than `whaleRecencyMs`)
   * do not count toward `whaleCount`. Used to detect "tail-end" entries where
   * the move already happened.
   */
  recentWhaleBuys?: { ts: number; wallet: string }[];
  /** Number of whale buys in the last `whaleRecencyMs` (default 15 min). */
  recentWhaleCount?: number;
}

export interface TokenScore {
  tokenAddress: string;
  score: number;
  signals: TokenSignals;
  recommendedSize: number;  // 0-1 fraction of capital
}

export interface Position {
  id: string;
  tokenAddress: string;
  tokenSymbol?: string;
  side: Side;
  entryPrice: number;
  sizeUSDT: number;
  state: PositionState;
  openTime: number;
  currentPrice?: number;
  pnlUSDT?: number;
  pnlPct?: number;
  stopLoss: number;
  takeProfit1: number;
  takeProfit2: number;
  trailingStopActive: boolean;
  signals: TokenSignals;
  exitReason?: ExitReason;
  closeTime?: number;
  closePrice?: number;
}

export interface MarketData {
  tokenAddress: string;
  price: number;
  volume1h: number;
  volume24h: number;
  priceChange24h: number;  // as fraction, e.g. 0.05 = +5%
  liquidityUSD: number;
  age: number;              // days since launch
  /**
   * Highest close from the last N 1h bars (default 5). Used to detect
   * entries at the top of a pump — see passesFilters + isNearRecentHigh.
   */
  recentHigh?: number;
  /** Number of 1h bars used to compute recentHigh. */
  recentHighWindow?: number;
}

export interface JournalEntry {
  id?: number;
  ts: number;
  tick: number;
  action: string;
  token?: string;
  details: Record<string, unknown>;
}

export interface Trade {
  id?: number;
  tsOpen: number;
  tsClose?: number;
  token: string;
  tokenSymbol?: string;
  side: Side;
  entryPrice: number;
  exitPrice?: number;
  sizeUSDT: number;
  pnlUSDT?: number;
  pnlPct?: number;
  exitReason?: ExitReason;
  state?: string;                  // 'OPEN' | 'TP1_HIT' | 'CLOSED'
  trailingActive?: boolean;
  partialCloseSizeUSDT?: number;    // realized USDT from TP1 partial
  partialClosePnLUSDT?: number;    // realized PnL from TP1 partial
  signals?: TokenSignals;
}

export interface DailyPnL {
  date: string;             // YYYY-MM-DD
  startingCapital: number;
  endingCapital: number;
  realizedPnL: number;
  unrealizedPnL: number;
  tradesCount: number;
  wins: number;
  losses: number;
  drawdownPct: number;
}
