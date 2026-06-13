# Vouch 🤝 Copy-Trading (ETHGlobal NYC 2026)

Vouch is an autonomous on-chain copy-trading service: follow traders by **ENS name**, fund a secure **Privy server-side wallet**, and a **proof-of-human-gated agent (World AgentKit)** replicates those trades on **Base Sepolia** automatically.

* **3 free copy-trades** unlocked via World ID verification (prevents Sybil farming).
* **Purchase additional trades** by spending simulated WLD tokens through a Worldcoin payment flow.

---

## Architecture Overview

Vouch is a single TypeScript application: Express backend serving a Vite/React frontend, keeping execution hooks, background detection, and wallet operations unified.

```
                       ┌──────────────────────────────────────────────┐
                       │           Single Express App (Node.js)        │
                       │                                               │
  Browser ───────────▶ │  express.static  ──▶ built Vite/React SPA    │
  (React UI)  ◀──────── │                                               │
                       │  REST API:                                    │
                       │   POST /api/follow          (ENS resolve)     │
                       │   POST /api/get-wallet      (Privy wallet)    │
                       │   POST /api/copy            (AgentKit gated)  │
                       │   POST /api/verify-human    (World ID reset)  │
                       │   POST /api/purchase-trades (WLD purchase)    │
                       │                                               │
                       │  Background Swap Detection Loop:              │
                       │   poll Hyperliquid → detect fills             │
                       │   → trigger copy swap on Base Sepolia         │
                       └──────────────────────────────────────────────┘
                          │            │              │            │
                          ▼            ▼              ▼            ▼
                     Hyperliquid API Ethereum Mainnet Base Sepolia  World Chain
                     (detect trades) (ENS resolution) (swap exec)  /AgentBook
```

**Swap Detection:** Background polling monitors followed traders via Hyperliquid's public REST API — no API key required.

**Copy Execution:** Detected trades are scaled to each follower's multiplier setting and executed on **Base Sepolia** via **Uniswap V3 SwapRouter02** using the follower's Privy server-side wallet.

---

## Sponsor Integrations

### 🌐 ENS
ENS is the identity and discovery layer. Users follow traders by `.eth` name — the backend resolves it to an address via `getEnsAddress`, and reverses it back to name + avatar on the leaderboard.

### 🩻 World ID & AgentKit
Guards copy-trade execution from bot spam:
- **AgentBook:** The backend agent signs a CAIP-122 challenge. The server verifies the sig and looks up the agent wallet on World Chain's **AgentBook** registry to get an anonymous `humanId`.
- **Trial Limits:** Usage is tracked per `humanId`, not per wallet. Each verified human gets **3 free trades**. Additional trades can be purchased with WLD.
- **WLD Purchases:** Users can spend WLD tokens to purchase packs of 10 extra copy-trades. This is simulated on the frontend (for demo purposes) while the purchased count is persisted in the backend database.

### 🔑 Privy
- **Server Wallets:** On login, the backend creates a Privy server-controlled wallet. The copy-trading loop signs and executes swaps on the user's behalf even when offline.
- **Universal Deposits:** `useDepositAddress` lets followers fund their copy-trading address from any chain, abstracting bridging and swaps.

---

## Getting Started (Development)

### 1. Install Dependencies
```bash
bun install
```

### 2. Environment Setup
```bash
cp .env.example .env
```
Fill in your Privy credentials. Everything else has working defaults.

### 3. Start Dev Server
```bash
bun run dev
```
Runs the Express backend (port `5001`) and Vite dev server concurrently.

---

## Production Deployment

### Required Environment Variables

| Variable | Description |
|---|---|
| `PRIVY_APP_ID` | Privy dashboard App ID |
| `PRIVY_APP_SECRET` | Privy dashboard App Secret |
| `VITE_PRIVY_APP_ID` | Same App ID, exposed to frontend build |
| `AGENT_PRIVATE_KEY` | Private key for the backend copy-trading agent wallet |
| `MOCK_AGENTBOOK` | Set to `false` to enable real World Chain AgentBook lookups |

No RPC keys are required — the app uses public endpoints (`cloudflare-eth.com` for Ethereum mainnet, `sepolia.base.org` for Base Sepolia).

### Heroku Deployment
```bash
git push heroku main
```
The `heroku-postbuild` script runs the full Vite + TypeScript build. SQLite schema is pushed automatically on first boot.

### Build & Run Locally (Production Mode)
```bash
bun run build
bun start
```

---

## Developer Setup: AgentBook Registration

> **This is only needed by the operator deploying the app**, not end users.

To use the real World ID AgentKit path (live on-chain World App verification instead of demo mock):

1. Set `AGENT_PRIVATE_KEY` in your environment with a funded wallet's private key.
2. Note the wallet's public address (printed in server logs on startup).
3. Register the agent wallet in World Chain's AgentBook registry:
   ```bash
   npx @worldcoin/agentkit-cli register <agent-wallet-address>
   ```
4. Scan the QR code printed by the CLI with your **Orb-verified World App**.
5. Set `MOCK_AGENTBOOK=false` in your environment variables.

After registration, copy-trades will resolve to a real World ID `humanId` on World Chain, enabling production-grade Sybil resistance.

> **Demo Mode (default):** If `MOCK_AGENTBOOK` is not set to `false`, the server gracefully falls back to a mock `humanId` so you can test usage-counter decrementing and the 402 gating without a live World ID registration.
