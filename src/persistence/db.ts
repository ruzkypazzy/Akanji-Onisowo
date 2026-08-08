/**
 * SQLite persistence layer.
 *
 * Schema: journal, trades, daily_pnl, heartbeat.
 * No migrations needed for v1 — single fresh database.
 */

import Database from 'better-sqlite3';
import { join, dirname } from 'path';
import { mkdirSync } from 'fs';
import type { JournalEntry, Trade, DailyPnL } from '../types.js';

const DB_DIR = join(process.cwd(), 'data');
const DB_PATH = join(DB_DIR, 'journal.db');

let _db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (_db) return _db;
  mkdirSync(DB_DIR, { recursive: true });
  _db = new Database(DB_PATH);
  _db.pragma('journal_mode = WAL');
  initSchema(_db);
  return _db;
}

function initSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS journal (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts INTEGER NOT NULL,
      tick INTEGER NOT NULL,
      action TEXT NOT NULL,
      token TEXT,
      details JSON NOT NULL
    );

    CREATE TABLE IF NOT EXISTS trades (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts_open INTEGER NOT NULL,
      ts_close INTEGER,
      token TEXT NOT NULL,
      token_symbol TEXT,
      side TEXT NOT NULL,
      entry_price REAL NOT NULL,
      exit_price REAL,
      size_usdt REAL NOT NULL,
      pnl_usdt REAL,
      pnl_pct REAL,
      exit_reason TEXT,
      signals JSON
    );

    CREATE TABLE IF NOT EXISTS daily_pnl (
      date TEXT PRIMARY KEY,
      starting_capital REAL,
      ending_capital REAL,
      realized_pnl REAL,
      unrealized_pnl REAL,
      trades_count INTEGER,
      wins INTEGER,
      losses INTEGER,
      drawdown_pct REAL
    );

    CREATE TABLE IF NOT EXISTS heartbeat (
      ts INTEGER PRIMARY KEY,
      open_positions INTEGER,
      capital REAL,
      daily_pnl REAL
    );

    CREATE INDEX IF NOT EXISTS idx_journal_ts ON journal(ts);
    CREATE INDEX IF NOT EXISTS idx_trades_open ON trades(ts_open);
    CREATE INDEX IF NOT EXISTS idx_trades_close ON trades(ts_close);
  `);
}

export function logJournal(entry: Omit<JournalEntry, 'id'>): void {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT INTO journal (ts, tick, action, token, details)
    VALUES (?, ?, ?, ?, ?)
  `);
  stmt.run(entry.ts, entry.tick, entry.action, entry.token ?? null, JSON.stringify(entry.details));
}

export function insertTrade(trade: Omit<Trade, 'id'>): number {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT INTO trades (ts_open, ts_close, token, token_symbol, side, entry_price, exit_price, size_usdt, pnl_usdt, pnl_pct, exit_reason, signals)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const result = stmt.run(
    trade.tsOpen,
    trade.tsClose ?? null,
    trade.token,
    trade.tokenSymbol ?? null,
    trade.side,
    trade.entryPrice,
    trade.exitPrice ?? null,
    trade.sizeUSDT,
    trade.pnlUSDT ?? null,
    trade.pnlPct ?? null,
    trade.exitReason ?? null,
    trade.signals ? JSON.stringify(trade.signals) : null
  );
  return result.lastInsertRowid as number;
}

export function closeTrade(tradeId: number, close: {
  tsClose: number;
  exitPrice: number;
  pnlUSDT: number;
  pnlPct: number;
  exitReason: string;
}): void {
  const db = getDb();
  db.prepare(`
    UPDATE trades
    SET ts_close = ?, exit_price = ?, pnl_usdt = ?, pnl_pct = ?, exit_reason = ?
    WHERE id = ?
  `).run(close.tsClose, close.exitPrice, close.pnlUSDT, close.pnlPct, close.exitReason, tradeId);
}

export function getOpenTrades(): Trade[] {
  const db = getDb();
  const rows = db.prepare(`SELECT * FROM trades WHERE ts_close IS NULL ORDER BY ts_open DESC`).all() as any[];
  return rows.map(rowToTrade);
}

export function getTodayTrades(todayStr: string): Trade[] {
  const db = getDb();
  const rows = db.prepare(`
    SELECT * FROM trades
    WHERE date(ts_open / 1000, 'unixepoch') = ?
    ORDER BY ts_open DESC
  `).all(todayStr) as any[];
  return rows.map(rowToTrade);
}

export function getTodayRealizedPnL(todayStr: string): number {
  const db = getDb();
  const row = db.prepare(`
    SELECT COALESCE(SUM(pnl_usdt), 0) as total
    FROM trades
    WHERE date(ts_close / 1000, 'unixepoch') = ?
      AND ts_close IS NOT NULL
  `).get(todayStr) as { total: number };
  return row.total || 0;
}

export function recordHeartbeat(openPositions: number, capital: number, dailyPnL: number): void {
  const db = getDb();
  db.prepare(`INSERT OR REPLACE INTO heartbeat (ts, open_positions, capital, daily_pnl) VALUES (?, ?, ?, ?)`)
    .run(Date.now(), openPositions, capital, dailyPnL);
}

export function getLastHeartbeat(): { ts: number; open_positions: number; capital: number; daily_pnl: number } | undefined {
  const db = getDb();
  return db.prepare(`SELECT * FROM heartbeat ORDER BY ts DESC LIMIT 1`).get() as any;
}

export function upsertDailyPnL(snapshot: DailyPnL): void {
  const db = getDb();
  db.prepare(`
    INSERT OR REPLACE INTO daily_pnl
    (date, starting_capital, ending_capital, realized_pnl, unrealized_pnl, trades_count, wins, losses, drawdown_pct)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    snapshot.date,
    snapshot.startingCapital,
    snapshot.endingCapital,
    snapshot.realizedPnL,
    snapshot.unrealizedPnL,
    snapshot.tradesCount,
    snapshot.wins,
    snapshot.losses,
    snapshot.drawdownPct
  );
}

function rowToTrade(row: any): Trade {
  return {
    id: row.id,
    tsOpen: row.ts_open,
    tsClose: row.ts_close ?? undefined,
    token: row.token,
    tokenSymbol: row.token_symbol ?? undefined,
    side: row.side,
    entryPrice: row.entry_price,
    exitPrice: row.exit_price ?? undefined,
    sizeUSDT: row.size_usdt,
    pnlUSDT: row.pnl_usdt ?? undefined,
    pnlPct: row.pnl_pct ?? undefined,
    exitReason: row.exit_reason ?? undefined,
    signals: row.signals ? JSON.parse(row.signals) : undefined,
  };
}

export function closeDb(): void {
  if (_db) {
    _db.close();
    _db = null;
  }
}
