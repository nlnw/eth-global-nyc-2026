import sqlite3 from 'sqlite3';
import { open, Database } from 'sqlite';
import path from 'path';

let dbInstance: Database | null = null;

export async function getDb(): Promise<Database> {
  if (dbInstance) return dbInstance;
  
  const dbPath = path.resolve(process.cwd(), 'data/vouch.db');
  dbInstance = await open({
    filename: dbPath,
    driver: sqlite3.Database
  });
  
  await initDb(dbInstance);
  return dbInstance;
}

async function initDb(db: Database) {
  // Enable foreign keys
  await db.run('PRAGMA foreign_keys = ON');

  // Users Table
  await db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      wallet_id TEXT NOT NULL,
      wallet_address TEXT NOT NULL,
      private_key TEXT,
      risk_limit REAL DEFAULT 0.05,
      created_at INTEGER NOT NULL
    )
  `);

  // Traders Table
  await db.exec(`
    CREATE TABLE IF NOT EXISTS traders (
      address TEXT PRIMARY KEY,
      ens_name TEXT,
      avatar TEXT,
      total_trades INTEGER DEFAULT 0,
      pnl REAL DEFAULT 0.0,
      winrate REAL DEFAULT 0.0,
      created_at INTEGER NOT NULL
    )
  `);

  // Follows Table
  await db.exec(`
    CREATE TABLE IF NOT EXISTS follows (
      user_id TEXT,
      trader_address TEXT,
      multiplier REAL DEFAULT 1.0,
      active INTEGER DEFAULT 1,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (user_id, trader_address),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (trader_address) REFERENCES traders(address) ON DELETE CASCADE
    )
  `);

  // Trades Table
  await db.exec(`
    CREATE TABLE IF NOT EXISTS trades (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      trader_address TEXT NOT NULL,
      trader_tx_hash TEXT NOT NULL,
      copy_tx_hash TEXT,
      token_in TEXT NOT NULL,
      token_out TEXT NOT NULL,
      amount_in TEXT NOT NULL,
      amount_out TEXT,
      timestamp INTEGER NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (trader_address) REFERENCES traders(address) ON DELETE CASCADE
    )
  `);

  // AgentKit Usage Table (Free Trial)
  await db.exec(`
    CREATE TABLE IF NOT EXISTS agentkit_usage (
      endpoint TEXT,
      human_id TEXT,
      count INTEGER DEFAULT 0,
      PRIMARY KEY (endpoint, human_id)
    )
  `);

  // AgentKit Nonces Table (Replay Protection)
  await db.exec(`
    CREATE TABLE IF NOT EXISTS agentkit_nonces (
      nonce TEXT PRIMARY KEY,
      timestamp INTEGER NOT NULL
    )
  `);

  // Insert seed traders if empty
  const count = await db.get('SELECT COUNT(*) as count FROM traders');
  if (count && count.count === 0) {
    const now = Date.now();
    // Seed some active mainnet (.eth) traders for leaderboard
    await db.run('INSERT INTO traders (address, ens_name, avatar, total_trades, pnl, winrate, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      '0xf16e4d81a014d3325136eb29fa0ceb6d2e539a432'.toLowerCase(), 'vitalik.eth', 'https://metadata.ens.domains/mainnet/avatar/vitalik.eth', 42, 12.5, 78.5, now
    );
    await db.run('INSERT INTO traders (address, ens_name, avatar, total_trades, pnl, winrate, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      '0xb8c77482e45f1f44de1745f52c74426c631bdd52'.toLowerCase(), 'jason.eth', null, 28, 4.2, 64.0, now
    );
    await db.run('INSERT INTO traders (address, ens_name, avatar, total_trades, pnl, winrate, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      '0xd8da6bf26964af9d7eed9e03e53415d37aa96045'.toLowerCase(), 'dave.eth', null, 15, -2.1, 40.0, now
    );
  }
}

// DB Helpers

export async function getUser(userId: string) {
  const db = await getDb();
  return db.get('SELECT * FROM users WHERE id = ?', userId);
}

export async function saveUser(userId: string, walletId: string, walletAddress: string, privateKey?: string) {
  const db = await getDb();
  const now = Date.now();
  return db.run(
    'INSERT INTO users (id, wallet_id, wallet_address, private_key, created_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET wallet_id = excluded.wallet_id, wallet_address = excluded.wallet_address, private_key = excluded.private_key',
    userId, walletId, walletAddress, privateKey || null, now
  );
}

export async function getFollowedTraders(userId: string) {
  const db = await getDb();
  return db.all(
    'SELECT t.*, f.multiplier, f.active FROM follows f JOIN traders t ON f.trader_address = t.address WHERE f.user_id = ?',
    userId
  );
}

export async function addFollow(userId: string, traderAddress: string, multiplier = 1.0) {
  const db = await getDb();
  const now = Date.now();
  return db.run(
    'INSERT INTO follows (user_id, trader_address, multiplier, created_at) VALUES (?, ?, ?, ?) ON CONFLICT(user_id, trader_address) DO UPDATE SET multiplier = excluded.multiplier, active = 1',
    userId, traderAddress.toLowerCase(), multiplier, now
  );
}

export async function removeFollow(userId: string, traderAddress: string) {
  const db = await getDb();
  return db.run('DELETE FROM follows WHERE user_id = ? AND trader_address = ?', userId, traderAddress.toLowerCase());
}

export async function getTraders() {
  const db = await getDb();
  return db.all('SELECT * FROM traders ORDER BY pnl DESC');
}

export async function addTrader(address: string, ensName: string | null, avatar: string | null) {
  const db = await getDb();
  const now = Date.now();
  return db.run(
    'INSERT INTO traders (address, ens_name, avatar, created_at) VALUES (?, ?, ?, ?) ON CONFLICT(address) DO UPDATE SET ens_name = excluded.ens_name, avatar = excluded.avatar',
    address.toLowerCase(), ensName, avatar, now
  );
}

export async function getFollowersOfTrader(traderAddress: string) {
  const db = await getDb();
  return db.all(
    'SELECT u.*, f.multiplier FROM follows f JOIN users u ON f.user_id = u.id WHERE f.trader_address = ? AND f.active = 1',
    traderAddress.toLowerCase()
  );
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
  const db = await getDb();
  const now = Date.now();
  
  // Also increment total trade count for trader
  await db.run(
    'UPDATE traders SET total_trades = total_trades + 1 WHERE address = ?',
    traderAddress.toLowerCase()
  );

  return db.run(
    'INSERT INTO trades (id, user_id, trader_address, trader_tx_hash, copy_tx_hash, token_in, token_out, amount_in, amount_out, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    id, userId, traderAddress.toLowerCase(), traderTxHash, copyTxHash, tokenIn, tokenOut, amountIn, amountOut, now
  );
}

export async function getTrades(userId: string) {
  const db = await getDb();
  return db.all('SELECT * FROM trades WHERE user_id = ? ORDER BY timestamp DESC', userId);
}
