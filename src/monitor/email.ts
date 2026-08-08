/**
 * Email notifier via Resend.
 *
 * Sends trade alerts, daily P&L, and crash notifications.
 * In dev mode (no RESEND_API_KEY), just logs to console.
 */

import nodemailer from 'nodemailer';
import { emailConfig } from '../config.js';
import { log } from '../logger.js';

let _transporter: nodemailer.Transporter | null = null;

function getTransporter(): nodemailer.Transporter | null {
  if (!emailConfig.apiKey) {
    return null;  // dev mode
  }
  if (_transporter) return _transporter;

  // Resend uses SMTP: smtp.resend.com:465 with api key as password
  _transporter = nodemailer.createTransport({
    host: 'smtp.resend.com',
    port: 465,
    secure: true,
    auth: {
      user: 'resend',
      pass: emailConfig.apiKey,
    },
  });
  return _transporter;
}

export async function sendEmail(subject: string, body: string): Promise<boolean> {
  const transporter = getTransporter();
  if (!transporter) {
    log.info('email (dev mode, no Resend key configured)', { subject, body });
    return false;
  }

  try {
    await transporter.sendMail({
      from: emailConfig.from,
      to: emailConfig.to,
      subject,
      text: body,
    });
    return true;
  } catch (e) {
    log.error('email send failed', { error: String(e), subject });
    return false;
  }
}

export async function notifyTradeEntry(details: {
  side: 'LONG' | 'SHORT';
  token: string;
  tokenSymbol?: string;
  sizeUSDT: number;
  price: number;
  stopLoss: number;
  takeProfit1: number;
  takeProfit2: number;
  signals: Record<string, unknown>;
}): Promise<void> {
  const emoji = details.side === 'LONG' ? '🟢' : '🔴';
  await sendEmail(
    `${emoji} ${details.side} ${details.tokenSymbol ?? details.token}`,
    `Àkànjí entered a ${details.side} position.\n\n` +
    `Token: ${details.token}\n` +
    `Size: $${details.sizeUSDT.toFixed(2)}\n` +
    `Entry: $${details.price.toFixed(6)}\n` +
    `Stop: $${details.stopLoss.toFixed(6)}\n` +
    `TP1: $${details.takeProfit1.toFixed(6)}\n` +
    `TP2: $${details.takeProfit2.toFixed(6)}\n\n` +
    `Signals: ${JSON.stringify(details.signals, null, 2)}`
  );
}

export async function notifyTradeExit(details: {
  side: 'LONG' | 'SHORT';
  token: string;
  tokenSymbol?: string;
  sizeUSDT: number;
  entryPrice: number;
  exitPrice: number;
  pnlUSDT: number;
  pnlPct: number;
  exitReason: string;
  heldHours: number;
}): Promise<void> {
  const win = details.pnlUSDT >= 0;
  const emoji = win ? '✅' : '❌';
  const sign = details.pnlUSDT >= 0 ? '+' : '';
  await sendEmail(
    `${emoji} ${details.exitReason}: ${sign}$${details.pnlUSDT.toFixed(2)} (${sign}${(details.pnlPct * 100).toFixed(2)}%)`,
    `Àkànjí closed a ${details.side} position.\n\n` +
    `Token: ${details.token}\n` +
    `Size: $${details.sizeUSDT.toFixed(2)}\n` +
    `Entry: $${details.entryPrice.toFixed(6)}\n` +
    `Exit: $${details.exitPrice.toFixed(6)}\n` +
    `P&L: ${sign}$${details.pnlUSDT.toFixed(2)} (${sign}${(details.pnlPct * 100).toFixed(2)}%)\n` +
    `Reason: ${details.exitReason}\n` +
    `Held: ${details.heldHours.toFixed(1)}h`
  );
}

export async function notifyDailyPnL(details: {
  date: string;
  startingCapital: number;
  endingCapital: number;
  realizedPnL: number;
  tradesCount: number;
  wins: number;
  losses: number;
  drawdownPct: number;
}): Promise<void> {
  const sign = details.realizedPnL >= 0 ? '+' : '';
  await sendEmail(
    `📊 Daily P&L ${sign}$${details.realizedPnL.toFixed(2)} (${sign}${((details.realizedPnL / details.startingCapital) * 100).toFixed(2)}%)`,
    `Àkànjí — Daily Report for ${details.date}\n\n` +
    `Starting capital: $${details.startingCapital.toFixed(2)}\n` +
    `Ending capital: $${details.endingCapital.toFixed(2)}\n` +
    `Realized P&L: ${sign}$${details.realizedPnL.toFixed(2)}\n` +
    `Trades: ${details.tradesCount} (${details.wins}W / ${details.losses}L)\n` +
    `Drawdown: ${(details.drawdownPct * 100).toFixed(2)}%`
  );
}

export async function notifyKillSwitch(details: {
  drawdownPct: number;
  totalLossUSDT: number;
  startingCapital: number;
  currentCapital: number;
}): Promise<void> {
  await sendEmail(
    `🚨 KILL SWITCH ACTIVATED — ${(details.drawdownPct * 100).toFixed(1)}% drawdown`,
    `Àkànjí has halted all trading due to drawdown limit.\n\n` +
    `Drawdown: ${(details.drawdownPct * 100).toFixed(2)}%\n` +
    `Total loss: $${details.totalLossUSDT.toFixed(2)}\n` +
    `Starting capital: $${details.startingCapital.toFixed(2)}\n` +
    `Current capital: $${details.currentCapital.toFixed(2)}\n\n` +
    `All open positions have been closed. Agent is now paused.`
  );
}
