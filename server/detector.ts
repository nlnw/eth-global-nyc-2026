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
  console.log(`\x1b[36m%s\x1b[0m`, `   bunx @worldcoin/agentkit-cli register ${account.address}`);
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

// Poll Hyperliquid userFills API for a trader address
async function pollTraderSwaps(traderAddress: string) {
  const url = "https://api.hyperliquid.xyz/info";
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        type: "userFills",
        user: traderAddress
      })
    });
    
    const fills = await res.json() as any;
    if (!Array.isArray(fills)) {
      return;
    }

    // Process recent fills (Hyperliquid returns them sorted desc by time)
    const recentFills = fills.slice(0, 10);
    
    for (const fill of recentFills) {
      const txHash = fill.hash || `hl_fill_${fill.tid}`;
      
      if (processedTxHashes.has(txHash)) continue;

      // Check if we've already stored this trade in db
      const db = await getDb();
      const existingTrade = await db.select({ id: trades.id })
        .from(trades)
        .where(eq(trades.traderTxHash, txHash))
        .limit(1)
        .then(r => r[0] ?? null);
      if (existingTrade) {
        processedTxHashes.add(txHash);
        continue;
      }

      // Map Hyperliquid trade to EVM swap
      // Buy -> swap USDC to WETH
      // Sell -> swap WETH to USDC
      const isBuy = fill.side === "B";
      const weth = "0x4200000000000000000000000000000000000006";
      const usdc = "0x036cbd53842c3326c3b77fd7e7cdbfa97491d388";
      
      const swap: DetectedSwap = {
        trader: traderAddress.toLowerCase(),
        txHash,
        tokenIn: isBuy ? usdc : weth,
        tokenOut: isBuy ? weth : usdc,
        amountIn: fill.sz,
        amountOut: (Number(fill.sz) * Number(fill.px)).toString(),
        timestamp: fill.time
      };

      processedTxHashes.add(txHash);
      console.log(`Detected Hyperliquid trade from followed trader ${traderAddress}: ${fill.side === 'B' ? 'BUY' : 'SELL'} ${fill.sz} ${fill.coin} at ${fill.px} USDC`);
      await triggerCopyTrade(swap);
    }
  } catch (err) {
    console.error(`Failed to poll Hyperliquid swaps for trader ${traderAddress}:`, err);
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

  const serverPort = process.env.PORT || "5001";
  const copyUrl = `http://localhost:${serverPort}/api/copy`;

  for (const follower of followers) {
    // Scale amount according to the follower's multiplier
    const scaledAmount = (Number(swap.amountIn) * (Number(follower.multiplier) || 1.0)).toString();

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
