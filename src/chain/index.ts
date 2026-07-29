// The only module the game itself imports. Everything heavy — ethers, and the smoldot light
// client behind Pine-RPC — sits behind a dynamic import, so a player who never connects a wallet
// never downloads a byte of it and the game keeps booting offline.
//
// Every function here resolves rather than rejects. "No chain" is the default state of this game,
// not an error, and nothing on a turn path is ever allowed to wait on a network.

import type { Item } from "../inventory";
import type { RunEntry } from "../hall";
import type { ProviderKind } from "./config";
import type { ChainRun, RunSubmission } from "./runs";

export type { ChainRun, RunSubmission, ProviderKind };

export interface ChainStatus {
  connected: boolean;
  kind?: ProviderKind;
  address?: string;
  canSign: boolean;
  /** Whether a contract address is configured at all — without one there is nothing to call. */
  contracts: boolean;
}

let status: ChainStatus = { connected: false, canSign: false, contracts: false };
const listeners: ((s: ChainStatus) => void)[] = [];

export function chainStatus(): ChainStatus { return status; }
export function onChainStatus(cb: (s: ChainStatus) => void): void { listeners.push(cb); cb(status); }

function publish(s: ChainStatus): void {
  status = s;
  for (const cb of listeners) { try { cb(s); } catch { /* a broken listener must not break the chain layer */ } }
}

/** Shorten an address for the HUD: 0x1234…abcd. */
export function shortAddress(a?: string): string {
  return a && a.length > 10 ? `${a.slice(0, 6)}…${a.slice(-4)}` : (a ?? "");
}

export async function connectChain(kind?: ProviderKind, onStep?: (s: string) => void): Promise<ChainStatus> {
  try {
    const { connect } = await import("./provider");
    const c = await connect(kind, onStep);
    const { hasContracts } = await import("./config");
    publish(c
      ? { connected: true, kind: c.kind, address: c.address, canSign: c.canSign, contracts: hasContracts() }
      : { connected: false, canSign: false, contracts: hasContracts() });
  } catch {
    publish({ connected: false, canSign: false, contracts: false });
  }
  return status;
}

/** Silent reconnect on boot — never prompts, so it is safe to call unconditionally. */
export async function resumeChain(): Promise<ChainStatus> {
  try {
    const { autoConnect } = await import("./provider");
    const c = await autoConnect();
    const { hasContracts } = await import("./config");
    if (c) publish({ connected: true, kind: c.kind, address: c.address, canSign: c.canSign, contracts: hasContracts() });
  } catch { /* stay disconnected */ }
  return status;
}

export async function disconnectChain(): Promise<void> {
  try { const { disconnect } = await import("./provider"); await disconnect(); } catch { /* */ }
  publish({ connected: false, canSign: false, contracts: status.contracts });
}

export async function availableProviders(): Promise<ProviderKind[]> {
  try { const { available } = await import("./provider"); return available(); } catch { return []; }
}

// ── the game-facing surface ─────────────────────────────────────────────────

/**
 * The ascension board plus the recently fallen, folded into the shape the Hall already uses.
 *
 * Called on every game start, so it checks `hasContracts()` FIRST. That lives in ./config, which
 * is a few hundred bytes and pulls in nothing; ./runs drags in the whole of ethers. Without this
 * ordering every player — wallet or not, online or not — would fetch 270 kB to discover there is
 * nothing to read.
 */
export async function chainRuns(): Promise<{ board: ChainRun[]; bones: ChainRun[] }> {
  const empty = { board: [] as ChainRun[], bones: [] as ChainRun[] };
  try {
    const { hasContracts } = await import("./config");
    if (!hasContracts()) return empty;
    const { fetchLeaderboard, fetchBones } = await import("./runs");
    const [board, bones] = await Promise.all([fetchLeaderboard(), fetchBones()]);
    return { board, bones };
  } catch { return empty; }
}

/** Fire-and-forget: record a finished run. Safe to call with `void` on the death path. */
export async function recordRunOnChain(r: RunSubmission): Promise<string | null> {
  if (!status.canSign || !status.contracts) return null; // nothing to sign with, or nothing to sign at
  try { const { submitRun } = await import("./runs"); return await submitRun(r); } catch { return null; }
}

export async function forgeRelic(item: Item, depth: number, runHash?: string): Promise<string | null> {
  try { const { forge } = await import("./relics"); return await forge(item, depth, runHash); } catch { return null; }
}

export async function canForgeRelic(): Promise<boolean> {
  try { const { canForge } = await import("./relics"); return canForge(); } catch { return false; }
}

// ── co-op invites ───────────────────────────────────────────────────────────
// Only the WebRTC handshake goes through the chain; the game itself stays on the direct peer link.

export type { Invitation, SendResult } from "./invites";

export async function invitesReady(): Promise<boolean> {
  try { const { hasInvites } = await import("./invites"); return hasInvites() && status.canSign; } catch { return false; }
}

export async function sendCoopInvite(to: string, offer: string): Promise<import("./invites").SendResult> {
  try { const m = await import("./invites"); return await m.sendInvite(to, offer); } catch { return "failed"; }
}

/** Publish this device's sealing key so others can invite us. One transaction, once. */
export async function publishInviteKey(): Promise<boolean> {
  try { const m = await import("./invites"); return await m.ensureKeyPublished(); } catch { return false; }
}

export async function coopInbox(): Promise<import("./invites").Invitation[]> {
  try { const m = await import("./invites"); return await m.fetchInbox(); } catch { return []; }
}

export async function acceptCoopInvite(from: string, answer: string): Promise<import("./invites").SendResult> {
  try { const m = await import("./invites"); return await m.acceptInvite(from, answer); } catch { return "failed"; }
}

export async function pollCoopAnswer(to: string): Promise<string | null> {
  try { const m = await import("./invites"); return await m.pollAnswer(to); } catch { return null; }
}

export async function declineCoopInvite(from: string): Promise<void> {
  try { const m = await import("./invites"); await m.declineInvite(from); } catch { /* */ }
}

export async function normalizeChainAddress(a: string): Promise<string | null> {
  try { const m = await import("./invites"); return m.normalizeAddress(a); } catch { return null; }
}

export function toRunEntries(rows: ChainRun[]): RunEntry[] {
  return rows.map((r) => ({ name: r.name, depth: r.depth, won: r.won }));
}
