// AscendDeed — the soulbound proof-of-ascension NFT. Permissionless, direct claim
// from the winner's own wallet (no relay, no trusted minter). One per address,
// non-transferable. The client no-ops while CHAIN.ascendDeed is the zero address.

import { BrowserProvider, Contract } from "ethers";
import { CHAIN, DEED_ABI, TX } from "./config";
import { readProvider } from "./wallet";

const ZERO = "0x0000000000000000000000000000000000000000";
export function deedConfigured(): boolean {
  return /^0x[0-9a-fA-F]{40}$/.test(CHAIN.ascendDeed) && CHAIN.ascendDeed.toLowerCase() !== ZERO;
}

export interface OwnedDeed { tokenId: number; depth: number; time: number; epoch: number; }

/** Read a wallet's Deed of Ascension, or null if it has none (or the contract is unset). */
export async function readDeed(address: string): Promise<OwnedDeed | null> {
  if (!deedConfigured()) return null;
  try {
    const c = new Contract(CHAIN.ascendDeed, DEED_ABI, readProvider());
    const r = await c.deedOf(address);
    const tokenId = Number(r.tokenId ?? r[0]);
    if (tokenId === 0) return null;
    return { tokenId, depth: Number(r.depth ?? r[1]), time: Number(r.time ?? r[2]), epoch: Number(r.epoch ?? r[3]) };
  } catch {
    return null;
  }
}

export interface DeedResult { ok: boolean; hash?: string; error?: string; }

/** Mint the soulbound Deed of Ascension — a direct tx from the player's own wallet. */
export async function claimDeed(
  provider: BrowserProvider,
  depth: number,
  epoch: number,
  onSubmit?: (hash: string) => void,
): Promise<DeedResult> {
  if (!deedConfigured()) return { ok: false, error: "deed contract not configured" };
  try {
    const signer = await provider.getSigner();
    const c = new Contract(CHAIN.ascendDeed, DEED_ABI, signer);
    const tx = await c.claim(depth, epoch, { ...TX });
    onSubmit?.(tx.hash);
    await tx.wait();
    return { ok: true, hash: tx.hash };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "claim failed";
    return { ok: false, error: /already ascended/i.test(msg) ? "already minted" : msg.slice(0, 80) };
  }
}
