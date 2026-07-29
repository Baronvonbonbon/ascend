// The forge: striking a relic you carry into an NFT on Asset Hub.
//
// A minted relic is a trophy. It is NOT consumed, NOT altered, and grants nothing in game —
// the item stays in your pack exactly as it was. See contracts/AscendRelics.sol.

import { encodeBytes32String } from "ethers";
import type { Item } from "../inventory";
import { connection } from "./provider";
import { relicsContract, RELICS_ABI } from "./contracts";
import { hasContracts, withTimeout } from "./config";
import { sendWrite, canWrite } from "./write";

const ZERO32 = "0x" + "00".repeat(32);
const BUC = { cursed: 0, uncursed: 1, blessed: 2 } as const;

/** Pack a short string into bytes32, trimming rather than throwing on anything oversized. */
function b32(s: string): string {
  let t = s;
  // encodeBytes32String rejects >31 bytes; step down until the UTF-8 encoding fits.
  while (new TextEncoder().encode(t).length > 31) t = t.slice(0, -1);
  return encodeBytes32String(t);
}

export function canForge(): boolean {
  return canWrite() && hasContracts();
}

/**
 * Strike `item` into a relic token. Returns the transaction hash, or null if there is no wallet,
 * no contract, or the player declined the signature.
 */
export async function forge(item: Item, depth: number, runHash?: string): Promise<string | null> {
  if (!canWrite() || !hasContracts()) return null;
  return sendWrite("relics", RELICS_ABI, "forge", [
    b32(item.type.fname ?? item.type.name),
    b32(item.type.ch),
    Math.max(-128, Math.min(127, Math.round(item.enchant ?? 0))),
    BUC[item.buc ?? "uncursed"] ?? 1,
    Math.max(0, Math.min(65535, Math.round(depth))),
    runHash || ZERO32,
  ]);
}

/** Token ids the connected player owns. Empty when there is no wallet — never throws. */
export async function ownedRelics(): Promise<number[]> {
  const conn = connection();
  if (!conn?.address || !hasContracts()) return [];
  const ids = await withTimeout((async () => {
    const c = relicsContract(conn.provider);
    return c ? await c.relicsOf(conn.address) : null;
  })());
  return ids ? (ids as bigint[]).map(Number) : [];
}
