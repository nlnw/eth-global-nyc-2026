import { pgSchema, text, integer, bigint, real, primaryKey } from 'drizzle-orm/pg-core';

// All tables live in the "hackathon" PostgreSQL schema
const hackathon = pgSchema('hackathon');

export const users = hackathon.table('users', {
  id: text('id').primaryKey(),
  walletId: text('wallet_id').notNull(),
  walletAddress: text('wallet_address').notNull(),
  privateKey: text('private_key'),
  riskLimit: real('risk_limit').default(0.05),
  createdAt: bigint('created_at', { mode: 'number' }).notNull(),
});

export const traders = hackathon.table('traders', {
  address: text('address').primaryKey(),
  ensName: text('ens_name'),
  avatar: text('avatar'),
  totalTrades: integer('total_trades').default(0),
  pnl: real('pnl').default(0.0),
  winrate: real('winrate').default(0.0),
  createdAt: bigint('created_at', { mode: 'number' }).notNull(),
});

export const follows = hackathon.table('follows', {
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  traderAddress: text('trader_address').notNull().references(() => traders.address, { onDelete: 'cascade' }),
  multiplier: real('multiplier').default(1.0),
  active: integer('active').default(1),
  createdAt: bigint('created_at', { mode: 'number' }).notNull(),
}, (table) => ({
  pk: primaryKey({ columns: [table.userId, table.traderAddress] }),
}));

export const trades = hackathon.table('trades', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  traderAddress: text('trader_address').notNull().references(() => traders.address, { onDelete: 'cascade' }),
  traderTxHash: text('trader_tx_hash').notNull(),
  copyTxHash: text('copy_tx_hash'),
  tokenIn: text('token_in').notNull(),
  tokenOut: text('token_out').notNull(),
  amountIn: text('amount_in').notNull(),
  amountOut: text('amount_out'),
  timestamp: bigint('timestamp', { mode: 'number' }).notNull(),
});

export const agentkitUsage = hackathon.table('agentkit_usage', {
  endpoint: text('endpoint').notNull(),
  humanId: text('human_id').notNull(),
  count: integer('count').default(0),
  purchased: integer('purchased').default(0),
}, (table) => ({
  pk: primaryKey({ columns: [table.endpoint, table.humanId] }),
}));

export const agentkitNonces = hackathon.table('agentkit_nonces', {
  nonce: text('nonce').primaryKey(),
  createdAt: bigint('created_at', { mode: 'number' }).notNull(),
});
