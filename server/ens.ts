import { createPublicClient, http } from "viem";
import { mainnet } from "viem/chains";

// Public Ethereum mainnet RPC — highly reliable public node
const mainnetRpc = "https://ethereum.publicnode.com";

const client = createPublicClient({
  chain: mainnet,
  transport: http(mainnetRpc)
});

export async function resolveName(name: string): Promise<string | null> {
  try {
    const trimmed = name.trim();
    // If it's already a valid hex address, bypass ENS resolution
    if (trimmed.startsWith("0x") && trimmed.length === 42) {
      return trimmed;
    }
    let ensName = trimmed;
    if (!ensName.endsWith(".eth")) {
      ensName = ensName + ".eth";
    }
    const address = await client.getEnsAddress({ name: ensName });
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
