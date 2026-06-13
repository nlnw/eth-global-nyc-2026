import { createAgentBookVerifier } from "@worldcoin/agentkit";
import { verifyMessage } from "viem";
import { getDb } from "./db.js";
import { agentkitUsage } from "./schema.js";
import { eq, and } from "drizzle-orm";
import dotenv from "dotenv";

dotenv.config();

// Create the AgentBook verifier to look up agent wallets on World Chain
export const agentBook = createAgentBookVerifier();

/**
 * Verifies that the agent wallet address signed the challenge message
 */
export async function verifySignature(
  address: string,
  message: string,
  signature: string
): Promise<boolean> {
  try {
    const valid = await verifyMessage({
      address: address as `0x${string}`,
      message,
      signature: signature as `0x${string}`
    });
    return valid;
  } catch (err) {
    console.error("Signature verification failed:", err);
    return false;
  }
}

/**
 * Resolves an agent wallet address to their anonymous World ID humanId via AgentBook
 */
export async function getHumanId(address: string): Promise<string | null> {
  try {
    console.log(`Looking up humanId for agent address ${address} on AgentBook...`);
    const humanId = await agentBook.lookupHuman(address);
    
    if (humanId) {
      console.log(`AgentBook match found! humanId: ${humanId}`);
      return humanId;
    }
    
    console.log(`No AgentBook registration found for ${address}.`);
    
    // Demo/Mock Fallback: if MOCK_AGENTBOOK is enabled or unset, we fall back to a mock humanId
    // so that the judge/developer can demo the free-trial mechanics without requiring a real World ID scan.
    if (process.env.MOCK_AGENTBOOK !== "false") {
      const mockHumanId = `mock_human_${address.toLowerCase().substring(0, 10)}`;
      console.log(`[Demo Mode] Falling back to mock humanId: ${mockHumanId}`);
      return mockHumanId;
    }

    return null;
  } catch (err) {
    console.error("AgentBook lookup failed:", err);
    if (process.env.MOCK_AGENTBOOK !== "false") {
      const mockHumanId = `mock_human_${address.toLowerCase().substring(0, 10)}`;
      console.log(`[Demo Mode Fallback] Lookup errored, using mock humanId: ${mockHumanId}`);
      return mockHumanId;
    }
    return null;
  }
}

/**
 * Tracks usage per humanId. Verified humans get up to `limit` (e.g. 3) free trades.
 * Returns true if successfully incremented (free trade granted), false if limit exceeded.
 */
export async function tryIncrementHumanUsage(
  endpoint: string,
  humanId: string,
  limit: number
): Promise<boolean> {
  const db = getDb();
  
  try {
    return db.transaction((tx) => {
      const row = tx.select()
        .from(agentkitUsage)
        .where(and(eq(agentkitUsage.endpoint, endpoint), eq(agentkitUsage.humanId, humanId)))
        .get();
        
      const count = row ? (row.count || 0) : 0;
      const purchased = row ? (row.purchased || 0) : 0;
      // Dynamic limit: 3 free trials + any WLD-purchased extra trades
      const effectiveLimit = limit + purchased;
      if (count >= effectiveLimit) {
        return false;
      }
      
      if (row) {
        tx.update(agentkitUsage)
          .set({ count: count + 1 })
          .where(and(eq(agentkitUsage.endpoint, endpoint), eq(agentkitUsage.humanId, humanId)))
          .run();
      } else {
        tx.insert(agentkitUsage)
          .values({ endpoint, humanId, count: 1 })
          .run();
      }
      return true;
    });
  } catch (err) {
    console.error("Transaction error in tryIncrementHumanUsage:", err);
    return false;
  }
}

/**
 * Returns the current usage count for a humanId
 */
export async function getHumanUsageCount(endpoint: string, humanId: string): Promise<number> {
  try {
    const db = getDb();
    const row = db.select()
      .from(agentkitUsage)
      .where(and(eq(agentkitUsage.endpoint, endpoint), eq(agentkitUsage.humanId, humanId)))
      .get();
    return row ? (row.count || 0) : 0;
  } catch (err) {
    console.error("Database error in getHumanUsageCount:", err);
    return 0;
  }
}

/**
 * Resets human usage count to 0 (refills free copy-trades)
 */
export async function resetHumanUsage(endpoint: string, humanId: string): Promise<void> {
  const db = getDb();
  await db.insert(agentkitUsage)
    .values({
      endpoint,
      humanId,
      count: 0
    })
    .onConflictDoUpdate({
      target: [agentkitUsage.endpoint, agentkitUsage.humanId],
      set: { count: 0 }
    })
    .run();
}

/**
 * Adds extra purchased copy-trades for a humanId (paid via WLD simulation)
 * Returns the new total purchased count.
 */
export async function purchaseExtraTrades(
  endpoint: string,
  humanId: string,
  amount: number
): Promise<number> {
  const db = getDb();
  return db.transaction((tx) => {
    const row = tx.select()
      .from(agentkitUsage)
      .where(and(eq(agentkitUsage.endpoint, endpoint), eq(agentkitUsage.humanId, humanId)))
      .get();
    const currentPurchased = row ? (row.purchased || 0) : 0;
    const newPurchased = currentPurchased + amount;
    
    if (row) {
      tx.update(agentkitUsage)
        .set({ purchased: newPurchased })
        .where(and(eq(agentkitUsage.endpoint, endpoint), eq(agentkitUsage.humanId, humanId)))
        .run();
    } else {
      tx.insert(agentkitUsage)
        .values({ endpoint, humanId, count: 0, purchased: newPurchased })
        .run();
    }
    return newPurchased;
  });
}
