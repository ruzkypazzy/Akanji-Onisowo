/**
 * Àkànjí Oníṣòwò — Main tick loop
 *
 * Every 30s:
 *   1. Check control files (pause/stop)
 *   2. Read risk state
 *   3. Check exits on open positions
 *   4. Scan for new entry signals
 *   5. Record heartbeat
 *   6. Trigger daily P&L email if new day
 */

import { tradingConfig, walletConfig, validateConfig } from './config.js';
import { log } from './logger.js';
import { existsSync, statSync } from 'fs';
import {
  getOpenTrades,
  getTodayTrades,
  getTodayRealizedPnL,
  logJournal,
  recordHeartbeat,
  closeTrade,
  insertTrade,
  upsertDailyPnL,
  updateTradeState,
} from './persistence/db.js';
import { checkRiskLimits, calcDrawdown } from './risk/limits.js';
import { evaluatePosition, calcPnL, onTP1Hit, shouldActivateTrailing } from './risk/stops.js';
import { computePositionSize, evaluateEntry } from './strategy/scorer.js';
import { gatherSignals, getMarketData, buildWatchlist } from './signals/index.js';
import { swap, placeStrategyOrder, getBalance } from './execution/onchain.js';
import {
  notifyTradeEntry,
  notifyTradeExit,
  notifyDailyPnL,
  notifyKillSwitch,
} from './monitor/email.js';
import type { Position, Side } from './types.js';

let tickNumber = 0;
let lastDailyEmailDate: string | null = null;
let startingCapital = tradingConfig.totalCapitalUSDT;
let killSwitchTriggered = false;

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

function isPaused(): boolean {
  return existsSync('/tmp/pause-trading');
}

function isStopRequested(): boolean {
  return existsSync('/tmp/stop-trading');
}

async function tick(): Promise<void> {
  tickNumber += 1;
  const tickStart = Date.now();

  try {
    // 1. Control files
    if (isStopRequested()) {
      log.warn('stop file detected, exiting');
      logJournal({ ts: Date.now(), tick: tickNumber, action: 'stop', details: {} });
      process.exit(0);
    }
    if (isPaused()) {
      logJournal({ ts: Date.now(), tick: tickNumber, action: 'paused', details: {} });
      return;
    }

    // 2. Read open positions
    const openTrades = getOpenTrades();
    const openPositions: Position[] = openTrades.map((t) => ({
      id: String(t.id),
      tokenAddress: t.token,
      tokenSymbol: t.tokenSymbol,
      side: t.side as Side,
      entryPrice: t.entryPrice,
      sizeUSDT: t.sizeUSDT,
      state: (t.state === 'TP1_HIT' ? 'TP1_HIT' : 'HOLDING') as Position['state'],
      openTime: t.tsOpen,
      stopLoss: t.entryPrice * (1 - tradingConfig.stopLossPct),  // breakeven is overwritten after TP1
      takeProfit1: t.entryPrice * (1 + tradingConfig.takeProfit1Pct),
      takeProfit2: t.entryPrice * (1 + tradingConfig.takeProfit2Pct),
      trailingStopActive: t.trailingActive ?? false,
      signals: t.signals ?? {
        tokenAddress: t.token,
        whaleCount: 0,
        volumeSpike: false,
        priceUp: false,
        newPool: false,
        socialBuzz: false,
      },
    }));

    // 3. Calculate current capital
    const todayDate = todayStr();
    const todayTrades = getTodayTrades(todayDate);
    const dailyRealizedPnL = getTodayRealizedPnL(todayDate);
    const totalRealizedPnL = openTrades.reduce((sum, t) => sum + (t.pnlUSDT ?? 0), 0) + dailyRealizedPnL;
    const currentCapital = startingCapital + totalRealizedPnL;

    // 4. Kill switch check
    const drawdown = calcDrawdown(startingCapital, currentCapital);
    if (drawdown >= tradingConfig.killSwitchPct && !killSwitchTriggered) {
      killSwitchTriggered = true;
      log.error('KILL SWITCH triggered', { drawdown, currentCapital, startingCapital });
      logJournal({ ts: Date.now(), tick: tickNumber, action: 'kill_switch', details: { drawdown, currentCapital } });
      await notifyKillSwitch({
        drawdownPct: drawdown,
        totalLossUSDT: startingCapital - currentCapital,
        startingCapital,
        currentCapital,
      });
      // Don't return — let exits happen first
    }

    // 5. Check exits
    for (const pos of openPositions) {
      const market = await getMarketData(pos.tokenAddress);
      if (market.price === 0) continue;  // no data, skip

      const action = evaluatePosition(pos, market.price, Date.now());
      const tradeRow = openTrades.find((t) => String(t.id) === pos.id);

      if (action.type === 'HOLD') {
        // Maybe activate trailing
        if (shouldActivateTrailing(pos, market.price) && !pos.trailingStopActive) {
          if (tradeRow?.id) {
            updateTradeState(tradeRow.id, { trailingActive: true });
          }
          log.info('trailing stop activated', { token: pos.tokenAddress, pnlPct: calcPnL(pos, market.price).pnlPct });
        }
        continue;
      }

      // TP1 — partial close 50%, move SL to breakeven, activate trailing
      if (action.type === 'CLOSE_TP1' && pos.state === 'HOLDING') {
        const closeSize = pos.sizeUSDT / 2;
        const pnlPct = calcPnL(pos, market.price).pnlPct;
        const pnlUSDT = closeSize * pnlPct;

        if (tradeRow?.id) {
          updateTradeState(tradeRow.id, {
            state: 'TP1_HIT',
            trailingActive: true,
            partialCloseSizeUSDT: closeSize,
            partialClosePnLUSDT: pnlUSDT,
            sizeUSDT: pos.sizeUSDT - closeSize,
          });
        }

        logJournal({
          ts: Date.now(),
          tick: tickNumber,
          action: 'tp1_partial',
          token: pos.tokenAddress,
          details: { closeSizeUSDT: closeSize, pnlUSDT, pnlPct, exitPrice: market.price, tradeId: tradeRow?.id },
        });

        await notifyTradeExit({
          side: pos.side,
          token: pos.tokenAddress,
          tokenSymbol: pos.tokenSymbol,
          sizeUSDT: closeSize,
          entryPrice: pos.entryPrice,
          exitPrice: market.price,
          pnlUSDT,
          pnlPct,
          exitReason: 'TP1',
          heldHours: (Date.now() - pos.openTime) / (1000 * 60 * 60),
        });
        continue;
      }

      // Full exit — TP2, SL, TRAIL, TIME
      const { pnlUSDT, pnlPct } = calcPnL(pos, market.price);
      if (tradeRow?.id) {
        closeTrade(tradeRow.id, {
          tsClose: Date.now(),
          exitPrice: market.price,
          pnlUSDT,
          pnlPct,
          exitReason: action.reason,
        });
      }

      const heldHours = (Date.now() - pos.openTime) / (1000 * 60 * 60);
      await notifyTradeExit({
        side: pos.side,
        token: pos.tokenAddress,
        tokenSymbol: pos.tokenSymbol,
        sizeUSDT: pos.sizeUSDT,
        entryPrice: pos.entryPrice,
        exitPrice: market.price,
        pnlUSDT,
        pnlPct,
        exitReason: action.reason,
        heldHours,
      });

      logJournal({
        ts: Date.now(),
        tick: tickNumber,
        action: 'exit',
        token: pos.tokenAddress,
        details: { reason: action.reason, pnlUSDT, pnlPct, exitPrice: market.price },
      });
    }

    // 6. Risk check before entries
    const risk = checkRiskLimits({
      openPositions,
      dailyRealizedPnL,
      totalCapital: currentCapital,
      startingCapital,
    });

    if (killSwitchTriggered) {
      logJournal({ ts: Date.now(), tick: tickNumber, action: 'risk_blocked', details: { reason: 'kill switch' } });
    } else if (!risk.canEnter) {
      logJournal({ ts: Date.now(), tick: tickNumber, action: 'risk_blocked', details: { reason: risk.reason } });
    } else {
      // 7. Try to enter a new position
      // Build watchlist: tokens with recent smart-money buys on X Layer
      const heldAddresses = new Set(openPositions.map((p) => p.tokenAddress.toLowerCase()));
      const watchlist = (await buildWatchlist())
        .filter((addr) => !heldAddresses.has(addr.toLowerCase()));
      if (watchlist.length === 0) {
        logJournal({
          ts: Date.now(),
          tick: tickNumber,
          action: 'no_signals',
          details: { reason: 'empty watchlist from smart-money tracker' },
        });
      }

      for (const tokenAddress of watchlist) {
        if (openPositions.some((p) => p.tokenAddress === tokenAddress)) continue;

        const market = await getMarketData(tokenAddress);
        const signals = await gatherSignals(tokenAddress);

        // Use the structured evaluator — returns side + score + rejection reason.
        // evaluateEntry runs hard gates first (volumeSpike_gate, near_high_filter,
        // whale_stale), then the soft score threshold, then side determination.
        // The score threshold is now 2.5 (was 3) to accept more candidates on
        // the thin X Layer market. Hard gates are independent of score — a
        // score-2.5+ candidate is still rejected if volumeSpike is false.
        const ev = evaluateEntry(signals, market);

        // Journal the structured rejection so we can see over the next batch
        // whether the hard gates (volumeSpike_gate, near_high_filter, whale_stale)
        // are actually firing and how often, vs. candidates still failing on
        // score alone.
        if (ev.rejection !== null) {
          logJournal({
            ts: Date.now(),
            tick: tickNumber,
            action: 'entry_rejected',
            token: tokenAddress,
            details: {
              rejection_reason: ev.rejection,
              side: ev.side,
              ...(ev.rejectionDetails ?? {}),
              whaleCount: signals.whaleCount,
              recentWhaleCount: signals.recentWhaleCount,
              volumeSpike: signals.volumeSpike,
              priceUp: signals.priceUp,
              recentHigh: market.recentHigh,
              currentPrice: market.price,
            },
          });
          continue;
        }

        const side = ev.side as 'LONG' | 'SHORT';
        const sizeUSDT = computePositionSize(currentCapital, ev.score.recommendedSize);
        if (sizeUSDT === 0) continue;

        // Execute entry (paper mode for now)
        const swapResult = await swap({
          fromToken: tradingConfig.usdtTokenAddress,
          toToken: tokenAddress,
          amountUSDT: sizeUSDT,
          chain: tradingConfig.chainName,
        });

        if (!swapResult.ok) {
          log.warn('swap failed', { token: tokenAddress, error: swapResult.error });
          continue;
        }

        // Place TP/SL strategy order
        const direction = side === 'LONG' ? 1 : -1;
        const sl = market.price * (1 - direction * tradingConfig.stopLossPct);
        const tp1 = market.price * (1 + direction * tradingConfig.takeProfit1Pct);
        const tp2 = market.price * (1 + direction * tradingConfig.takeProfit2Pct);

        await placeStrategyOrder({
          tokenAddress,
          side: 'sell',  // TP/SL is always sell
          triggerPrice: tp2,
          amountUSDT: sizeUSDT,
          chain: tradingConfig.chainName,
        });
        await placeStrategyOrder({
          tokenAddress,
          side: 'sell',
          triggerPrice: sl,
          amountUSDT: sizeUSDT,
          chain: tradingConfig.chainName,
        });

        // Record in DB
        const tradeId = insertTrade({
          tsOpen: Date.now(),
          token: tokenAddress,
          tokenSymbol: signals.tokenSymbol,
          side,
          entryPrice: market.price,
          sizeUSDT,
          signals,
        });

        await notifyTradeEntry({
          side,
          token: tokenAddress,
          tokenSymbol: signals.tokenSymbol,
          sizeUSDT,
          price: market.price,
          stopLoss: sl,
          takeProfit1: tp1,
          takeProfit2: tp2,
          signals: signals as any,
        });

        logJournal({
          ts: Date.now(),
          tick: tickNumber,
          action: 'entry',
          token: tokenAddress,
          details: {
            side, sizeUSDT, price: market.price, sl, tp1, tp2,
            score: ev.score.score, tradeId,
            whaleCount: signals.whaleCount,
            recentWhaleCount: signals.recentWhaleCount,
            volumeSpike: signals.volumeSpike,
            priceUp: signals.priceUp,
            recentHigh: market.recentHigh,
          },
        });

        break;  // one entry per tick
      }
    }

    // 8. Heartbeat
    recordHeartbeat(risk.openPositionCount, currentCapital, dailyRealizedPnL);

    // 9. Daily P&L email
    if (lastDailyEmailDate !== todayDate && new Date().getUTCHours() >= 16) {  // 00:00 UTC+8 = 16:00 UTC
      const wins = todayTrades.filter((t) => (t.pnlUSDT ?? 0) > 0).length;
      const losses = todayTrades.filter((t) => (t.pnlUSDT ?? 0) < 0).length;
      const drawdown = calcDrawdown(startingCapital, currentCapital);
      upsertDailyPnL({
        date: todayDate,
        startingCapital,
        endingCapital: currentCapital,
        realizedPnL: dailyRealizedPnL,
        unrealizedPnL: 0,
        tradesCount: todayTrades.length,
        wins,
        losses,
        drawdownPct: drawdown,
      });
      await notifyDailyPnL({
        date: todayDate,
        startingCapital,
        endingCapital: currentCapital,
        realizedPnL: dailyRealizedPnL,
        tradesCount: todayTrades.length,
        wins,
        losses,
        drawdownPct: drawdown,
      });
      lastDailyEmailDate = todayDate;
    }

    log.debug('tick complete', { tick: tickNumber, durationMs: Date.now() - tickStart, risk: risk.canEnter });
  } catch (err) {
    log.error('tick failed', { tick: tickNumber, error: String(err) });
    logJournal({ ts: Date.now(), tick: tickNumber, action: 'error', details: { error: String(err) } });
  }
}

async function main(): Promise<void> {
  log.info('Àkànjí Oníṣòwò starting', {
    mode: tradingConfig.tradingMode,
    capital: tradingConfig.totalCapitalUSDT,
    email: walletConfig.email,
  });

  try {
    validateConfig();
  } catch (err) {
    log.error('config validation failed', { error: String(err) });
    process.exit(1);
  }

  // Get starting capital from current balance if in live mode
  if (tradingConfig.tradingMode === 'live') {
    const bal = await getBalance(tradingConfig.chainName, tradingConfig.usdtTokenAddress);
    if (bal > 0) startingCapital = bal;
  }

  log.info('starting tick loop', { intervalSeconds: tradingConfig.tickIntervalSeconds });
  logJournal({ ts: Date.now(), tick: 0, action: 'start', details: { mode: tradingConfig.tradingMode, startingCapital } });

  // First tick immediately, then on interval
  await tick();
  setInterval(tick, tradingConfig.tickIntervalSeconds * 1000);
}

main().catch((err) => {
  log.error('fatal error', { error: String(err) });
  process.exit(1);
});
