# Vouch 🤝 Copy-Trading (ETHGlobal NYC 2026)

Vouch is an autonomous on-chain copy-trading service: follow traders by **ENS name**, fund a secure **Privy server-side wallet**, and a **proof-of-human-gated agent (World AgentKit)** replicates those trades on **Base Sepolia** automatically. 

Verified humans get their first 3 copy-trades free, preventing Sybil farming of execution trials.

---

## Architecture Overview

Vouch is built as a single TypeScript application (Express backend serving a Vite/React frontend) to keep execution hooks, background detection, and wallet operations unified.

```
                       ┌──────────────────────────────────────────────┐
                       │           Single Express App (Node.js)       │
                       │                                              │
  Browser ───────────▶ │  express.static  ──▶ serves built Vite/React  │
  (React UI)  ◀──────── │                      (Follow forms, leaderboard)│
                       │                                              │
                       │  REST API:                                   │
                       │   POST /api/follow     (ENS resolve → db)    │
                       │   POST /api/get-wallet (Privy server wallet) │
                       │   POST /api/copy  ◀── Gated by AgentKit      │
                       │                                              │
                       │  In-process Swap Detection Loop:             │
                       │   poll followed traders → detect DEX swaps   │
                       │   → on grant, execute swap on Base Sepolia   │
                       └──────────────────────────────────────────────┘
                          │            │              │            │
                          ▼            ▼              ▼            ▼
                     Etherscan API  Ethereum Mainnet Base Sepolia  World Chain
                     (detect swaps) (ENS resolution) (swap exec)   /AgentBook
```

* **DEX Swap Detection:** A background polling worker monitors followed Ethereum mainnet addresses by parsing transfer logs (using Etherscan `tokentx` API) to detect swaps.
* **DEX Copy Execution:** When a swap is detected, the agent scales it to the follower's settings and executes a test swap (WETH -> USDC) on **Base Sepolia** via the **Uniswap V3 SwapRouter02** using the follower's Privy server-side wallet.

---

## Sponsor Prize Integrations

### 1. 🌐 ENS (Ethereum Name Service) — Primary Target
ENS is load-bearing and acts as the identity and discovery layer:
* **Follow-by-Name:** Users follow traders by inputting their `.eth` domain name. The backend resolves this to an EVM address using `viem`'s `getEnsAddress` against Ethereum mainnet RPC.
* **Reverse Resolution:** Every trader on the leaderboard is reverse-resolved back to their canonical `.eth` name and avatar using `getEnsName` and `getEnsAvatar` to maintain an identity-first experience.

### 2. 🩻 World ID & AgentKit
gated copy execution prevents bot spam:
* **AgentBook Verification:** When a copy-trade is triggered, the background agent signs a CAIP-122 challenge and calls the gated `/api/copy` endpoint. The server verifies the signature and looks up the agent's wallet in the **AgentBook** registry (on World Chain) to resolve their anonymous World ID `humanId`.
* **Sybil-Resistant Trials:** Vouch tracks trial uses per **`humanId`** in its database (SQLite) rather than per wallet. Verified humans get **3 free trades** before falling back to payment or x402 restrictions.

### 3. 🔑 Privy (Universal Embedded Wallets & Funding)
Secure, automated copy-execution and frictionless funding:
* **Server-Side Wallets:** Upon login, the backend programmatically creates a Privy server-controlled wallet (`privy.wallets().create()`) associated with the user. This allows the backend copy-trading loop to sign and execute swaps on the user's behalf even when they are offline.
* **Universal Deposit Addresses:** Users can fund their copy-trading wallet directly from the UI. Integrating Privy's `useDepositAddress` hook allows followers to deposit ETH or tokens to their copy-trading address from any supported network/chain, abstracting bridging and swapping.

---

## Getting Started

### 1. Environment Setup
Copy `.env.example` to `.env` and fill in your keys:
```bash
cp .env.example .env
```

### 2. Install Dependencies
```bash
bun install
```

### 3. Start Development Mode
Runs the nodemon-reloaded Express backend (port `5001`) and the Vite React development server concurrently:
```bash
bun run dev
```

### 4. Build and Run Production
```bash
bun run build
bun start
```

---

## How to Register your Agent in AgentBook (For Judges/Evaluators)

To test the real World ID AgentKit path (with World App verification):
1. Log in to Vouch and copy your **Copy-Trading Address** from the dashboard.
2. In your terminal, run the AgentKit CLI registration utility:
   ```bash
   bunx @worldcoin/agentkit-cli register <your-wallet-address>
   ```
3. Open the World App on your phone and scan the printed QR code. This will submit a gasless transaction to the AgentBook smart contract on World Chain, linking your wallet to your World ID.
4. Subsequent trades triggered on Vouch will now successfully resolve to your real World ID `humanId`!

*Note: For evaluator convenience, **MOCK_AGENTBOOK=true** is set by default in `.env.example`. If your test wallet is not yet registered in AgentBook, the server will gracefully fallback to a mock humanId so you can still test the usage-counter decrementing and 402 gating.*
