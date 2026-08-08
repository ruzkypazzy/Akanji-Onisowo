/**
 * Logger — structured JSON to stdout + optional file
 */

import { tradingConfig } from './config.js';

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const currentLevel = LEVELS[(tradingConfig.logLevel as LogLevel) || 'info'];

function format(level: LogLevel, msg: string, meta?: Record<string, unknown>): string {
  const entry = {
    ts: new Date().toISOString(),
    level,
    msg,
    ...meta,
  };
  return JSON.stringify(entry);
}

export const log = {
  debug(msg: string, meta?: Record<string, unknown>): void {
    if (currentLevel <= LEVELS.debug) console.log(format('debug', msg, meta));
  },
  info(msg: string, meta?: Record<string, unknown>): void {
    if (currentLevel <= LEVELS.info) console.log(format('info', msg, meta));
  },
  warn(msg: string, meta?: Record<string, unknown>): void {
    if (currentLevel <= LEVELS.warn) console.warn(format('warn', msg, meta));
  },
  error(msg: string, meta?: Record<string, unknown>): void {
    if (currentLevel <= LEVELS.error) console.error(format('error', msg, meta));
  },
};
