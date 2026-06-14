import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { eq, and, desc, sql } from 'drizzle-orm';
import * as schema from './schema.js';
import { users, traders, follows, trades, agentkitUsage } from './schema.js';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  throw new Error('DATABASE_URL environment variable is required. Copy .env.example to .env and fill it in.');
}

// Aiven Postgres requires SSL; rejectUnauthorized:false accepts their managed cert
const client = postgres(DATABASE_URL, {
  ssl: { rejectUnauthorized: false },
  max: 10,
  idle_timeout: 20,
  connect_timeout: 10,
});

const db = drizzle(client, { schema });

export function getDb() {
  return db;
}

/**
 * Idempotent schema bootstrap — runs CREATE TABLE IF NOT EXISTS for every table
 * in the hackathon schema. Safe to call on every startup; never drops data.
 * This replaces drizzle-kit push so there are no interactive prompts in CI/Heroku.
 */
export async function initSchema() {
  console.log('[DB] Bootstrapping hackathon schema...');
  // Create the schema if it doesn’t exist yet
  await client`CREATE SCHEMA IF NOT EXISTS hackathon`;

  await client`
    CREATE TABLE IF NOT EXISTS hackathon.users (
      id          TEXT PRIMARY KEY,
      wallet_id   TEXT NOT NULL,
      wallet_address TEXT NOT NULL,
      private_key TEXT,
      risk_limit  REAL DEFAULT 0.05,
      created_at  BIGINT NOT NULL
    )
  `;

  await client`
    CREATE TABLE IF NOT EXISTS hackathon.traders (
      address       TEXT PRIMARY KEY,
      ens_name      TEXT,
      avatar        TEXT,
      total_trades  INTEGER DEFAULT 0,
      pnl           REAL DEFAULT 0.0,
      winrate       REAL DEFAULT 0.0,
      created_at    BIGINT NOT NULL
    )
  `;

  await client`
    CREATE TABLE IF NOT EXISTS hackathon.follows (
      user_id         TEXT NOT NULL REFERENCES hackathon.users(id) ON DELETE CASCADE,
      trader_address  TEXT NOT NULL REFERENCES hackathon.traders(address) ON DELETE CASCADE,
      multiplier      REAL DEFAULT 1.0,
      active          INTEGER DEFAULT 1,
      created_at      BIGINT NOT NULL,
      PRIMARY KEY (user_id, trader_address)
    )
  `;

  await client`
    CREATE TABLE IF NOT EXISTS hackathon.trades (
      id              TEXT PRIMARY KEY,
      user_id         TEXT NOT NULL REFERENCES hackathon.users(id) ON DELETE CASCADE,
      trader_address  TEXT NOT NULL REFERENCES hackathon.traders(address) ON DELETE CASCADE,
      trader_tx_hash  TEXT NOT NULL,
      copy_tx_hash    TEXT,
      token_in        TEXT NOT NULL,
      token_out       TEXT NOT NULL,
      amount_in       TEXT NOT NULL,
      amount_out      TEXT,
      timestamp       BIGINT NOT NULL
    )
  `;

  await client`
    CREATE TABLE IF NOT EXISTS hackathon.agentkit_usage (
      endpoint  TEXT NOT NULL,
      human_id  TEXT NOT NULL,
      count     INTEGER DEFAULT 0,
      purchased INTEGER DEFAULT 0,
      PRIMARY KEY (endpoint, human_id)
    )
  `;

  await client`
    CREATE TABLE IF NOT EXISTS hackathon.agentkit_nonces (
      nonce      TEXT PRIMARY KEY,
      created_at BIGINT NOT NULL
    )
  `;

  console.log('[DB] Schema ready.');
}

/** Seed demo traders on first boot if the table is empty */
export async function seedIfEmpty() {
  try {
    const now = Date.now();
    await db.insert(traders).values([
      {
        address: '0xd8da6bf26964af9d7eed9e03e53415d37aa96045',
        ensName: 'vitalik.eth',
        avatar: 'https://euc.li/vitalik.eth',
        totalTrades: 42,
        pnl: 12.5,
        winrate: 78.5,
        createdAt: now,
      },
      {
        address: '0xf4f7cebbd2c7b6dee34ab29fa55a116eff25239f',
        ensName: 'hot.cooperm.eth',
        avatar: null,
        totalTrades: 154,
        pnl: 45.2,
        winrate: 68.4,
        createdAt: now,
      },
      {
        address: '0x92d3acdf0484a6a8baf6fe3676b23af7cdbdbc98',
        ensName: 'bmac.eth',
        avatar: null,
        totalTrades: 89,
        pnl: 18.7,
        winrate: 62.0,
        createdAt: now,
      },
      {
        address: '0xbd9c944dcfb31cd24c81ebf1c974d950f44e42b8',
        ensName: 'theneetguy.eth',
        avatar: null,
        totalTrades: 112,
        pnl: 22.4,
        winrate: 59.5,
        createdAt: now,
      },
      {
        address: '0x799f768dfb8f3bbcd24fad9f1c98364b3883e785',
        ensName: 'guapalterman.eth',
        avatar: null,
        totalTrades: 45,
        pnl: 9.3,
        winrate: 54.2,
        createdAt: now,
      },
      {
        address: '0xaab4dfe6d735c4ac46217216fe883a39fbfe8284',
        ensName: 'junkai.eth',
        avatar: null,
        totalTrades: 67,
        pnl: 14.1,
        winrate: 57.8,
        createdAt: now,
      },
    ]).onConflictDoNothing();
    console.log('[DB] Seeded/synchronized demo traders.');
  } catch (err) {
    // Silently skip if schema not yet migrated; drizzle-kit push handles creation
    console.warn('[DB] Seed skipped:', (err as Error).message);
  }
}

// ─── DB Helpers ───────────────────────────────────────────────────────────────

export async function getUser(userId: string) {
  return db.select().from(users).where(eq(users.id, userId)).limit(1).then(r => r[0] ?? null);
}

export async function saveUser(userId: string, walletId: string, walletAddress: string, privateKey?: string) {
  const now = Date.now();
  return db.insert(users)
    .values({ id: userId, walletId, walletAddress, privateKey: privateKey || null, createdAt: now })
    .onConflictDoUpdate({
      target: users.id,
      set: { walletId, walletAddress, privateKey: privateKey || null }
    });
}

export async function getFollowedTraders(userId: string) {
  return db.select({
    address: traders.address,
    ensName: traders.ensName,
    avatar: traders.avatar,
    totalTrades: traders.totalTrades,
    pnl: traders.pnl,
    winrate: traders.winrate,
    multiplier: follows.multiplier,
    active: follows.active,
  })
  .from(follows)
  .innerJoin(traders, eq(follows.traderAddress, traders.address))
  .where(eq(follows.userId, userId));
}

export async function addFollow(userId: string, traderAddress: string, multiplier = 1.0) {
  const now = Date.now();
  return db.insert(follows)
    .values({ userId, traderAddress: traderAddress.toLowerCase(), multiplier, createdAt: now })
    .onConflictDoUpdate({
      target: [follows.userId, follows.traderAddress],
      set: { multiplier, active: 1 }
    });
}

export async function removeFollow(userId: string, traderAddress: string) {
  return db.delete(follows)
    .where(and(eq(follows.userId, userId), eq(follows.traderAddress, traderAddress.toLowerCase())));
}

export async function getTraders() {
  return db.select().from(traders).orderBy(desc(traders.pnl));
}

export async function addTrader(address: string, ensName: string | null, avatar: string | null) {
  const now = Date.now();
  return db.insert(traders)
    .values({ address: address.toLowerCase(), ensName, avatar, createdAt: now })
    .onConflictDoUpdate({
      target: traders.address,
      set: { ensName, avatar }
    });
}

export async function getFollowersOfTrader(traderAddress: string) {
  return db.select({
    id: users.id,
    walletId: users.walletId,
    walletAddress: users.walletAddress,
    privateKey: users.privateKey,
    riskLimit: users.riskLimit,
    multiplier: follows.multiplier,
  })
  .from(follows)
  .innerJoin(users, eq(follows.userId, users.id))
  .where(and(
    eq(follows.traderAddress, traderAddress.toLowerCase()),
    eq(follows.active, 1)
  ));
}

export async function recordTrade(
  id: string,
  userId: string,
  traderAddress: string,
  traderTxHash: string,
  copyTxHash: string | null,
  tokenIn: string,
  tokenOut: string,
  amountIn: string,
  amountOut: string | null
) {
  const now = Date.now();

  // Increment trader trade count
  await db.update(traders)
    .set({ totalTrades: sql`${traders.totalTrades} + 1` })
    .where(eq(traders.address, traderAddress.toLowerCase()));

  return db.insert(trades).values({
    id,
    userId,
    traderAddress: traderAddress.toLowerCase(),
    traderTxHash,
    copyTxHash: copyTxHash || null,
    tokenIn,
    tokenOut,
    amountIn,
    amountOut: amountOut || null,
    timestamp: now,
  });
}

export async function getTrades(userId: string) {
  return db.select()
    .from(trades)
    .where(eq(trades.userId, userId))
    .orderBy(desc(trades.timestamp));
}
