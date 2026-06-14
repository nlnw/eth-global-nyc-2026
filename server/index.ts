import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import dotenv from "dotenv";
import path from "path";
import { getDb, addFollow, removeFollow, getFollowedTraders, getTraders, addTrader, getTrades, seedIfEmpty, initSchema } from "./db.js";
import { resolveName, reverse } from "./ens.js";
import { getOrCreateWallet } from "./privy.js";
import { executeCopyOnBaseSepolia, publicClient } from "./execute.js";
import { verifySignature, getHumanId, tryIncrementHumanUsage, getHumanUsageCount, resetHumanUsage, purchaseExtraTrades } from "./agentkit.js";
import { startDetectionLoop, simulateTraderSwap } from "./detector.js";
import { signRequest } from "@worldcoin/idkit-server";

dotenv.config();

const app = express();

// Security headers
app.use(helmet({ contentSecurityPolicy: false })); // CSP off so React SPA loads fine

// Allow same-origin requests from the React frontend
app.use(cors({ origin: process.env.ALLOWED_ORIGIN || true }));

app.use(express.json());

// Light request logger (method + path only, no body dump in prod)
app.use((req, _res, next) => {
  if (process.env.NODE_ENV !== "production") {
    console.log(`[HTTP] ${req.method} ${req.path}`);
  }
  next();
});

// In-memory nonce store for AgentKit challenges (cleared on restart — acceptable for demo)
const activeNonces = new Set<string>();

// Rate limiter for the copy-trade endpoint (fund-moving, abuse target)
const copyLimiter = rateLimit({
  windowMs: 60_000,       // 1 minute window
  max: 20,                // 20 copy attempts per minute per IP
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many copy-trade requests, please slow down." }
});

// Generic API rate limiter
const apiLimiter = rateLimit({
  windowMs: 60_000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false
});

app.use("/api/", apiLimiter);

// 1. Status Check
app.get("/api/status", (_req, res) => {
  try {
    getDb(); // ensures DB is reachable
    res.json({
      status: "online",
      database: "connected",
      privy: "configured",
      agentbook: "live"
    });
  } catch (err: any) {
    res.status(500).json({ status: "error", error: err.message });
  }
});

// 2. Leaderboard Traders
app.get("/api/traders", async (_req, res) => {
  try {
    const traders = await getTraders();
    res.json(traders);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 3. Get User Wallet
import { formatEther } from "viem";
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

    const { name, avatar } = await reverse(resolvedAddress);
    await addTrader(resolvedAddress, name || ensName, avatar);
    await addFollow(userId, resolvedAddress, multiplier || 1.0);

    res.json({
      success: true,
      trader: { address: resolvedAddress, ensName: name || ensName, avatar }
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

// 7.5 Get Trader Recent Trades from Hyperliquid
app.get("/api/trader-trades", async (req, res) => {
  const { address } = req.query;
  if (!address || typeof address !== "string") {
    return res.status(400).json({ error: "address query parameter is required" });
  }
  try {
    const response = await fetch("https://api.hyperliquid.xyz/info", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        type: "userFills",
        user: address
      })
    });
    const fills = await response.json() as any;
    if (!Array.isArray(fills)) {
      return res.json([]);
    }
    const mapped = fills.slice(0, 5).map((f: any) => ({
      coin: f.coin,
      side: f.side === "B" ? "BUY" : "SELL",
      sz: f.sz,
      px: f.px,
      time: f.time
    }));
    res.json(mapped);
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
    const { txHash, results } = await simulateTraderSwap(traderAddress, tokenIn, tokenOut, amountIn, amountOut);
    res.json({ success: true, simulatedTxHash: txHash, results });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});// 9. World ID AgentKit-Gated Copy-Trading Route
app.post("/api/copy", copyLimiter, async (req, res) => {
  const { userId, swap, signature, challenge, address } = req.body;

  // Bypass World ID validation entirely for simulated swaps
  if (swap && swap.isSimulation) {
    try {
      console.log(`[Simulation Bypass] Executing simulated copy trade for user ${userId}...`);
      const wallet = await getOrCreateWallet(userId);
      const copyTxHash = await executeCopyOnBaseSepolia(userId, wallet, swap);
      return res.json({
        success: true,
        copyTxHash,
        humanId: "simulation_bypass",
        usage: 0,
        limit: 999
      });
    } catch (err: any) {
      console.error(`Simulated copy trade failed:`, err);
      return res.status(500).json({ error: `Copy execution failed: ${err.message}` });
    }
  }

  let parsedSignature = signature;
  let parsedChallenge = challenge;
  let parsedAddress = address;

  // Also support the AgentKit standard base64 header
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

  // 1. No proof yet — issue a SIWE challenge (402 payment required)
  if (!parsedSignature || !parsedChallenge || !parsedAddress) {
    const nonce = "nonce_" + Math.random().toString(36).substring(2, 15);
    activeNonces.add(nonce);
    // Auto-expire nonces after 5 minutes to avoid unbounded growth
    setTimeout(() => activeNonces.delete(nonce), 5 * 60_000);

    return res.status(402).json({
      status: "payment_required",
      message: "World ID AgentKit human proof required.",
      challenge: {
        domain: "vouch.copytrade",
        statement: "Prove you are a human-backed agent on Vouch Copy-Trading.",
        uri: `http://localhost:${process.env.PORT || 5001}/api/copy`,
        version: "1",
        chainId: 84532, // Base Sepolia
        nonce,
        issuedAt: new Date().toISOString()
      }
    });
  }

  // 2. Validate nonce was one we actually issued (replay protection)
  if (parsedChallenge.nonce && !activeNonces.has(parsedChallenge.nonce)) {
    return res.status(401).json({ error: "Challenge nonce not recognised or already used." });
  }
  // Consume the nonce (one-time use)
  activeNonces.delete(parsedChallenge.nonce);

  // 3. Reconstruct and verify the SIWE message
  const c = parsedChallenge;
  const message = `${c.domain} wants you to sign in with your Ethereum account:\n${parsedAddress}\n\n${c.statement}\n\nURI: ${c.uri}\nVersion: ${c.version}\nChain ID: ${c.chainId}\nNonce: ${c.nonce}\nIssued At: ${c.issuedAt}`;

  const isValidSig = await verifySignature(parsedAddress, message, parsedSignature);
  if (!isValidSig) {
    return res.status(401).json({ error: "Invalid cryptographic signature for challenge." });
  }

  // 4. Resolve agent address to humanId via AgentBook
  const humanId = await getHumanId(parsedAddress);
  if (!humanId) {
    return res.status(403).json({ error: "Agent wallet address not registered in AgentBook" });
  }

  // 5. Track humanId usage (3 free + any purchased)
  const limit = 3;
  const endpoint = "/api/copy";
  const granted = await tryIncrementHumanUsage(endpoint, humanId, limit);
  const currentUsage = await getHumanUsageCount(endpoint, humanId);

  if (!granted) {
    return res.status(402).json({
      error: `Free copy-trade limit exhausted for human ${humanId} (Limit: ${limit} + purchased).`,
      limitExceeded: true,
      humanId,
      usage: currentUsage
    });
  }

  // 6. Execute the on-chain marker transaction on Base Sepolia
  try {
    const wallet = await getOrCreateWallet(userId);
    const copyTxHash = await executeCopyOnBaseSepolia(userId, wallet, swap);

    res.json({ success: true, copyTxHash, humanId, usage: currentUsage, limit });
  } catch (err: any) {
    res.status(500).json({ error: `Copy execution failed: ${err.message}` });
  }
});

// 10. Verify Human / Reset Trial Limit (World ID)
app.post("/api/verify-human", async (req, res) => {
  const { userId, humanId } = req.body;
  if (!userId || !humanId) {
    return res.status(400).json({ error: "userId and humanId are required" });
  }
  try {
    console.log(`[World ID] Resetting trial limit for user ${userId} with humanId ${humanId}`);
    await resetHumanUsage("/api/copy", humanId);
    res.json({ success: true, humanId });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 10.5 Real World ID verification endpoint
app.post("/api/verify-human-real", async (req, res) => {
  const { userId } = req.body;
  const { userId: _, ...idkitResult } = req.body;

  const appId = process.env.WORLD_APP_ID;
  const rpId = process.env.WORLD_RP_ID;

  let verifyUrl = "";
  if (rpId) {
    verifyUrl = `https://developer.world.org/api/v4/verify/${rpId}`;
  } else if (appId) {
    verifyUrl = `https://developer.worldcoin.org/api/v2/verify/${appId}`;
  } else {
    return res.status(500).json({ error: "WORLD_RP_ID or WORLD_APP_ID is not configured on the server." });
  }

  try {
    console.log(`[World ID] Verifying proof for user ${userId} via ${verifyUrl}...`);
    const response = await fetch(verifyUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(idkitResult)
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[World ID] Developer Portal verification failed:`, errorText);
      return res.status(400).json({ error: `World ID verification failed: ${errorText}` });
    }

    // Extract nullifier from IDKitResult responses
    const nullifierHash = idkitResult.responses?.[0]?.nullifier;
    if (!nullifierHash) {
      return res.status(400).json({ error: "No nullifier hash found in IDKit responses." });
    }

    console.log(`[World ID] Verification successful! Nullifier hash: ${nullifierHash}`);

    // Reset/Refill the trial copy-trade limits for this verified human ID
    await resetHumanUsage("/api/copy", nullifierHash);

    res.json({ success: true, nullifier_hash: nullifierHash });
  } catch (err: any) {
    console.error(`[World ID] Error verifying proof:`, err);
    res.status(500).json({ error: `Verification server error: ${err.message}` });
  }
});

// 10.6 Endpoint to generate RP signature context for the frontend
app.post("/api/rp-context", async (req, res) => {
  const { action } = req.body;

  const rpId = process.env.WORLD_RP_ID;
  const privateKey = process.env.WORLD_PRIVATE_KEY;

  if (!rpId || !privateKey) {
    return res.status(500).json({ error: "WORLD_RP_ID or WORLD_PRIVATE_KEY is not configured on the server." });
  }

  try {
    const signingKeyHex = privateKey.startsWith("0x") ? privateKey.substring(2) : privateKey;
    const rpSignature = signRequest({
      signingKeyHex,
      action: action || "verify",
      ttl: 3600 // 1 hour TTL
    });

    res.json({
      rp_context: {
        rp_id: rpId,
        nonce: rpSignature.nonce,
        created_at: rpSignature.createdAt,
        expires_at: rpSignature.expiresAt,
        signature: rpSignature.sig
      }
    });
  } catch (err: any) {
    console.error("Failed to generate RP signature:", err);
    res.status(500).json({ error: `Failed to generate RP context: ${err.message}` });
  }
});

// 11. Purchase Extra Copy-Trades via Worldcoin (WLD)
app.post("/api/purchase-trades", async (req, res) => {
  const { userId, humanId, amount } = req.body;
  if (!userId || !humanId || !amount || amount <= 0) {
    return res.status(400).json({ error: "userId, humanId, and positive amount are required" });
  }
  try {
    console.log(`[WLD Purchase] User ${userId} purchasing ${amount} extra copy-trades`);
    const newPurchased = await purchaseExtraTrades("/api/copy", humanId, Number(amount));
    res.json({ success: true, humanId, purchased: newPurchased });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Serve frontend statically
const publicPath = path.resolve(process.cwd(), "dist/public");
app.use(express.static(publicPath));

// Fallback to index.html for React Router compatibility
app.get("*splat", (_req, res) => {
  res.sendFile(path.resolve(publicPath, "index.html"));
});

// Bootstrap server
const PORT = process.env.PORT || 5001;

app.listen(PORT, async () => {
  console.log(`Vouch backend listening on port ${PORT}`);
  await initSchema();
  await seedIfEmpty();
  startDetectionLoop(15000);
});
