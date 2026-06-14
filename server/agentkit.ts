import { createAgentBookVerifier } from "@worldcoin/agentkit";
import { verifyMessage } from "viem";
import { getDb } from "./db.js";
import { agentkitUsage } from "./schema.js";
import { eq, and } from "drizzle-orm";
import dotenv from "dotenv";

dotenv.config();

export const agentBook = createAgentBookVerifier();

/** Verifies the agent wallet address signed the challenge message */
export async function verifySignature(
  address: string,
  message: string,
  signature: string
): Promise<boolean> {
  try {
    return await verifyMessage({
      address: address as `0x${string}`,
      message,
      signature: signature as `0x${string}`
    });
  } catch (err) {
    console.error("Signature verification failed:", err);
    return false;
  }
}

/** Resolves an agent wallet address to a World ID humanId via AgentBook */
export async function getHumanId(address: string): Promise<string | null> {
  try {
    console.log(`Looking up humanId for ${address} on AgentBook...`);
    const humanId = await agentBook.lookupHuman(address);

    if (humanId) {
      console.log(`AgentBook match: humanId = ${humanId}`);
      return humanId;
    }

    console.log(`No AgentBook registration for ${address}.`);
    return null;
  } catch (err) {
    console.error("AgentBook lookup failed:", err);
    return null;
  }
}

/**
 * Atomically checks and increments the usage counter for a humanId.
 * Returns true if the trade is granted (within limit), false if exhausted.
 */
export async function tryIncrementHumanUsage(
  endpoint: string,
  humanId: string,
  limit: number
): Promise<boolean> {
  const db = getDb();

  try {
    return await db.transaction(async (tx) => {
      const rows = await tx.select()
        .from(agentkitUsage)
        .where(and(eq(agentkitUsage.endpoint, endpoint), eq(agentkitUsage.humanId, humanId)));

      const row = rows[0] ?? null;
      const count = row?.count ?? 0;
      const purchased = row?.purchased ?? 0;
      const effectiveLimit = limit + purchased; // 3 free + any WLD-purchased

      if (count >= effectiveLimit) return false;

      if (row) {
        await tx.update(agentkitUsage)
          .set({ count: count + 1 })
          .where(and(eq(agentkitUsage.endpoint, endpoint), eq(agentkitUsage.humanId, humanId)));
      } else {
        await tx.insert(agentkitUsage)
          .values({ endpoint, humanId, count: 1, purchased: 0 });
      }
      return true;
    });
  } catch (err) {
    console.error("Transaction error in tryIncrementHumanUsage:", err);
    return false;
  }
}

/** Returns the current usage count for a humanId */
export async function getHumanUsageCount(endpoint: string, humanId: string): Promise<number> {
  try {
    const rows = await getDb().select()
      .from(agentkitUsage)
      .where(and(eq(agentkitUsage.endpoint, endpoint), eq(agentkitUsage.humanId, humanId)));
    return rows[0]?.count ?? 0;
  } catch (err) {
    console.error("DB error in getHumanUsageCount:", err);
    return 0;
  }
}

/** Resets usage count to 0 (World ID re-verification refills free trades) */
export async function resetHumanUsage(endpoint: string, humanId: string): Promise<void> {
  await getDb().insert(agentkitUsage)
    .values({ endpoint, humanId, count: 0, purchased: 0 })
    .onConflictDoUpdate({
      target: [agentkitUsage.endpoint, agentkitUsage.humanId],
      set: { count: 0 }
    });
}

/**
 * Adds WLD-purchased extra copy-trades. Returns the new total purchased count.
 */
export async function purchaseExtraTrades(
  endpoint: string,
  humanId: string,
  amount: number
): Promise<number> {
  const db = getDb();

  return db.transaction(async (tx) => {
    const rows = await tx.select()
      .from(agentkitUsage)
      .where(and(eq(agentkitUsage.endpoint, endpoint), eq(agentkitUsage.humanId, humanId)));

    const row = rows[0] ?? null;
    const newPurchased = (row?.purchased ?? 0) + amount;

    if (row) {
      await tx.update(agentkitUsage)
        .set({ purchased: newPurchased })
        .where(and(eq(agentkitUsage.endpoint, endpoint), eq(agentkitUsage.humanId, humanId)));
    } else {
      await tx.insert(agentkitUsage)
        .values({ endpoint, humanId, count: 0, purchased: newPurchased });
    }
    return newPurchased;
  });
}
