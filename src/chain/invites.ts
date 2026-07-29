// The co-op rendezvous: send an invite to an address, they accept, the peer link forms.
//
// Only the WebRTC handshake passes through the chain. Once the data channel is open, moves and
// chat go directly browser-to-browser exactly as they always have — see src/net/peer.ts.

import { Contract, getAddress, hexlify, toUtf8Bytes, toUtf8String, getBytes } from "ethers";
import { connection } from "./provider";
import { withTimeout, contractAddress } from "./config";

const ABI = [
  "function invite(address to, bytes offer)",
  "function accept(address from, bytes answer)",
  "function decline(address from)",
  "function withdraw(address to)",
  "function inbox(address who) view returns (tuple(address from, uint40 at, bytes offer)[])",
  "function answerFor(address from, address to) view returns (bytes)",
] as const;

export interface Invitation { from: string; at: number; offer: string }

export function invitesAddress(): string { return contractAddress("invites"); }

export function hasInvites(): boolean { return /^0x[0-9a-fA-F]{40}$/.test(invitesAddress()); }

// ── SDP compression ─────────────────────────────────────────────────────────
// A gathered SDP offer is 1.5–4 KB of highly repetitive text; deflate takes ~70% off it, which
// matters because every byte is contract storage. CompressionStream is in every browser that can
// run WebRTC, but fall back to raw bytes rather than fail if it is somehow missing.

/** ethers hands back Uint8Array<ArrayBufferLike>; the streams API wants an ArrayBuffer-backed
 *  view. Copying is cheap at these sizes and avoids a cast that could hide a real mismatch. */
function plain(a: Uint8Array): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(new ArrayBuffer(a.byteLength));
  out.set(a);
  return out;
}

async function through(s: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  const reader = s.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) chunks.push(value);
  }
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let at = 0;
  for (const c of chunks) { out.set(c, at); at += c.length; }
  return out;
}

async function deflate(text: string): Promise<string> {
  const raw = toUtf8Bytes(text);
  if (typeof CompressionStream === "undefined") return hexlify(raw);
  const cs = new CompressionStream("deflate-raw");
  const w = cs.writable.getWriter(); void w.write(plain(raw)); void w.close();
  return hexlify(await through(cs.readable));
}

async function inflate(hex: string): Promise<string> {
  const raw = getBytes(hex);
  if (typeof DecompressionStream === "undefined") return toUtf8String(raw);
  try {
    const ds = new DecompressionStream("deflate-raw");
    const w = ds.writable.getWriter(); void w.write(plain(raw)); void w.close();
    return toUtf8String(await through(ds.readable));
  } catch {
    return toUtf8String(raw); // written by a browser without CompressionStream
  }
}

// ── contract access ─────────────────────────────────────────────────────────

function read(): Contract | null {
  const conn = connection();
  if (!conn || !hasInvites()) return null;
  return new Contract(invitesAddress(), ABI as unknown as string[], conn.provider);
}

async function write(): Promise<Contract | null> {
  const conn = connection();
  if (!conn?.canSign || !hasInvites()) return null;
  const signer = await (conn.provider as { getSigner(): Promise<unknown> }).getSigner();
  return new Contract(invitesAddress(), ABI as unknown as string[], signer as never);
}

/** Normalise whatever the player typed. Returns null if it is not an address. */
export function normalizeAddress(a: string): string | null {
  try { return getAddress(a.trim()); } catch { return null; }
}

/** Offer to play. `offer` is the raw base64 SDP from `hostOffer()`. */
export async function sendInvite(to: string, offer: string): Promise<boolean> {
  const c = await write();
  if (!c) return false;
  const r = await withTimeout((async () => {
    const tx = await c.invite(to, await deflate(offer));
    await tx.wait();
    return true;
  })(), 60_000);
  return r === true;
}

/** Pending invites addressed to the connected account, newest first. */
export async function fetchInbox(): Promise<Invitation[]> {
  const conn = connection();
  const c = read();
  if (!c || !conn?.address) return [];
  const rows = await withTimeout(c.inbox(conn.address), 10_000);
  if (!rows) return [];
  const out: Invitation[] = [];
  for (const r of rows as { from: string; at: bigint; offer: string }[]) {
    out.push({ from: String(r.from), at: Number(r.at), offer: await inflate(r.offer) });
  }
  return out.sort((a, b) => b.at - a.at);
}

/** Accept an invite by publishing the SDP answer back. */
export async function acceptInvite(from: string, answer: string): Promise<boolean> {
  const c = await write();
  if (!c) return false;
  const r = await withTimeout((async () => {
    const tx = await c.accept(from, await deflate(answer));
    await tx.wait();
    return true;
  })(), 60_000);
  return r === true;
}

/** Has `to` answered our invite yet? Returns the raw SDP answer, or null. */
export async function pollAnswer(to: string): Promise<string | null> {
  const conn = connection();
  const c = read();
  if (!c || !conn?.address) return null;
  const hex = await withTimeout(c.answerFor(conn.address, to), 10_000);
  if (!hex || hex === "0x") return null;
  return inflate(hex as string);
}

export async function declineInvite(from: string): Promise<void> {
  const c = await write();
  if (c) await withTimeout((async () => { await (await c.decline(from)).wait(); return true; })(), 60_000);
}
