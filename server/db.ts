import { createRequire } from 'module';
import { eq, and, desc, sql } from 'drizzle-orm';
import path from 'path';
import fs from 'fs';
import * as schema from './schema.js';
import { users, traders, follows, trades, agentkitUsage, agentkitNonces } from './schema.js';

const require = createRequire(import.meta.url);

let sqliteDbInstance: any = null;
let drizzleDbInstance: any = null;

const isBun = typeof (process as any).versions.bun !== 'undefined';

export function getRawSqliteDb() {
  if (sqliteDbInstance) return sqliteDbInstance;
  
  const dbPath = path.resolve(process.cwd(), 'data/vouch.db');
  
  // Auto-create parent directory (critical for Heroku and fresh local setups)
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });

  if (isBun) {
    const { Database } = require('bun:sqlite');
    sqliteDbInstance = new Database(dbPath);
  } else {
    const Database = require('better-sqlite3');
    sqliteDbInstance = new Database(dbPath);
  }
  return sqliteDbInstance;
}

export function getDb() {
  if (drizzleDbInstance) return drizzleDbInstance;
  
  const sqlite = getRawSqliteDb();

  // Seed default traders if empty
  const countRow = sqlite.prepare('SELECT COUNT(*) as count FROM traders').get() as { count: number };
  if (countRow && countRow.count === 0) {
    const now = Date.now();
    sqlite.prepare('INSERT INTO traders (address, ens_name, avatar, total_trades, pnl, winrate, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
      '0xf16e4d81a014d3325136eb29fa0ceb6d2e539a432'.toLowerCase(), 'vitalik.eth', 'https://metadata.ens.domains/mainnet/avatar/vitalik.eth', 42, 12.5, 78.5, now
    );
    sqlite.prepare('INSERT INTO traders (address, ens_name, avatar, total_trades, pnl, winrate, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
      '0xb8c77482e45f1f44de1745f52c74426c631bdd52'.toLowerCase(), 'jason.eth', null, 28, 4.2, 64.0, now
    );
    sqlite.prepare('INSERT INTO traders (address, ens_name, avatar, total_trades, pnl, winrate, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
      '0xd8da6bf26964af9d7eed9e03e53415d37aa96045'.toLowerCase(), 'dave.eth', null, 15, -2.1, 40.0, now
    );
  }

  if (isBun) {
    const { drizzle } = require('drizzle-orm/bun-sqlite');
    drizzleDbInstance = drizzle(sqlite, { schema });
  } else {
    const { drizzle } = require('drizzle-orm/better-sqlite3');
    drizzleDbInstance = drizzle(sqlite, { schema });
  }

  return drizzleDbInstance;
}

// DB Helpers using Drizzle ORM

export async function getUser(userId: string) {
  const db = getDb();
  return db.select().from(users).where(eq(users.id, userId)).get();
}

export async function saveUser(userId: string, walletId: string, walletAddress: string, privateKey?: string) {
  const db = getDb();
  const now = Date.now();
  return db.insert(users)
    .values({
      id: userId,
      walletId,
      walletAddress,
      privateKey: privateKey || null,
      createdAt: now
    })
    .onConflictDoUpdate({
      target: users.id,
      set: { walletId, walletAddress, privateKey: privateKey || null }
    })
    .run();
}

export async function getFollowedTraders(userId: string) {
  const db = getDb();
  return db.select({
    address: traders.address,
    ensName: traders.ensName,
    avatar: traders.avatar,
    totalTrades: traders.totalTrades,
    pnl: traders.pnl,
    winrate: traders.winrate,
    multiplier: follows.multiplier,
    active: follows.active
  })
  .from(follows)
  .innerJoin(traders, eq(follows.traderAddress, traders.address))
  .where(eq(follows.userId, userId))
  .all();
}

export async function addFollow(userId: string, traderAddress: string, multiplier = 1.0) {
  const db = getDb();
  const now = Date.now();
  return db.insert(follows)
    .values({
      userId,
      traderAddress: traderAddress.toLowerCase(),
      multiplier,
      createdAt: now
    })
    .onConflictDoUpdate({
      target: [follows.userId, follows.traderAddress],
      set: { multiplier, active: 1 }
    })
    .run();
}

export async function removeFollow(userId: string, traderAddress: string) {
  const db = getDb();
  return db.delete(follows)
    .where(and(eq(follows.userId, userId), eq(follows.traderAddress, traderAddress.toLowerCase())))
    .run();
}

export async function getTraders() {
  const db = getDb();
  return db.select().from(traders).orderBy(desc(traders.pnl)).all();
}

export async function addTrader(address: string, ensName: string | null, avatar: string | null) {
  const db = getDb();
  const now = Date.now();
  return db.insert(traders)
    .values({
      address: address.toLowerCase(),
      ensName,
      avatar,
      createdAt: now
    })
    .onConflictDoUpdate({
      target: traders.address,
      set: { ensName, avatar }
    })
    .run();
}

export async function getFollowersOfTrader(traderAddress: string) {
  const db = getDb();
  return db.select({
    id: users.id,
    walletId: users.walletId,
    walletAddress: users.walletAddress,
    privateKey: users.privateKey,
    riskLimit: users.riskLimit,
    multiplier: follows.multiplier
  })
  .from(follows)
  .innerJoin(users, eq(follows.userId, users.id))
  .where(and(
    eq(follows.traderAddress, traderAddress.toLowerCase()),
    eq(follows.active, 1)
  ))
  .all();
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
  const db = getDb();
  const now = Date.now();

  // Increment trader trade count
  db.update(traders)
    .set({ totalTrades: sql`${traders.totalTrades} + 1` })
    .where(eq(traders.address, traderAddress.toLowerCase()))
    .run();

  // Record trade
  return db.insert(trades)
    .values({
      id,
      userId,
      traderAddress: traderAddress.toLowerCase(),
      traderTxHash,
      copyTxHash: copyTxHash || null,
      tokenIn,
      tokenOut,
      amountIn,
      amountOut: amountOut || null,
      timestamp: now
    })
    .run();
}

export async function getTrades(userId: string) {
  const db = getDb();
  return db.select()
    .from(trades)
    .where(eq(trades.userId, userId))
    .orderBy(desc(trades.timestamp))
    .all();
}
