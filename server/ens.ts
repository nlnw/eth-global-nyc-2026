import { createPublicClient, http } from "viem";
import { mainnet } from "viem/chains";
import dotenv from "dotenv";

dotenv.config();

const mainnetRpc = process.env.MAINNET_RPC || "https://cloudflare-eth.com";

const client = createPublicClient({
  chain: mainnet,
  transport: http(mainnetRpc)
});

export async function resolveName(name: string): Promise<string | null> {
  try {
    if (!name.endsWith(".eth")) {
      name = name + ".eth";
    }
    const address = await client.getEnsAddress({ name });
    return address;
  } catch (err) {
    console.error("ENS resolveName error:", err);
    return null;
  }
}

export async function reverse(address: string): Promise<{ name: string | null; avatar: string | null }> {
  try {
    const cleanAddress = address.toLowerCase() as `0x${string}`;
    const name = await client.getEnsName({ address: cleanAddress });
    
    let avatar: string | null = null;
    if (name) {
      avatar = await client.getEnsAvatar({ name });
    }
    
    return { name, avatar };
  } catch (err) {
    console.error("ENS reverse error:", err);
    return { name: null, avatar: null };
  }
}
