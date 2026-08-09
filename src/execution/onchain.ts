/**
 * Onchain execution — thin wrapper around onchainos CLI.
 *
 * In paper mode: validates inputs, simulates a fill, records the simulated
 * tx hash. No actual onchain transaction occurs.
 *
 * In live mode: would shell out to onchainos swap / strategy create-limit.
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import { log } from '../logger.js';
import { tradingConfig } from '../config.js';

const execAsync = promisify(exec);

export interface SwapResult {
  ok: boolean;
  txHash?: string;
  orderId?: string;
  error?: string;
}

export async function swap(params: {
  fromToken: string;
  toToken: string;
  amountUSDT: number;
  chain: string;
}): Promise<SwapResult> {
  if (tradingConfig.tradingMode === 'paper') {
    if (params.amountUSDT <= 0) {
      return { ok: false, error: 'amountUSDT must be > 0' };
    }
    if (!params.toToken || params.toToken.length < 10) {
      return { ok: false, error: 'invalid toToken address' };
    }
    log.info('paper swap: simulated fill', params);
    return { ok: true, txHash: '0xpaper_' + Date.now().toString(16) };
  }

  // Live mode — would call onchainos swap
  try {
    const { stdout } = await execAsync(
      `onchainos swap --from ${params.fromToken} --to ${params.toToken} --amount ${params.amountUSDT} --chain ${params.chain} --force 2>&1`,
      { timeout: 30_000 }
    );
    const parsed = JSON.parse(stdout);
    return { ok: true, txHash: parsed.data?.txHash ?? parsed.data?.orderId };
  } catch (e) {
    log.error('live swap failed', { error: String(e) });
    return { ok: false, error: String(e) };
  }
}

export async function placeStrategyOrder(params: {
  tokenAddress: string;
  side: 'buy' | 'sell';
  triggerPrice: number;
  amountUSDT: number;
  chain: string;
}): Promise<SwapResult> {
  if (tradingConfig.tradingMode === 'paper') {
    if (params.triggerPrice <= 0) {
      return { ok: false, error: 'triggerPrice must be > 0' };
    }
    log.info('paper strategy order: simulated', params);
    return { ok: true, orderId: 'paper_strat_' + Date.now().toString(16) };
  }

  // Live mode — would call onchainos strategy create-limit
  try {
    const { stdout } = await execAsync(
      `onchainos strategy create-limit --token ${params.tokenAddress} --direction ${params.side} --trigger-price ${params.triggerPrice} --amount ${params.amountUSDT} --chain ${params.chain} 2>&1`,
      { timeout: 30_000 }
    );
    const parsed = JSON.parse(stdout);
    return { ok: true, orderId: parsed.data?.orderId };
  } catch (e) {
    log.error('live strategy order failed', { error: String(e) });
    return { ok: false, error: String(e) };
  }
}

export async function cancelStrategyOrder(orderId: string): Promise<boolean> {
  if (tradingConfig.tradingMode === 'paper') return true;
  try {
    await execAsync(
      `onchainos strategy cancel --order-id ${orderId} 2>&1`,
      { timeout: 15_000 }
    );
    return true;
  } catch {
    return false;
  }
}

export async function getBalance(chain: string, tokenAddress: string): Promise<number> {
  try {
    const { stdout } = await execAsync(
      `onchainos wallet balance --chain ${chain} 2>&1`,
      { timeout: 10_000 }
    );
    const parsed = JSON.parse(stdout);
    for (const detail of parsed.data?.details ?? []) {
      for (const asset of detail.tokenAssets ?? []) {
        if (asset.tokenAddress?.toLowerCase() === tokenAddress.toLowerCase()) {
          return parseFloat(asset.balance);
        }
      }
    }
    return 0;
  } catch (e) {
    log.warn('getBalance failed', { error: String(e) });
    return 0;
  }
}
