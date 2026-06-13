import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import path from "path";
import { execSync } from "child_process";
import { getDb, addFollow, removeFollow, getFollowedTraders, getTraders, addTrader, getTrades } from "./db.js";
import { resolveName, reverse } from "./ens.js";
import { getOrCreateWallet } from "./privy.js";
import { executeCopyOnBaseSepolia, publicClient } from "./execute.js";
import { verifySignature, getHumanId, tryIncrementHumanUsage, getHumanUsageCount } from "./agentkit.js";
import { startDetectionLoop, simulateTraderSwap } from "./detector.js";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

// Log all incoming requests for debugging
app.use((req, res, next) => {
  console.log(`[HTTP] ${req.method} ${req.url} - query:`, req.query, "body:", req.body);
  next();
});

// In-memory nonce store for AgentKit challenges
const activeNonces = new Set<string>();

// 1. Status Check
app.get("/api/status", async (req, res) => {
  try {
    const db = await getDb();
    res.json({
      status: "online",
      database: "connected",
      privy: process.env.PRIVY_APP_ID ? "configured" : "mock_fallback",
      agentbook: process.env.MOCK_AGENTBOOK === "false" ? "live" : "demo_mock_allowed"
    });
  } catch (err: any) {
    res.status(500).json({ status: "error", error: err.message });
  }
});

// 2. Leaderboard Traders
app.get("/api/traders", async (req, res) => {
  try {
    const traders = await getTraders();
    res.json(traders);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 3. Get User Wallet
import { formatEther } from "viem";
// ...
app.post("/api/get-wallet", async (req, res) => {
  const { userId } = req.body;
  if (!userId) {
    return res.status(400).json({ error: "userId is required" });
  }
  try {
    const wallet = await getOrCreateWallet(userId);
    const balance = await publicClient.getBalance({ address: wallet.address as `0x${string}` }).catch(() => 0n);
    res.json({
      address: wallet.address,
      walletId: wallet.id,
      riskLimit: wallet.riskLimit,
      balance: formatEther(balance)
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 4. Follow Trader
app.post("/api/follow", async (req, res) => {
  const { userId, ensName, multiplier } = req.body;
  if (!userId || !ensName) {
    return res.status(400).json({ error: "userId and ensName are required" });
  }

  try {
    console.log(`Follow request for ${ensName} by user ${userId}`);
    const resolvedAddress = await resolveName(ensName);
    if (!resolvedAddress) {
      return res.status(400).json({ error: `Could not resolve ENS name: ${ensName}` });
    }

    // Perform reverse-resolution to get avatar / canonical name
    const { name, avatar } = await reverse(resolvedAddress);

    // Save trader to database
    await addTrader(resolvedAddress, name || ensName, avatar);

    // Add follow relationship
    await addFollow(userId, resolvedAddress, multiplier || 1.0);

    res.json({
      success: true,
      trader: {
        address: resolvedAddress,
        ensName: name || ensName,
        avatar
      }
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 5. Unfollow Trader
app.post("/api/unfollow", async (req, res) => {
  const { userId, traderAddress } = req.body;
  if (!userId || !traderAddress) {
    return res.status(400).json({ error: "userId and traderAddress are required" });
  }
  try {
    await removeFollow(userId, traderAddress);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 6. Get Followed Traders
app.get("/api/followed", async (req, res) => {
  const { userId } = req.query;
  if (!userId) {
    return res.status(400).json({ error: "userId is required" });
  }
  try {
    const followed = await getFollowedTraders(userId as string);
    res.json(followed);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 7. Get Copied Trades History
app.get("/api/trades", async (req, res) => {
  const { userId } = req.query;
  if (!userId) {
    return res.status(400).json({ error: "userId is required" });
  }
  try {
    const trades = await getTrades(userId as string);
    res.json(trades);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 8. Simulate Trader Swap (Dev tool)
app.post("/api/simulate-swap", async (req, res) => {
  const { traderAddress, tokenIn, tokenOut, amountIn, amountOut } = req.body;
  if (!traderAddress || !tokenIn || !tokenOut || !amountIn || !amountOut) {
    return res.status(400).json({ error: "Missing swap simulation parameters" });
  }
  try {
    const txHash = await simulateTraderSwap(
      traderAddress,
      tokenIn,
      tokenOut,
      amountIn,
      amountOut
    );
    res.json({ success: true, simulatedTxHash: txHash });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 9. World ID AgentKit-Gated Gopy-Trading Route
app.post("/api/copy", async (req, res) => {
  const { userId, swap, signature, challenge, address } = req.body;
  
  // Also support reading from custom AgentKit header if sent by standard AgentKit client fetch
  let parsedSignature = signature;
  let parsedChallenge = challenge;
  let parsedAddress = address;

  const agentkitHeader = req.headers.agentkit;
  if (agentkitHeader && typeof agentkitHeader === "string") {
    try {
      const decoded = JSON.parse(Buffer.from(agentkitHeader, "base64").toString("utf-8"));
      parsedSignature = decoded.signature;
      parsedChallenge = decoded.challenge;
      parsedAddress = decoded.address;
    } catch (err) {
      console.error("Failed to parse agentkit header:", err);
    }
  }

  // 1. If unsigned challenge, return 402 challenge
  if (!parsedSignature || !parsedChallenge || !parsedAddress) {
    const nonce = "nonce_" + Math.random().toString(36).substring(2, 15);
    activeNonces.add(nonce);
    
    const issuedAt = new Date().toISOString();
    const challengeBody = {
      domain: "vouch.copytrade",
      statement: "Prove you are a human-backed agent on Vouch Copy-Trading.",
      uri: `http://localhost:${process.env.PORT || 5001}/api/copy`,
      version: "1",
      chainId: 84532, // Base Sepolia
      nonce,
      issuedAt
    };

    return res.status(402).json({
      status: "payment_required",
      message: "World ID AgentKit human proof required.",
      challenge: challengeBody
    });
  }

  // 2. Reconstruct the CAIP-122 SIWE message
  const c = parsedChallenge;
  const message = `${c.domain} wants you to sign in with your Ethereum account:\n${parsedAddress}\n\n${c.statement}\n\nURI: ${c.uri}\nVersion: ${c.version}\nChain ID: ${c.chainId}\nNonce: ${c.nonce}\nIssued At: ${c.issuedAt}`;

  // 3. Verify signature
  const isValidSig = await verifySignature(parsedAddress, message, parsedSignature);
  if (!isValidSig) {
    return res.status(401).json({ error: "Invalid cryptographic signature for challenge." });
  }

  // 4. Resolve agent address to humanId via AgentBook
  const humanId = await getHumanId(parsedAddress);
  if (!humanId) {
    return res.status(403).json({ error: "Agent wallet address not registered in AgentBook" });
  }

  // 5. Track humanId usage
  const limit = 3;
  const endpoint = "/api/copy";
  const granted = await tryIncrementHumanUsage(endpoint, humanId, limit);
  const currentUsage = await getHumanUsageCount(endpoint, humanId);

  if (!granted) {
    return res.status(402).json({
      error: `Free copy-trade limit exhausted for human ${humanId} (Limit: ${limit}).`,
      limitExceeded: true,
      humanId,
      usage: currentUsage
    });
  }

  // 6. Execute the swap
  try {
    const wallet = await getOrCreateWallet(userId);
    const copyTxHash = await executeCopyOnBaseSepolia(userId, wallet, swap);
    
    res.json({
      success: true,
      copyTxHash,
      humanId,
      usage: currentUsage,
      limit
    });
  } catch (err: any) {
    res.status(500).json({ error: `Copy execution failed: ${err.message}` });
  }
});

// Serve frontend statically
const publicPath = path.resolve(process.cwd(), "dist/public");
app.use(express.static(publicPath));

// Fallback to index.html for React Router compatibility
app.get("*splat", (req, res) => {
  res.sendFile(path.resolve(publicPath, "index.html"));
});

// Bootstrap server
const PORT = process.env.PORT || 5001;

// Run database schema push on startup
try {
  console.log("Synchronizing database schema via Drizzle Kit...");
  const isBun = typeof (process as any).versions.bun !== "undefined";
  const cmd = isBun ? "bunx drizzle-kit push" : "npx drizzle-kit push";
  execSync(cmd, { stdio: "inherit" });
  console.log("Database schema synchronized successfully.");
} catch (err) {
  console.error("Database schema push failed:", err);
}

app.listen(PORT, () => {
  console.log(`Vouch backend listening on port ${PORT}`);
  
  // Start Etherscan detection loop
  startDetectionLoop(15000);
});
