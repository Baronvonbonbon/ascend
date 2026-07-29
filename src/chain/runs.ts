// Submitting a finished run, and reading back the leaderboard + the pool of the recently fallen.
//
// Both reads are a single `eth_call` returning a bounded array — never a log scan — because a
// player on Pine-RPC has no historical state to scan. See contracts/AscendRuns.sol.

import { encodeBytes32String, decodeBytes32String, keccak256, toUtf8Bytes } from "ethers";
import type { RunEntry } from "../hall";
import { readOnly } from "./provider";
import { runsContract, RUNS_ABI } from "./contracts";
import { hasContracts, withTimeout, LS } from "./config";
import { sendWrite, canWrite } from "./write";

/** A run as the chain holds it — a superset of the local `RunEntry`. */
export interface ChainRun extends RunEntry {
  player: string;
  seed: number;
  turns: number;
  at: number;
  /** Blake2b digest of this run's bones blob on the Bulletin chain, or "" if none was stored. */
  bonesCid: string;
}

const ZERO32 = "0x" + "00".repeat(32);

/** bytes32 ⇆ short string, tolerant of anything the chain hands back. */
function toName(b: string): string {
  try { return decodeBytes32String(b) || "an adventurer"; } catch { return "an adventurer"; }
}

/** Names are player-supplied and land in the log, so clamp hard: 24 chars, printable only. */
export function encodeName(raw: string): string {
  const clean = [...raw].filter((c) => c >= " " && c <= "~").join("").trim().slice(0, 24);
  return encodeBytes32String(clean || "an adventurer");
}

export function playerName(): string {
  try { return localStorage.getItem(LS.name) || "an adventurer"; } catch { return "an adventurer"; }
}

/** The name the player signs runs under. */
export function setPlayerName(n: string): void {
  try { localStorage.setItem(LS.name, n); } catch { /* storage blocked */ }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function decode(rows: any[]): ChainRun[] {
  return rows.map((r) => ({
    player: String(r.player),
    name: toName(r.name),
    depth: Number(r.maxDepth),
    won: Boolean(r.ascended),
    seed: Number(r.seed),
    turns: Number(r.turns),
    at: Number(r.recordedAt),
    bonesCid: r.bonesCid === ZERO32 ? "" : String(r.bonesCid),
  }));
}

/** The ascension board, best first. Empty on any failure — the caller falls back to local runs. */
export async function fetchLeaderboard(): Promise<ChainRun[]> {
  if (!hasContracts()) return [];
  const rows = await withTimeout((async () => {
    const c = runsContract((await readOnly()).provider);
    return c ? await c.leaderboard() : null;
  })());
  return rows ? decode(rows as unknown[] as Record<string, unknown>[]) : [];
}

/** The most recently fallen, newest first — the pool other players' graves are drawn from. */
export async function fetchBones(count = 24): Promise<ChainRun[]> {
  if (!hasContracts()) return [];
  const rows = await withTimeout((async () => {
    const c = runsContract((await readOnly()).provider);
    return c ? await c.recentBones(count) : null;
  })());
  return rows ? decode(rows as unknown[] as Record<string, unknown>[]) : [];
}

export interface RunSubmission {
  seed: number;
  turns: number;
  depth: number;
  maxDepth: number;
  ascended: boolean;
  /** Everything the run did, for later replay verification. */
  inputLog?: string;
  bonesCid?: string;
}

/**
 * Sign and record a finished run. Returns the transaction hash, or null if there is no wallet,
 * no contract, or the player declined — none of which is an error worth interrupting a death for.
 *
 * NEVER await this on the death path. Losing a submission costs a leaderboard entry; blocking the
 * game-over screen behind a chain round trip costs the player their evening.
 */
export async function submitRun(r: RunSubmission): Promise<string | null> {
  if (!canWrite() || !hasContracts()) return null;
  return sendWrite("runs", RUNS_ABI, "submitRun", [
    encodeName(playerName()),
    BigInt(Math.max(0, Math.floor(r.seed))),
    r.inputLog ? keccak256(toUtf8Bytes(r.inputLog)) : ZERO32,
    Math.max(0, Math.floor(r.turns)),
    Math.max(0, Math.floor(r.depth)),
    Math.max(0, Math.floor(r.maxDepth)),
    r.ascended,
    r.bonesCid || ZERO32,
  ]);
}
