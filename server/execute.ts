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
  console.log(`Executing copy-trade marker tx on Base Sepolia from wallet ${wallet.address}...`);

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
    if (privy) {
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
      throw new Error("No signer available: Privy not configured.");
    }

    console.log(`Copy-trade marker tx submitted: ${txHash}`);
  } catch (err: any) {
    console.error(`Marker tx failed: ${err.message}`);
    throw err;
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
