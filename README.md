# Vouch 🤝 Copy-Trading (ETHGlobal NYC 2026)

Vouch is an autonomous on-chain copy-trading service: follow traders by **ENS name**, fund a secure **Privy server-side wallet**, and a **proof-of-human-gated agent (World AgentKit)** mirrors their trades on **Base Sepolia** automatically.

* **3 free copy-trades** unlocked via World ID verification (prevents Sybil farming).
* **Purchase additional trades** by spending simulated WLD tokens through a Worldcoin payment flow.

---

## Architecture Overview

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
                       │  Background Detection Loop (every 15s):       │
                       │   poll Hyperliquid fills for followed addrs   │
                       │   → trigger copy marker tx on Base Sepolia    │
                       └──────────────────────────────────────────────┘
                          │            │              │            │
                          ▼            ▼              ▼            ▼
                     Hyperliquid API Ethereum Mainnet Base Sepolia  World Chain
                     (fill detection) (ENS resolution) (copy exec)  /AgentBook
```

**Detection:** A background loop polls [Hyperliquid's public REST API](https://api.hyperliquid.xyz/info) for recent fills from each followed trader address. Hyperliquid uses standard EVM addresses, so traders followed by ENS are correctly monitored. In practice, `vitalik.eth` doesn't trade on Hyperliquid — use the **Trade Simulator** in the dashboard to inject a synthetic fill for demo purposes.

**Copy Execution:** When a trade is detected (or simulated), the backend submits a real on-chain marker transaction on Base Sepolia. The calldata encodes the original trade context (`VOUCH_COPY:<trader>:<srcTxHash>:<amount>`) making the copy record verifiable on BaseScan. We intentionally use a marker tx rather than claiming a full DEX swap, which would require token approvals and test liquidity.

---

## Sponsor Integrations

### 🌐 ENS
ENS is the identity layer. Users follow traders by `.eth` name — resolved to an EVM address via `getEnsAddress` on Ethereum mainnet (public Cloudflare RPC, no key needed), and reverse-resolved back to name + ENS avatar on the leaderboard.

### 🩻 World ID & AgentKit
Guards copy-trade execution from bot spam:
- **AgentBook:** The backend agent signs a CAIP-122/SIWE challenge. The server verifies the signature and looks up the agent wallet on World Chain's **AgentBook** registry to resolve an anonymous `humanId`.
- **Replay Protection:** Each challenge nonce is single-use and expires after 5 minutes.
- **Trial Limits:** Usage is tracked per `humanId` (not per wallet). Each verified human gets **3 free trades**. Additional trades can be purchased with WLD.
- **WLD Purchases:** Users spend WLD to purchase packs of 10 extra copy-trades. The WLD balance is simulated on the frontend for the demo; the purchased count is persisted in SQLite.

### 🔑 Privy
- **Server Wallets:** On login, the backend creates a Privy server-controlled wallet. The copy-trading loop can sign and submit transactions on the user's behalf, even when they are offline.
- **Universal Deposits:** `useDepositAddress` lets followers fund their wallet from any chain/token, abstracting bridging and swaps.

---

## Getting Started (Development)

### 1. Install Dependencies
```bash
bun install
```

### 2. Environment Setup
```bash
cp .env.example .env
# Fill in PRIVY_APP_ID, PRIVY_APP_SECRET, VITE_PRIVY_APP_ID
```

No RPC keys are required — the app uses public endpoints.

### 3. Start Dev Server
```bash
bun run dev
```
Runs Express (port `5001`) and the Vite dev server concurrently.

## Production Deployment

### Required Environment Variables

| Variable | Description |
|---|---|
| `PRIVY_APP_ID` | Privy dashboard App ID (backend) |
| `PRIVY_APP_SECRET` | Privy App Secret (backend) |
| `VITE_PRIVY_APP_ID` | Same App ID, used at Vite build time |
| `AGENT_PRIVATE_KEY` | Private key for the backend copy-trading agent wallet |

### Heroku
```bash
git push heroku main
```
`heroku-postbuild` runs the full Vite + TypeScript build, pushes the Drizzle schema, then removes source files to minimise slug size (~77 MB).

> **Note on persistence:** Heroku's filesystem is ephemeral. Follows, wallets, and usage counts are reset on each dyno restart or deploy. For a persistent demo, consider adding a Heroku Postgres addon and migrating to pg-compatible Drizzle.

### Build & Run Locally
```bash
bun run build
```

---

## ⚠️ World ID Live Operator Registration

World ID verification is strictly enforced via the live World Chain **AgentBook** registry. The copy-trading agent wallet address MUST be registered on World Chain for copies (both simulated and real-time polled) to execute.

To register your copy-trading agent:

1. Note the agent wallet address printed in server logs on startup (or set `AGENT_PRIVATE_KEY` to a funded wallet you control).
2. Register it in AgentBook (one-time, as the operator):
   ```bash
   npx @worldcoin/agentkit-cli register <agent-wallet-address>
   ```
3. Scan the QR code with your **Orb-verified World App**.

After registration, every copy-trade resolves to a real `humanId` on World Chain — the trial counter and 402 gating are live and Sybil-resistant.

