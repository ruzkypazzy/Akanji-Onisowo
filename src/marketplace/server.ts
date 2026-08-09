/**
 * Àkànjí Oníṣòwò — Marketplace HTTP service
 *
 * Exposes a subscription-based signal feed to the OKX.AI marketplace.
 *
 * Architecture:
 *   - x402-paywalled `GET /v1/position` endpoint (3 USDT/month)
 *   - First 3 days free for every new wallet (no payment required)
 *   - SQLite-backed subscription state (wallet → start, expiry, paid status)
 *   - Free `/health` and `/.well-known/agent.json` endpoints
 *
 * This file is the single source of truth for the marketplace integration.
 * The trading agent (src/main.ts) runs in a separate process / thread and
 * writes its current position state to the same SQLite database.
 */

import express, { type RequestHandler } from "express";
import cors from "cors";
import helmet from "helmet";
import Database from "better-sqlite3";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { tradingConfig as appConfig } from "../config.js";

// x402 SDK imports — matches VEY1/VERSE2 pattern
import { OKXFacilitatorClient } from "@okxweb3/x402-core";
import { ExactEvmScheme } from "@okxweb3/x402-evm/exact/server";
import {
  paymentMiddlewareFromHTTPServer,
  x402HTTPResourceServer,
  x402ResourceServer,
} from "@okxweb3/x402-express";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ----- Configuration -----

const NETWORK = (process.env.X402_NETWORK ?? "eip155:196") as `eip155:${string}`;
const USDT0_ADDRESS =
  process.env.X402_ASSET ?? "0x779ded0c9e1022225f8e0630b35a9b54be713736";
const RECEIVING_WALLET =
  process.env.X402_RECEIVING_WALLET ??
  process.env.OKX_WALLET_ADDRESS ??
  "";
const PUBLIC_BASE_URL =
  process.env.PUBLIC_BASE_URL ?? "https://akanjionisowo.xyz";
const AGENT_NAME = "Àkànjí Oníṣòwò";
const PORT = parseInt(process.env.MARKETPLACE_PORT ?? "8082", 10);

const SUBSCRIPTION_PRICE_USDT = parseFloat(
  process.env.SUBSCRIPTION_PRICE_USDT ?? "3",
);
const TRIAL_DAYS = parseInt(process.env.TRIAL_DAYS ?? "3", 10);
const SUBSCRIPTION_PERIOD_DAYS = parseInt(
  process.env.SUBSCRIPTION_PERIOD_DAYS ?? "30",
  10);

const DB_PATH =
  process.env.MARKETPLACE_DB_PATH ?? "/app/data/marketplace.db";

interface Subscriber {
  wallet: string;
  started_at: number;
  expires_at: number;
  paid_count: number;
  total_paid_usdt: number;
}

function openDb(): Database.Database {
  const db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS subscribers (
      wallet TEXT PRIMARY KEY,
      started_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      paid_count INTEGER NOT NULL DEFAULT 0,
      total_paid_usdt REAL NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS access_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      wallet TEXT NOT NULL,
      endpoint TEXT NOT NULL,
      status TEXT NOT NULL,
      is_trial INTEGER NOT NULL DEFAULT 0,
      at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_access_log_at ON access_log(at);
  `);
  return db;
}

function getSubscriber(db: Database.Database, wallet: string): Subscriber | null {
  const row = db
    .prepare("SELECT * FROM subscribers WHERE wallet = ?")
    .get(wallet.toLowerCase()) as Subscriber | undefined;
  return row ?? null;
}

function ensureTrial(db: Database.Database, wallet: string): Subscriber {
  const existing = getSubscriber(db, wallet);
  if (existing) return existing;

  const now = Date.now();
  const trialExpiry = now + TRIAL_DAYS * 24 * 60 * 60 * 1000;
  db.prepare(
    `INSERT INTO subscribers (wallet, started_at, expires_at, paid_count, total_paid_usdt)
     VALUES (?, ?, ?, 0, 0)`,
  ).run(wallet.toLowerCase(), now, trialExpiry);
  return {
    wallet: wallet.toLowerCase(),
    started_at: now,
    expires_at: trialExpiry,
    paid_count: 0,
    total_paid_usdt: 0,
  };
}

function renewSubscription(
  db: Database.Database,
  wallet: string,
): Subscriber {
  const now = Date.now();
  const existing = getSubscriber(db, wallet);
  if (existing) {
    const newExpiry = Math.max(existing.expires_at, now) +
      SUBSCRIPTION_PERIOD_DAYS * 24 * 60 * 60 * 1000;
    db.prepare(
      `UPDATE subscribers
       SET expires_at = ?,
           paid_count = paid_count + 1,
           total_paid_usdt = total_paid_usdt + ?
       WHERE wallet = ?`,
    ).run(newExpiry, SUBSCRIPTION_PRICE_USDT, wallet.toLowerCase());
    return {
      ...existing,
      expires_at: newExpiry,
      paid_count: existing.paid_count + 1,
      total_paid_usdt: existing.total_paid_usdt + SUBSCRIPTION_PRICE_USDT,
    };
  }

  const expiry = now + SUBSCRIPTION_PERIOD_DAYS * 24 * 60 * 60 * 1000;
  db.prepare(
    `INSERT INTO subscribers (wallet, started_at, expires_at, paid_count, total_paid_usdt)
     VALUES (?, ?, ?, 1, ?)`,
  ).run(
    wallet.toLowerCase(),
    now,
    expiry,
    SUBSCRIPTION_PRICE_USDT,
  );
  return {
    wallet: wallet.toLowerCase(),
    started_at: now,
    expires_at: expiry,
    paid_count: 1,
    total_paid_usdt: SUBSCRIPTION_PRICE_USDT,
  };
}

function isActive(sub: Subscriber): boolean {
  return sub.expires_at > Date.now();
}

function readPositionState(): {
  mode: string;
  capital_usdt: number;
  cash_usdt: number;
  deployed_usdt: number;
  open_positions: Array<{
    token: string;
    symbol: string | null;
    side: "long" | "short";
    size_usdt: number;
    entry_price: number;
    exit_price: number | null;
    opened_at: number;
    pnl_usdt: number | null;
    pnl_pct: number | null;
  }>;
  daily_pnl_usdt: number;
  total_realized_pnl_usdt: number;
  last_journal_at: number | null;
  last_update: number;
} {
  const fallback = {
    mode: appConfig.tradingMode,
    capital_usdt: appConfig.totalCapitalUSDT,
    cash_usdt: appConfig.totalCapitalUSDT,
    deployed_usdt: 0,
    open_positions: [],
    daily_pnl_usdt: 0,
    total_realized_pnl_usdt: 0,
    last_journal_at: null,
    last_update: Date.now(),
  };

  try {
    const journalPath =
      process.env.JOURNAL_DB_PATH ?? "/app/data/journal.db";
    const journal = new Database(journalPath, { readonly: true });
    const positions = journal
      .prepare(
        `SELECT token, token_symbol, side, size_usdt, entry_price, exit_price, ts_open, pnl_usdt, pnl_pct
         FROM trades WHERE ts_close IS NULL ORDER BY ts_open DESC`,
      )
      .all() as Array<{
        token: string;
        token_symbol: string | null;
        side: "long" | "short";
        size_usdt: number;
        entry_price: number;
        exit_price: number | null;
        ts_open: number;
        pnl_usdt: number | null;
        pnl_pct: number | null;
      }>;
    const lastJournal = journal
      .prepare(
        `SELECT ts, action, token, details FROM journal ORDER BY ts DESC LIMIT 1`,
      )
      .get() as
      | { ts: number; action: string; token: string | null; details: string }
      | undefined;
    const heartbeat = journal
      .prepare(
        `SELECT ts, open_positions, capital, daily_pnl FROM heartbeat ORDER BY ts DESC LIMIT 1`,
      )
      .get() as
      | {
          ts: number;
          open_positions: number;
          capital: number;
          daily_pnl: number;
        }
      | undefined;
    const todayPnl = journal
      .prepare(
        `SELECT realized_pnl FROM daily_pnl WHERE date = date('now')`,
      )
      .get() as { realized_pnl: number } | undefined;
    const totalPnlRow = journal
      .prepare(
        `SELECT COALESCE(SUM(pnl_usdt), 0) AS total FROM trades WHERE ts_close IS NOT NULL`,
      )
      .get() as { total: number };
    journal.close();

    const deployed = positions.reduce(
      (acc, p) => acc + p.size_usdt,
      0,
    );

    return {
      mode: appConfig.tradingMode,
      capital_usdt: appConfig.totalCapitalUSDT,
      cash_usdt: appConfig.totalCapitalUSDT - deployed,
      deployed_usdt: deployed,
      open_positions: positions.map((p) => ({
        token: p.token,
        symbol: p.token_symbol,
        side: p.side,
        size_usdt: p.size_usdt,
        entry_price: p.entry_price,
        exit_price: p.exit_price,
        opened_at: p.ts_open,
        pnl_usdt: p.pnl_usdt,
        pnl_pct: p.pnl_pct,
      })),
      daily_pnl_usdt: todayPnl?.realized_pnl ?? 0,
      total_realized_pnl_usdt: totalPnlRow.total,
      last_journal_at: lastJournal?.ts ?? null,
      last_update: heartbeat?.ts ?? Date.now(),
    };
  } catch {
    return fallback;
  }
}

// ----- x402 setup -----

interface PaymentLayer {
  middleware: RequestHandler;
  /** Pending payer address captured by onAfterSettle hook, keyed by request id. */
  lastPayerByReqId: Map<string, string>;
}

function buildPaymentLayer(db: Database.Database): PaymentLayer {
  const apiKey = process.env.OKX_FACILITATOR_API_KEY;
  const secretKey = process.env.OKX_FACILITATOR_SECRET_KEY;
  const passphrase = process.env.OKX_FACILITATOR_PASSPHRASE;
  const missing: string[] = [];
  if (!apiKey) missing.push("OKX_FACILITATOR_API_KEY");
  if (!secretKey) missing.push("OKX_FACILITATOR_SECRET_KEY");
  if (!passphrase) missing.push("OKX_FACILITATOR_PASSPHRASE");
  if (missing.length > 0) {
    throw new Error(
      `x402 payment layer cannot start: missing env vars ${missing.join(", ")}`,
    );
  }
  if (!RECEIVING_WALLET) {
    throw new Error(
      "x402 payment layer cannot start: X402_RECEIVING_WALLET is not set",
    );
  }

  const facilitator = new OKXFacilitatorClient({
    apiKey: apiKey!,
    secretKey: secretKey!,
    passphrase: passphrase!,
    baseUrl: process.env.OKX_FACILITATOR_BASE_URL ?? "https://web3.okx.com",
    syncSettle: false,
  });

  const resourceServer = new x402ResourceServer(facilitator).register(
    NETWORK,
    new ExactEvmScheme(),
  );

  // Pending payer addresses captured by the onAfterSettle hook. The Express
  // request object doesn't survive the async settlement roundtrip, so we
  // record payers by request-id and look them up when the route handler runs.
  const lastPayerByReqId = new Map<string, string>();

  resourceServer.onAfterSettle(async (ctx) => {
    const payer = ctx.result.payer;
    const reqId =
      (ctx.transportContext as { reqId?: string } | undefined)?.reqId ?? "";
    if (payer && reqId) {
      lastPayerByReqId.set(reqId, payer.toLowerCase());
      // Auto-renew the subscription on every successful settle.
      try {
        renewSubscription(db, payer);
        db.prepare(
          `INSERT INTO access_log (wallet, endpoint, status, is_trial, at)
           VALUES (?, ?, 'paid', 0, ?)`,
        ).run(
          payer.toLowerCase(),
          "x402-settle",
          Date.now(),
        );
      } catch (err) {
        console.error(
          "[marketplace] onAfterSettle subscription renew error:",
          err,
        );
      }
    }
  });

  // Pre-populate the supported-kinds cache to avoid the Cloudflare 1010
  // block on the /api/v6/pay/x402/supported endpoint.
  const fakeSupportedResponse = {
    kinds: [
      {
        x402Version: 2,
        scheme: "exact",
        network: NETWORK,
        extra: { name: "USD\u20ae0", version: "1" },
      },
    ],
  };
  const schemeMap = new Map<string, unknown>();
  schemeMap.set("exact", fakeSupportedResponse);
  const networkMap = new Map<string, Map<string, unknown>>();
  networkMap.set(NETWORK, schemeMap);
  const versionMap = new Map<
    number,
    Map<string, Map<string, unknown>>
  >();
  versionMap.set(2, networkMap);
  (resourceServer as unknown as {
    supportedResponsesMap: typeof versionMap;
  }).supportedResponsesMap = versionMap;
  (resourceServer as unknown as {
    facilitatorClientsMap: Map<number, Map<string, Map<string, unknown>>>;
  }).facilitatorClientsMap = new Map([
    [2, new Map([[NETWORK, new Map([["exact", facilitator]])]])],
  ]);

  const feeAtomic = String(
    Math.round(SUBSCRIPTION_PRICE_USDT * 1_000_000),
  );
  const accepts = {
    scheme: "exact" as const,
    network: NETWORK,
    payTo: RECEIVING_WALLET,
    price: {
      asset: USDT0_ADDRESS,
      amount: feeAtomic,
      extra: { name: "USD\u20ae0", version: "1", decimals: 6 },
    },
    maxTimeoutSeconds: 300,
  };

  const httpServer = new x402HTTPResourceServer(resourceServer, {
    "GET /v1/position": {
      accepts,
      description:
        `${AGENT_NAME}: live X Layer DEX position feed (3 USDT/mo, 3-day free trial). ` +
        `Returns current open positions, daily PnL, last signal, and trading mode.`,
      mimeType: "application/json",
    },
    "POST /v1/subscribe": {
      accepts,
      description:
        `${AGENT_NAME}: pay subscription to extend access by 30 days.`,
      mimeType: "application/json",
    },
  });

  return {
    lastPayerByReqId,
    middleware: paymentMiddlewareFromHTTPServer(
      httpServer,
      {
        appName: AGENT_NAME,
        currentUrl: PUBLIC_BASE_URL,
      },
      undefined,
      false,
    ),
  };
}

// ----- Routes -----

async function main() {
  if (!RECEIVING_WALLET) {
    throw new Error("X402_RECEIVING_WALLET must be set");
  }

  const db = openDb();
  const app = express();
  app.set("trust proxy", 1);
  app.use(express.json({ limit: "1mb" }));
  app.use(
    cors({
      origin: true,
      exposedHeaders: [
        "PAYMENT-REQUIRED",
        "X-PAYMENT-RECEIPT",
        "X-Subscription-Trial",
        "X-Subscription-Expires-At",
      ],
    }),
  );
  app.use(helmet({ contentSecurityPolicy: false }));

  // A2A Agent Card — required for OKX marketplace discovery
  app.get("/.well-known/agent.json", (_req, res) => {
    res.json({
      name: AGENT_NAME,
      description:
        "Àkànjí Oníṣòwò translates from Yoruba to 'Àkànjí the trader'. " +
        "He is an autonomous X Layer DEX trading agent for the OKX.AI " +
        "Trading Hackathon Season 1. He executes onchain spot trades with " +
        "discipline: every position has a stop, every day has a loss limit, " +
        "every loss has a ceiling. Subscribe to his live position feed.",
      url: PUBLIC_BASE_URL,
      version: "1.0.0",
      provider: {
        organization: "ruzkypazzy",
        url: "https://github.com/ruzkypazzy/Akanji-Onisowo",
      },
      capabilities: {
        streaming: false,
        pushNotifications: false,
        stateTransition: false,
      },
      authentication: {
        schemes: ["x402"],
        x402Version: 2,
        network: NETWORK,
        asset: USDT0_ADDRESS,
        payTo: RECEIVING_WALLET,
        facilitator: "https://web3.okx.com",
      },
      defaultInputModes: ["application/json"],
      defaultOutputModes: ["application/json"],
      skills: [
        {
          id: "live_position_feed",
          name: "live_position_feed",
          description:
            "Get current open positions, daily PnL, and last signal " +
            "from Àkànjí Oníṣòwò.",
          tags: ["trading", "x-layer", "signal", "position", "okx"],
          inputSchema: {
            type: "object",
            properties: {
              wallet: {
                type: "string",
                description:
                  "EVM wallet address on X Layer (0x...); used to track " +
                  "your subscription and grant the free trial on first use.",
              },
            },
          },
          examples: [
            {
              description: "Get the current position feed as JSON",
              method: "GET",
              url: `${PUBLIC_BASE_URL}/v1/position?wallet=0xce34cff4e4d54cfb8b1b5496ba9ff7a28c4ace2a`,
              curl: `curl -X GET "${PUBLIC_BASE_URL}/v1/position?wallet=0xce34cff4e4d54cfb8b1b5496ba9ff7a28c4ace2a" -H "Accept: application/json"`,
            },
          ],
        },
      ],
    });
  });

  // Free liveness check
  app.get("/health", (_req, res) => {
    res.json({
      status: "ok",
      service: "akanji-marketplace",
      mode: appConfig.tradingMode,
      ts: Date.now(),
    });
  });

  // Build the x402 payment layer — this throws if env is incomplete
  const payments = buildPaymentLayer(db);

  // Attach a stable request id so the onAfterSettle hook can attach the
  // payer address to the right request, since Express's req object doesn't
  // survive the async settlement roundtrip.
  const attachReqId = (
    req: import("express").Request,
    _res: import("express").Response,
    next: import("express").NextFunction,
  ) => {
    (req as unknown as { reqId: string }).reqId = `req-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2, 8)}`;
    next();
  };

  // Read the payer that the onAfterSettle hook captured (if any) and
  // make it available to the route handler as req.payer.
  const attachPayer = (
    req: import("express").Request,
    res: import("express").Response,
    next: import("express").NextFunction,
  ) => {
    const reqId = (req as unknown as { reqId: string }).reqId;
    const payer = payments.lastPayerByReqId.get(reqId) ?? "";
    (req as unknown as { payer: string }).payer = payer;
    if (payer) {
      payments.lastPayerByReqId.delete(reqId);
      const sub = getSubscriber(db, payer);
      if (sub) {
        res.setHeader("X-Subscription-Expires-At", String(sub.expires_at));
      }
      db.prepare(
        `INSERT INTO access_log (wallet, endpoint, status, is_trial, at)
         VALUES (?, ?, 'paid', 0, ?)`,
      ).run(payer.toLowerCase(), req.path, Date.now());
    }
    next();
  };

  // /v1/position — main paid endpoint
  // The x402 middleware has already verified the payment and attached the
  // payer address to req.payer (via lastPayerByReqId map). If the request
  // reached this handler, either:
  //   (a) payment was verified (req.payer is set), OR
  //   (b) x402 middleware already returned 402 with PAYMENT-REQUIRED header
  //       and the route handler was not invoked.
  app.get(
    "/v1/position",
    attachReqId,
    payments.middleware,
    attachPayer,
    (req, res) => {
    const payer = (req as unknown as { payer: string }).payer || "";
    const wallet =
      payer ||
      ((req.headers["x-wallet"] as string) ||
        (req.query.wallet as string) ||
        "");

    if (!wallet) {
      // Shouldn't happen — x402 middleware already returned 402. This is a
      // defensive fallback only.
      res.status(402).json({
        error: "wallet_required",
        message: "Send a valid x402 payment receipt to access this service.",
      });
      return;
    }

    // Paid request (or trial-with-wallet): record and return data
    if (!payer) {
      // Wallet supplied without payment = trial mode
      const sub = ensureTrial(db, wallet);
      if (isActive(sub)) {
        res.setHeader("X-Subscription-Trial", "true");
        res.setHeader("X-Subscription-Expires-At", String(sub.expires_at));
        db.prepare(
          `INSERT INTO access_log (wallet, endpoint, status, is_trial, at)
           VALUES (?, ?, 'trial', 1, ?)`,
        ).run(wallet.toLowerCase(), req.path, Date.now());
      } else {
        // Trial expired, no payment. Return 402 to force a paid request.
        // Note: this case shouldn't happen because x402 middleware would
        // have already returned 402 with the challenge. The trial logic
        // is a courtesy for first-time wallets.
        res.status(402).json({
          error: "trial_expired",
          message: `Your ${TRIAL_DAYS}-day free trial has ended. ` +
            `Send a valid x402 payment receipt (${SUBSCRIPTION_PRICE_USDT} USDT) to continue.`,
          price_usdt: SUBSCRIPTION_PRICE_USDT,
        });
        return;
      }
    }

    const state = readPositionState();
    const sub = getSubscriber(db, wallet);
    res.json({
      agent: AGENT_NAME,
      wallet: wallet.toLowerCase(),
      subscription: {
        is_trial: !payer,
        price_usdt: SUBSCRIPTION_PRICE_USDT,
        period_days: SUBSCRIPTION_PERIOD_DAYS,
        trial_days: TRIAL_DAYS,
        expires_at: sub?.expires_at ?? null,
        days_remaining: sub
          ? Math.max(
              0,
              Math.ceil(
                (sub.expires_at - Date.now()) / (24 * 60 * 60 * 1000),
              ),
            )
          : 0,
      },
      state,
      note:
        "Data is read-only. Use POST /v1/subscribe to extend your subscription. " +
        "Subscriptions are managed by the ASP and recorded on X Layer via x402.",
    });
  },
  );

  // /v1/subscribe — explicit subscription renewal endpoint
  app.post(
    "/v1/subscribe",
    attachReqId,
    payments.middleware,
    attachPayer,
    (req, res) => {
    const payer = (req as unknown as { payer: string }).payer || "";
    if (!payer) {
      // Defensive: x402 middleware should have already returned 402.
      res.status(402).json({
        error: "payment_required",
        message: "Send a valid x402 payment receipt to subscribe.",
      });
      return;
    }
    const sub = renewSubscription(db, payer);
    res.json({
      ok: true,
      wallet: sub.wallet,
      paid_count: sub.paid_count,
      total_paid_usdt: sub.total_paid_usdt,
      expires_at: sub.expires_at,
      days_remaining: Math.max(
        0,
        Math.ceil((sub.expires_at - Date.now()) / (24 * 60 * 60 * 1000)),
      ),
    });
  },
  );

  // Generic 404
  app.use((_req, res) => {
    res.status(404).json({
      error: "not_found",
      message: "Endpoint not found. See /.well-known/agent.json for available skills.",
    });
  });

  app.listen(PORT, "0.0.0.0", () => {
    console.log(
      `[marketplace] ${AGENT_NAME} HTTP service listening on :${PORT}`,
    );
    console.log(
      `[marketplace] Health: ${PUBLIC_BASE_URL}/health`,
    );
    console.log(
      `[marketplace] Paid:   ${PUBLIC_BASE_URL}/v1/position  (${SUBSCRIPTION_PRICE_USDT} USDT/mo, ${TRIAL_DAYS}-day free trial)`,
    );
  });
}

// Type-only re-export to satisfy the linter when this file is imported
// in the trading agent process.
export type { Subscriber };

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error("[marketplace] fatal:", err);
    process.exit(1);
  });
}
