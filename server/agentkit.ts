import { createAgentBookVerifier } from "@worldcoin/agentkit";
import { verifyMessage } from "viem";
import { getDb } from "./db.js";
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
  const db = await getDb();
  
  // Wrap in SQLite transaction
  await db.run("BEGIN TRANSACTION");
  try {
    const row = await db.get(
      "SELECT count FROM agentkit_usage WHERE endpoint = ? AND human_id = ?",
      endpoint,
      humanId
    );
    
    const count = row ? row.count : 0;
    if (count >= limit) {
      await db.run("ROLLBACK");
      return false;
    }
    
    if (row) {
      await db.run(
        "UPDATE agentkit_usage SET count = count + 1 WHERE endpoint = ? AND human_id = ?",
        endpoint,
        humanId
      );
    } else {
      await db.run(
        "INSERT INTO agentkit_usage (endpoint, human_id, count) VALUES (?, ?, 1)",
        endpoint,
        humanId
      );
    }
    
    await db.run("COMMIT");
    return true;
  } catch (err) {
    await db.run("ROLLBACK");
    console.error("Database error in tryIncrementHumanUsage:", err);
    throw err;
  }
}

/**
 * Returns the current usage count for a humanId
 */
export async function getHumanUsageCount(endpoint: string, humanId: string): Promise<number> {
  const db = await getDb();
  const row = await db.get(
    "SELECT count FROM agentkit_usage WHERE endpoint = ? AND human_id = ?",
    endpoint,
    humanId
  );
  return row ? row.count : 0;
}
