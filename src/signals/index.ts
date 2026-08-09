/**
 * Signal sources — real onchainos CLI integrations.
 *
 * Wires Àkànjí's tick loop to live X Layer DEX data:
 *   - Whale activity:    tracker activities (smart_money buys)
 *   - Volume spike:      market kline (1h vs 24h average)
 *   - New pool:          memepump tokens (MIGRATED or NEW with liquidity)
 *   - Social buzz:       social news-by-symbol (mention volume in 24h)
 *   - Market data:       market kline (price, 24h change, volume)
 *
 * All calls have 5s timeouts and fail-soft (return safe defaults) so
 * one bad data source can never block trading.
 */

import { execFile } from 'child_process';
import { promisify } from 'util';
import type { TokenSignals, MarketData } from '../types.js';

const execFileP = promisify(execFile);
const CLI = process.env.ONCHAINOS_BIN || '/root/.local/bin/onchainos';
const CHAIN = process.env.CHAIN || 'xlayer';
const CLI_TIMEOUT_MS = 5000;

/**
 * Run an onchainos CLI call and return parsed JSON.
 * Fails soft: returns null on any error (timeout, non-JSON, non-zero exit).
 */
async function runCli<T = any>(args: string[]): Promise<T | null> {
  try {
    const { stdout } = await execFileP(CLI, args, {
      timeout: CLI_TIMEOUT_MS,
      maxBuffer: 8 * 1024 * 1024,
    });
    const parsed = JSON.parse(stdout.trim());
    if (parsed && parsed.ok && parsed.data !== undefined) return parsed.data as T;
    return null;
  } catch {
    return null;
  }
}

/**
 * Cache smart-money trades for the current tick to avoid re-querying per token.
 * Key: tokenAddress lowercased.
 */
let smartMoneyCache: { ts: number; byToken: Map<string, number> } | null = null;
const CACHE_TTL_MS = 60_000; // 1 minute

/**
 * Count smart-money wallets that have bought a given token in the last hour.
 * Uses the onchainos tracker activities endpoint with --trade-type=1 (buy).
 */
export async function checkWhaleActivity(tokenAddress: string): Promise<number> {
  const now = Date.now();
  if (!smartMoneyCache || now - smartMoneyCache.ts > CACHE_TTL_MS) {
    smartMoneyCache = { ts: now, byToken: new Map() };
    const data = await runCli<{ trades: any[] }>([
      'tracker', 'activities',
      '--tracker-type', 'smart_money',
      '--chain', CHAIN,
      '--trade-type', '1',
      '--min-volume', '50',
    ]);
    if (data?.trades) {
      const cutoff = now - 60 * 60 * 1000;
      for (const t of data.trades) {
        if (Number(t.tradeTime) < cutoff) continue;
        const addr = String(t.tokenContractAddress || '').toLowerCase();
        if (!addr) continue;
        smartMoneyCache.byToken.set(addr, (smartMoneyCache.byToken.get(addr) || 0) + 1);
      }
    }
  }
  return smartMoneyCache.byToken.get(tokenAddress.toLowerCase()) || 0;
}

/**
 * Detect a volume spike: latest 1h volume > 5x the 24h average per hour.
 * Uses market kline to fetch recent hourly bars.
 */
export async function checkVolumeSpike(tokenAddress: string): Promise<boolean> {
  const bars = await runCli<any[]>([
    'market', 'kline',
    '--chain', CHAIN,
    '--address', tokenAddress,
    '--bar', '1H',
    '--limit', '24',
  ]);
  if (!bars || bars.length < 6) return false;
  const latest = Number(bars[0].volUsd || 0);
  const recent = bars.slice(1, Math.min(13, bars.length));
  const avg = recent.reduce((s, b) => s + Number(b.volUsd || 0), 0) / recent.length;
  if (avg < 100) return false;  // not enough baseline
  return latest > 5 * avg;
}

/**
 * Recently-launched pool with sufficient liquidity.
 * Uses memepump tokens and checks createdTimestamp (within 7 days) and
 * top10HoldingsPercent (low enough to not be a rug).
 */
let newPoolCache: { ts: number; addresses: Set<string> } | null = null;

export async function checkNewPool(tokenAddress: string): Promise<boolean> {
  const now = Date.now();
  if (!newPoolCache || now - newPoolCache.ts > CACHE_TTL_MS) {
    newPoolCache = { ts: now, addresses: new Set() };
    const data = await runCli<any[]>(['memepump', 'tokens', '--chain', CHAIN]);
    if (data) {
      const cutoff = now - 7 * 24 * 60 * 60 * 1000;  // 7 days
      for (const t of data) {
        const created = Number(t.createdTimestamp || 0);
        const addr = String(t.tokenAddress || '').toLowerCase();
        const top10 = Number(t.tags?.top10HoldingsPercent || 100);
        const liq = Number(t.market?.marketCapUsd || 0);
        if (created > cutoff && top10 < 50 && liq > 5000) {
          newPoolCache.addresses.add(addr);
        }
      }
    }
  }
  return newPoolCache.addresses.has(tokenAddress.toLowerCase());
}

/**
 * Social buzz: >=3 news mentions in the last 24h for the token's symbol.
 * Token symbol is best-effort derived from the address (uppercase memepump lookup).
 */
let symbolCache: { ts: number; byAddr: Map<string, string> } | null = null;

export async function getTokenSymbol(tokenAddress: string): Promise<string> {
  const now = Date.now();
  if (!symbolCache || now - symbolCache.ts > CACHE_TTL_MS) {
    symbolCache = { ts: now, byAddr: new Map() };
    const data = await runCli<any[]>(['memepump', 'tokens', '--chain', CHAIN]);
    if (data) {
      for (const t of data) {
        const addr = String(t.tokenAddress || '').toLowerCase();
        const sym = String(t.symbol || '').trim();
        if (addr && sym) symbolCache.byAddr.set(addr, sym);
      }
    }
  }
  return symbolCache.byAddr.get(tokenAddress.toLowerCase()) || '';
}

let socialBuzzCache: { ts: number; symbols: Set<string> } | null = null;

export async function checkSocialBuzz(tokenAddress: string): Promise<boolean> {
  const symbol = await getTokenSymbol(tokenAddress);
  if (!symbol) return false;
  const now = Date.now();
  if (!socialBuzzCache || now - socialBuzzCache.ts > CACHE_TTL_MS) {
    socialBuzzCache = { ts: now, symbols: new Set() };
    const data = await runCli<{ articles: any[] }>([
      'social', 'news-by-symbol',
      '--chain', CHAIN,
      '--token-symbols', symbol,
      '--since', '24h',
    ]);
    if (data?.articles && data.articles.length >= 3) {
      socialBuzzCache.symbols.add(symbol.toUpperCase());
    }
  }
  return socialBuzzCache.symbols.has(symbol.toUpperCase());
}

/**
 * Gather all signals for a single token.
 * Runs the four checks in parallel — each fails soft independently.
 */
export async function gatherSignals(tokenAddress: string): Promise<TokenSignals> {
  const [whaleCount, volumeSpike, newPool, socialBuzz, symbol] = await Promise.all([
    checkWhaleActivity(tokenAddress),
    checkVolumeSpike(tokenAddress),
    checkNewPool(tokenAddress),
    checkSocialBuzz(tokenAddress),
    getTokenSymbol(tokenAddress),
  ]);

  // priceUp: latest 1h bar close > 1h-prior close by >= 2% (proxy for short-term momentum)
  let priceUp = false;
  const bars = await runCli<any[]>([
    'market', 'kline',
    '--chain', CHAIN,
    '--address', tokenAddress,
    '--bar', '1H',
    '--limit', '3',
  ]);
  if (bars && bars.length >= 2) {
    const now = Number(bars[0].c);
    const prev = Number(bars[1].c);
    if (prev > 0) priceUp = (now - prev) / prev >= 0.02;
  }

  return {
    tokenAddress,
    tokenSymbol: symbol || undefined,
    whaleCount,
    volumeSpike,
    priceUp,
    newPool,
    socialBuzz,
  };
}

/**
 * Get market data for a token.
 * Uses market kline (last 24h close + 24h change + 24h volume) and
 * tracker liquidity from memepump if available.
 */
export async function getMarketData(tokenAddress: string): Promise<MarketData> {
  const out: MarketData = {
    tokenAddress,
    price: 0,
    volume1h: 0,
    volume24h: 0,
    priceChange24h: 0,
    liquidityUSD: 0,
    age: 30,
  };

  const bars = await runCli<any[]>([
    'market', 'kline',
    '--chain', CHAIN,
    '--address', tokenAddress,
    '--bar', '1H',
    '--limit', '24',
  ]);
  if (bars && bars.length > 0) {
    out.price = Number(bars[0].c) || 0;
    out.volume1h = Number(bars[0].volUsd) || 0;
    out.volume24h = bars.reduce((s, b) => s + (Number(b.volUsd) || 0), 0);
    if (bars.length >= 24) {
      const now = Number(bars[0].c);
      const yesterday = Number(bars[23].c);
      if (yesterday > 0) out.priceChange24h = (now - yesterday) / yesterday;
    }
  }

  // Pull liquidity + age from memepump data — query directly by address,
  // not by symbol (symbol lookup is unreliable for newly-listed tokens).
  const data = await runCli<any[]>(['memepump', 'tokens', '--chain', CHAIN]);
  if (data) {
    const match = data.find((t) => String(t.tokenAddress || '').toLowerCase() === tokenAddress.toLowerCase());
    if (match) {
      out.liquidityUSD = Number(match.market?.marketCapUsd || 0);
      if (match.createdTimestamp) {
        const ageMs = Date.now() - Number(match.createdTimestamp);
        out.age = ageMs / (24 * 60 * 60 * 1000);
      }
    }
  }

  // Fallback: if memepump didn't have the token (it's MIGRATED, or newer than
  // the listing), use 24h volume as a liquidity proxy and assume 30d age.
  // Tokens with $100k+ 24h volume are clearly liquid enough to trade.
  if (out.liquidityUSD === 0 && out.volume24h > 0) {
    out.liquidityUSD = Math.max(out.volume24h * 0.1, 10_000);
  }

  return out;
}

/**
 * Build the watchlist for the tick: tokens with recent smart-money activity.
 * Used as the entry candidate pool.
 */
export async function buildWatchlist(): Promise<string[]> {
  const data = await runCli<{ trades: any[] }>([
    'tracker', 'activities',
    '--tracker-type', 'smart_money',
    '--chain', CHAIN,
    '--trade-type', '1',
    '--min-volume', '100',
  ]);
  if (!data?.trades) return [];
  const cutoff = Date.now() - 30 * 60 * 1000;  // last 30 minutes
  const seen = new Set<string>();
  for (const t of data.trades) {
    if (Number(t.tradeTime) < cutoff) continue;
    const addr = String(t.tokenContractAddress || '').toLowerCase();
    if (addr) seen.add(addr);
  }
  return Array.from(seen).slice(0, 10);  // cap to top 10 per tick
}
