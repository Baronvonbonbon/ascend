// AscendGear — on-chain, tradeable NFT relics. Minting is permissionless and
// direct: the player **forges** a relic from their own wallet (no relay, no
// trusted minter). The contract enforces bounds (allowlisted ids, enchant cap),
// a PAS price, and a per-address cooldown, and rolls the relic's **rarity**
// on-chain (Common→Legendary), which adds to its enchant.

import { BrowserProvider, Contract } from "ethers";
import { CHAIN, GEAR_ABI, TX } from "./config";
import { readProvider } from "./wallet";

export interface OwnedGear { tokenId: number; itemId: string; enchant: number; rarity: number; }

/** Read the player's owned relics (for the loadout + marketplace sync). */
export async function readGear(address: string): Promise<OwnedGear[]> {
  try {
    const c = new Contract(CHAIN.ascendGear, GEAR_ABI, readProvider());
    const r = await c.gearOf(address);
    return r.ids.map((id: bigint, i: number) => ({
      tokenId: Number(id),
      itemId: r.items[i] as string,
      enchant: Number(r.enchants[i]),
      rarity: Number(r.rarities[i]),
    }));
  } catch {
    return [];
  }
}

/** The PAS price to forge an item at a given base enchant (read on-chain). */
export async function forgePrice(baseEnchant: number): Promise<bigint> {
  const c = new Contract(CHAIN.ascendGear, GEAR_ABI, readProvider());
  return await c.forgePrice(baseEnchant);
}

export interface ForgeResult { ok: boolean; hash?: string; enchant?: number; rarity?: number; error?: string; }

/** Forge an item into a tradeable NFT — a direct wallet transaction. Returns the
 *  on-chain-rolled rarity + final enchant once mined. `onSubmit` fires on broadcast. */
export async function forgeGear(
  provider: BrowserProvider,
  itemId: string,
  baseEnchant: number,
  priceWei: bigint,
  onSubmit?: (hash: string) => void,
): Promise<ForgeResult> {
  try {
    const signer = await provider.getSigner();
    const gear = new Contract(CHAIN.ascendGear, GEAR_ABI, signer);
    const tx = await gear.forge(itemId, baseEnchant, { value: priceWei, ...TX, gasLimit: 3_000_000n });
    onSubmit?.(tx.hash);
    const receipt = await tx.wait();
    // Pull the rolled rarity + final enchant out of the Forged event.
    let enchant = baseEnchant, rarity = 0;
    for (const log of receipt?.logs ?? []) {
      try {
        const parsed = gear.interface.parseLog(log);
        if (parsed?.name === "Forged") { enchant = Number(parsed.args.enchant); rarity = Number(parsed.args.rarity); break; }
      } catch { /* not our event */ }
    }
    return { ok: true, hash: tx.hash, enchant, rarity };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "transaction failed";
    return { ok: false, error: /reject|denied|user/i.test(msg) ? "you stepped back from the forge" : msg };
  }
}
