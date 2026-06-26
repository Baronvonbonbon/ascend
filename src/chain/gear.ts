// AscendGear — on-chain, tradeable NFT relics. Earn them gaslessly (you sign a
// Mint authorization; the relay, which holds the minter role, submits + pays gas),
// own them as standard ERC-721s (listable on any marketplace), and carry them
// back into Ascend as persistent gear.

import { BrowserProvider, Contract } from "ethers";
import { CHAIN, GEAR_ABI } from "./config";
import { readProvider } from "./wallet";

export interface OwnedGear { tokenId: number; itemId: string; enchant: number; }

/** Read the player's owned relics (for the loadout + future marketplace sync). */
export async function readGear(address: string): Promise<OwnedGear[]> {
  try {
    const c = new Contract(CHAIN.ascendGear, GEAR_ABI, readProvider());
    const r = await c.gearOf(address);
    return r.ids.map((id: bigint, i: number) => ({
      tokenId: Number(id),
      itemId: r.items[i] as string,
      enchant: Number(r.enchants[i]),
    }));
  } catch {
    return [];
  }
}

/** Gasless mint: sign a Mint authorization; the relay mints the relic to you. */
export async function mintGear(
  provider: BrowserProvider,
  address: string,
  itemId: string,
  enchant: number,
): Promise<{ ok: boolean; error?: string }> {
  const deadline = Math.floor(Date.now() / 1000) + 3600;
  const signer = await provider.getSigner();
  const sig = await signer.signTypedData(
    { name: "AscendGear", version: "1", chainId: BigInt(CHAIN.id), verifyingContract: CHAIN.ascendGear },
    { Mint: [
      { name: "player", type: "address" }, { name: "itemId", type: "string" },
      { name: "enchant", type: "uint8" }, { name: "deadline", type: "uint256" },
    ] },
    { player: address, itemId, enchant, deadline },
  );

  let res: Response;
  try {
    res = await fetch(`${CHAIN.relayUrl}/ascend/mint`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ player: address, itemId, enchant, deadline: String(deadline), sig }),
    });
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "relay unreachable" };
  }
  const body = await res.json().catch(() => ({}));
  return res.ok ? { ok: true } : { ok: false, error: (body as { error?: string }).error ?? `relay ${res.status}` };
}
