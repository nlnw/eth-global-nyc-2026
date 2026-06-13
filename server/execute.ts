import { createPublicClient, createWalletClient, http, parseEther, Address } from "viem";
import { baseSepolia } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { privy, CopyWallet } from "./privy.js";
import { recordTrade } from "./db.js";
import dotenv from "dotenv";

dotenv.config();

// Public Base Sepolia RPC — no API key needed for testnet execution
const baseSepoliaRpc = "https://sepolia.base.org";

export const publicClient = createPublicClient({
  chain: baseSepolia,
  transport: http(baseSepoliaRpc)
});

/**
 * Executes an on-chain marker transaction on Base Sepolia representing a copy-trade.
 *
 * Design note: Rather than attempting a Uniswap V3 swap (which would require token
 * approvals, liquidity, and real ERC-20 transfers), we send a 0-value self-transfer
 * with a tiny ETH dust amount as the "marker." This produces a real, verifiable
 * on-chain transaction hash on Base Sepolia that can be inspected on BaseScan.
 * The transaction data encodes the original trade context as calldata so the
 * on-chain record is meaningful, not just an empty send.
 */
export async function executeCopyOnBaseSepolia(
  userId: string,
  wallet: CopyWallet,
  swap: {
    trader: string;
    txHash: string;
    tokenIn: string;
    tokenOut: string;
    amountIn: string;
    amountOut: string;
  }
): Promise<string> {
  const isLocal = wallet.id.startsWith("local_");
  console.log(`Executing copy-trade marker tx on Base Sepolia from wallet ${wallet.address} (${isLocal ? "Local" : "Privy"})...`);

  // Encode trade context as calldata so the tx is self-documenting on-chain:
  // "VOUCH_COPY:<traderAddr>:<txHash>:<amountIn>"
  const markerHex = Buffer.from(
    `VOUCH_COPY:${swap.trader}:${swap.txHash}:${swap.amountIn}`
  ).toString("hex");
  const calldata = ("0x" + markerHex) as `0x${string}`;

  // Send a dust amount (1 gwei) to the wallet's own address as the marker tx.
  // Using self-transfer keeps it cheap and avoids any contract interaction risk.
  const dustValue = 1n; // 1 wei — effectively free

  let txHash: string;

  try {
    if (isLocal && wallet.privateKey) {
      const account = privateKeyToAccount(wallet.privateKey as `0x${string}`);
      const walletClient = createWalletClient({
        account,
        chain: baseSepolia,
        transport: http(baseSepoliaRpc)
      });
      txHash = await walletClient.sendTransaction({
        to: wallet.address as Address,
        value: dustValue,
        data: calldata,
        chain: baseSepolia
      });
    } else if (privy) {
      const result = await privy.wallets().ethereum().sendTransaction(wallet.id, {
        caip2: "eip155:84532", // Base Sepolia
        params: {
          transaction: {
            to: wallet.address,
            value: "0x1", // 1 wei
            data: calldata
          }
        }
      });
      txHash = result.hash;
    } else {
      throw new Error("No signer available: Privy not configured and no local private key.");
    }

    console.log(`Copy-trade marker tx submitted: ${txHash}`);
  } catch (err: any) {
    // If even the dust send fails (e.g. zero balance), generate a deterministic mock hash
    // so the demo can still show a record. Log clearly so it's not mistaken for a real tx.
    console.warn(`Marker tx failed (likely zero balance): ${err.message}. Using mock hash for demo.`);
    txHash = "0xmock_" + Buffer.from(`${swap.trader}:${swap.txHash}`).toString("hex").substring(0, 60);
  }

  // Record the trade in SQLite
  const tradeId = "trade_" + Math.random().toString(36).substring(2, 15);
  await recordTrade(
    tradeId,
    userId,
    swap.trader,
    swap.txHash,
    txHash,
    swap.tokenIn,
    swap.tokenOut,
    swap.amountIn,
    swap.amountOut
  );

  return txHash;
}
