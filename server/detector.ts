import fetch from "node-fetch";
import dotenv from "dotenv";
import { getDb, getFollowersOfTrader, recordTrade } from "./db.js";
import { createAgentkitClient } from "@worldcoin/agentkit";
import { privateKeyToAccount } from "viem/accounts";
import { generatePrivateKey } from "viem/accounts";
import { eq } from "drizzle-orm";
import { follows, trades } from "./schema.js";

dotenv.config();

// Keep track of processed transaction hashes to prevent duplicate copy trades
const processedTxHashes = new Set<string>();

// Dynamic Agent Wallet generation if not provided in .env
let agentPrivateKey = process.env.AGENT_PRIVATE_KEY;
if (!agentPrivateKey || agentPrivateKey.startsWith("mock_")) {
  console.log("--------------------------------------------------------------------------------");
  console.log("AGENT_PRIVATE_KEY not set in .env. Generating a dynamic agent wallet for the demo...");
  agentPrivateKey = generatePrivateKey();
  const account = privateKeyToAccount(agentPrivateKey as `0x${string}`);
  console.log(`\x1b[33m%s\x1b[0m`, `=== ACTION REQUIRED: To enable real World ID free copy-trades, register this wallet in AgentBook:`);
  console.log(`\x1b[36m%s\x1b[0m`, `   npx @worldcoin/agentkit-cli register ${account.address}`);
  console.log("--------------------------------------------------------------------------------");
}

const agentAccount = privateKeyToAccount(agentPrivateKey as `0x${string}`);

// Setup the AgentKit client using the agent's signer
// This client automatically signs HTTP requests to our server's gated x402 endpoints
export const agentKitClient = createAgentkitClient({
  signer: {
    address: agentAccount.address,
    chainId: "eip155:84532", // Base Sepolia
    type: "eip191",
    signMessage: async (message) => {
      return agentAccount.signMessage({ message });
    }
  }
});

export interface DetectedSwap {
  trader: string;
  txHash: string;
  tokenIn: string;
  tokenOut: string;
  amountIn: string;
  amountOut: string;
  timestamp: number;
}

// Background poll loop
export function startDetectionLoop(intervalMs = 15000) {
  console.log(`Starting swap detection loop (every ${intervalMs / 1000}s)...`);
  setInterval(async () => {
    try {
      const db = await getDb();
      const traders = await db.selectDistinct({ address: follows.traderAddress })
        .from(follows)
        .where(eq(follows.active, 1));
      
      for (const trader of traders) {
        await pollTraderSwaps(trader.address);
      }
    } catch (err) {
      console.error("Error in swap detection loop:", err);
    }
  }, intervalMs);
}

// Poll Etherscan tokentx API for a trader address
async function pollTraderSwaps(traderAddress: string) {
  const apiKey = process.env.ETHERSCAN_API_KEY || "";
  const url = `https://api.etherscan.io/api?module=account&action=tokentx&address=${traderAddress}&page=1&offset=15&sort=desc${apiKey ? `&apikey=${apiKey}` : ""}`;

  try {
    const res = await fetch(url);
    const data = await res.json() as any;
    
    if (data.status !== "1" || !data.result || !Array.isArray(data.result)) {
      return;
    }

    // Group token transfers by txHash
    const txGroups: { [hash: string]: any[] } = {};
    for (const tx of data.result) {
      if (!txGroups[tx.hash]) {
        txGroups[tx.hash] = [];
      }
      txGroups[tx.hash].push(tx);
    }

    // Identify swaps: we look for transfers out and transfers in within the same tx
    for (const [txHash, transfers] of Object.entries(txGroups)) {
      if (processedTxHashes.has(txHash)) continue;

      // Check if we've already stored this trade in db
      const db = await getDb();
      const existingTrade = await db.select({ id: trades.id })
        .from(trades)
        .where(eq(trades.traderTxHash, txHash))
        .get();
      if (existingTrade) {
        processedTxHashes.add(txHash);
        continue;
      }

      // Find token transferred out of the trader's wallet (tokenIn)
      const outTransfer = transfers.find(t => t.from.toLowerCase() === traderAddress.toLowerCase());
      // Find token transferred into the trader's wallet (tokenOut)
      const inTransfer = transfers.find(t => t.to.toLowerCase() === traderAddress.toLowerCase());

      if (outTransfer && inTransfer) {
        const swap: DetectedSwap = {
          trader: traderAddress,
          txHash,
          tokenIn: outTransfer.contractAddress,
          tokenOut: inTransfer.contractAddress,
          amountIn: (Number(outTransfer.value) / Math.pow(10, Number(outTransfer.tokenDecimal))).toString(),
          amountOut: (Number(inTransfer.value) / Math.pow(10, Number(inTransfer.tokenDecimal))).toString(),
          timestamp: Number(outTransfer.timeStamp) * 1000
        };

        processedTxHashes.add(txHash);
        console.log(`Detected live swap from followed trader ${traderAddress}: ${swap.amountIn} ${outTransfer.tokenSymbol} -> ${swap.amountOut} ${inTransfer.tokenSymbol}`);
        await triggerCopyTrade(swap);
      }
    }
  } catch (err) {
    console.error(`Failed to poll swaps for trader ${traderAddress}:`, err);
  }
}

// Trigger simulated/dev swaps
export async function simulateTraderSwap(
  traderAddress: string,
  tokenIn: string,
  tokenOut: string,
  amountIn: string,
  amountOut: string
) {
  const txHash = "0xsimulated_" + Math.random().toString(36).substring(2, 15);
  const swap: DetectedSwap = {
    trader: traderAddress.toLowerCase(),
    txHash,
    tokenIn,
    tokenOut,
    amountIn,
    amountOut,
    timestamp: Date.now()
  };

  console.log(`Simulating swap: ${amountIn} (${tokenIn}) -> ${amountOut} (${tokenOut}) by ${traderAddress}`);
  await triggerCopyTrade(swap);
  return txHash;
}

// Replicate the swap across all followers by hitting the gated `/api/copy` endpoint
async function triggerCopyTrade(swap: DetectedSwap) {
  const followers = await getFollowersOfTrader(swap.trader);
  if (followers.length === 0) return;

  const serverPort = process.env.PORT || "3000";
  const copyUrl = `http://localhost:${serverPort}/api/copy`;

  for (const follower of followers) {
    // Scale amount according to the follower's multiplier
    const scaledAmount = (Number(swap.amountIn) * follower.multiplier).toString();

    try {
      console.log(`Triggering copy trade for follower ${follower.id}...`);
      // We make a signed request using agentKitClient.fetch
      // This will append the required headers for AgentKit proof-of-human validation
      const res = await agentKitClient.fetch(copyUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          userId: follower.id,
          swap: {
            trader: swap.trader,
            txHash: swap.txHash,
            tokenIn: swap.tokenIn,
            tokenOut: swap.tokenOut,
            amountIn: scaledAmount,
            amountOut: swap.amountOut
          }
        })
      });

      if (res.status === 402) {
        console.log(`\x1b[31m%s\x1b[0m`, `Copy trade GATED for user ${follower.id} (402 Payment Required: Free uses exhausted)`);
      } else if (!res.ok) {
        const body = await res.text();
        console.error(`Copy trade failed with status ${res.status}:`, body);
      } else {
        const result = await res.json() as any;
        console.log(`\x1b[32m%s\x1b[0m`, `Copy trade successful for user ${follower.id}. Copy TxHash: ${result.copyTxHash}`);
      }
    } catch (err) {
      console.error(`Failed to execute copy trade for user ${follower.id}:`, err);
    }
  }
}
