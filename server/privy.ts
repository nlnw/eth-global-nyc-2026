import { PrivyClient } from "@privy-io/node";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { getUser, saveUser } from "./db.js";
import dotenv from "dotenv";

dotenv.config();

const appId = process.env.PRIVY_APP_ID;
const appSecret = process.env.PRIVY_APP_SECRET;

const hasPrivyCredentials = appId && appSecret && !appId.startsWith("mock_") && !appSecret.startsWith("mock_");

export const privy = hasPrivyCredentials 
  ? new PrivyClient({ appId, appSecret }) 
  : null;

export interface CopyWallet {
  id: string;
  address: string;
  privateKey: string | null;
  riskLimit: number;
}

export async function getOrCreateWallet(userId: string): Promise<CopyWallet> {
  const existingUser = await getUser(userId);
  if (existingUser) {
    return {
      id: existingUser.walletId,
      address: existingUser.walletAddress,
      privateKey: existingUser.privateKey,
      riskLimit: existingUser.riskLimit || 0.05
    };
  }

  // Create new wallet
  if (privy) {
    try {
      console.log(`Creating Privy server wallet for user ${userId}...`);
      const wallet = await privy.wallets().create({
        chain_type: 'ethereum'
      });
      await saveUser(userId, wallet.id, wallet.address);
      return {
        id: wallet.id,
        address: wallet.address,
        privateKey: null,
        riskLimit: 0.05
      };
    } catch (err) {
      console.error("Failed to create Privy server-side wallet, falling back to local wallet:", err);
    }
  }

  // Local/mock fallback wallet
  console.log(`Generating local EVM wallet fallback for user ${userId}...`);
  const privateKey = generatePrivateKey();
  const account = privateKeyToAccount(privateKey);
  const walletId = `local_${account.address.toLowerCase()}`;
  
  await saveUser(userId, walletId, account.address, privateKey);
  return {
    id: walletId,
    address: account.address,
    privateKey: privateKey,
    riskLimit: 0.05
  };
}

export async function getDepositAddress(walletId: string, address: string): Promise<string> {
  // If it's a real Privy wallet, we can fetch it, or just use the address directly since Privy Server Wallets
  // are standard addressable accounts on all chains.
  return address;
}
