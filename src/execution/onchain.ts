/**
 * Onchain execution — thin wrapper around onchainos CLI.
 *
 * Real implementation will shell out to onchainos commands.
 * This is a stub for now — returns success without actually trading.
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import { log } from '../logger.js';

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
  log.info('swap: stub execution (paper mode)', params);
  // TODO: replace with real onchainos call
  //   onchainos swap --from <token> --to <token> --amount <usdt> --chain xlayer --force
  return { ok: true, txHash: '0xstub_swap_' + Date.now() };
}

export async function placeStrategyOrder(params: {
  tokenAddress: string;
  side: 'buy' | 'sell';
  triggerPrice: number;
  amountUSDT: number;
  chain: string;
}): Promise<SwapResult> {
  log.info('placeStrategyOrder: stub execution (paper mode)', params);
  // TODO: replace with real onchainos call
  //   onchainos strategy create-limit --trigger-price <p> --direction <side> --amount <usdt>
  return { ok: true, orderId: 'stub_strategy_' + Date.now() };
}

export async function cancelStrategyOrder(orderId: string): Promise<boolean> {
  log.info('cancelStrategyOrder: stub', { orderId });
  return true;
}

export async function getBalance(chain: string, tokenAddress: string): Promise<number> {
  try {
    const { stdout } = await execAsync(
      `onchainos wallet balance --chain ${chain} 2>&1`
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
