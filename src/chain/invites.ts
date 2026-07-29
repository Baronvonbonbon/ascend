// The co-op rendezvous: send an invite to an address, they accept, the peer link forms.
//
// Only the WebRTC handshake passes through the chain, and it is SEALED end-to-end (see crypto.ts
// for why — an SDP offer carries your public IP, and an invite is a signed transaction, so a
// plaintext payload would tie your address to your IP in block history forever). Once the data
// channel is open, moves and chat go directly browser-to-browser exactly as they always have.

import { Contract, getAddress, hexlify, toUtf8Bytes, toUtf8String, getBytes } from "ethers";
import { connection } from "./provider";
import { withTimeout, contractAddress } from "./config";
import { seal, open as unseal, localPublicKey, sealingAvailable } from "./crypto";

const ABI = [
  "function invite(address to, bytes offer)",
  "function accept(address from, bytes answer)",
  "function decline(address from)",
  "function withdraw(address to)",
  "function inbox(address who) view returns (tuple(address from, uint40 at, bytes offer)[])",
  "function answerFor(address from, address to) view returns (bytes)",
  "function inviteKey(address who) view returns (bytes)",
  "function publishInviteKey(bytes key)",
] as const;

export interface Invitation { from: string; at: number; offer: string }

/** Why an invite could not be sent — the lobby needs to tell these apart. */
export type SendResult = "sent" | "no-wallet" | "no-recipient-key" | "no-crypto" | "failed";

export function invitesAddress(): string { return contractAddress("invites"); }

export function hasInvites(): boolean { return /^0x[0-9a-fA-F]{40}$/.test(invitesAddress()); }

// ── SDP compression ─────────────────────────────────────────────────────────
// A gathered SDP offer is 1.5–4 KB of highly repetitive text; deflate takes ~70% off before we
// seal it, which matters because every byte is contract storage.

/** Copy into an ArrayBuffer-backed view — the streams and crypto APIs will not take any other. */
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

async function deflate(text: string): Promise<Uint8Array> {
  const raw = toUtf8Bytes(text);
  if (typeof CompressionStream === "undefined") return raw;
  const cs = new CompressionStream("deflate-raw");
  const w = cs.writable.getWriter(); void w.write(plain(raw)); void w.close();
  return through(cs.readable);
}

async function inflate(raw: Uint8Array): Promise<string> {
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

// ── the key registry ────────────────────────────────────────────────────────

/** The key `who` has published, or null if they have never opened the game with coffers. */
export async function keyOf(who: string): Promise<Uint8Array | null> {
  const c = read();
  if (!c) return null;
  const hex = await withTimeout(c.inviteKey(who), 10_000);
  if (!hex || hex === "0x") return null;
  return getBytes(hex as string);
}

/**
 * Make sure the key on chain is this device's. Costs a transaction only when it actually differs,
 * so the steady state is one view call and nothing else.
 */
export async function ensureKeyPublished(): Promise<boolean> {
  const conn = connection();
  if (!conn?.canSign || !conn.address || !hasInvites() || !sealingAvailable()) return false;
  const mine = await localPublicKey();
  if (!mine) return false;
  const published = await keyOf(conn.address);
  if (published && published.length === mine.length && published.every((b, i) => b === mine[i])) return true;

  const c = await write();
  if (!c) return false;
  const ok = await withTimeout((async () => {
    const tx = await c.publishInviteKey(hexlify(mine));
    await tx.wait();
    return true;
  })(), 60_000);
  return ok === true;
}

// ── invites ─────────────────────────────────────────────────────────────────

/**
 * Offer to play. `offer` is the raw base64 SDP from `hostOffer()`.
 *
 * REFUSES rather than downgrading. With no recipient key there is nothing to seal to, and sending
 * the SDP in the clear would publish this player's IP address permanently. The lobby turns that
 * refusal into "ask them to open the game with coffers connected once".
 */
export async function sendInvite(to: string, offer: string): Promise<SendResult> {
  if (!sealingAvailable()) return "no-crypto";
  const c = await write();
  if (!c) return "no-wallet";
  const theirKey = await keyOf(to);
  if (!theirKey) return "no-recipient-key";
  const sealed = await seal(theirKey, await deflate(offer));
  if (!sealed) return "failed";

  const ok = await withTimeout((async () => {
    const tx = await c.invite(to, hexlify(sealed));
    await tx.wait();
    return true;
  })(), 60_000);
  return ok === true ? "sent" : "failed";
}

/** Pending invites for the connected account, newest first. Ones we cannot open are dropped. */
export async function fetchInbox(): Promise<Invitation[]> {
  const conn = connection();
  const c = read();
  if (!c || !conn?.address) return [];
  const rows = await withTimeout(c.inbox(conn.address), 10_000);
  if (!rows) return [];
  const out: Invitation[] = [];
  for (const r of rows as { from: string; at: bigint; offer: string }[]) {
    const opened = await unseal(getBytes(r.offer));
    if (!opened) continue; // sealed to a key we no longer hold, or tampered with — never shown
    out.push({ from: String(r.from), at: Number(r.at), offer: await inflate(opened) });
  }
  return out.sort((a, b) => b.at - a.at);
}

/** Accept an invite by publishing the SDP answer, sealed back to whoever invited us. */
export async function acceptInvite(from: string, answer: string): Promise<SendResult> {
  if (!sealingAvailable()) return "no-crypto";
  const c = await write();
  if (!c) return "no-wallet";
  const theirKey = await keyOf(from);
  if (!theirKey) return "no-recipient-key"; // they invited us, so this means they rotated keys
  const sealed = await seal(theirKey, await deflate(answer));
  if (!sealed) return "failed";

  const ok = await withTimeout((async () => {
    const tx = await c.accept(from, hexlify(sealed));
    await tx.wait();
    return true;
  })(), 60_000);
  return ok === true ? "sent" : "failed";
}

/** Has `to` answered our invite yet? Returns the raw SDP answer, or null. */
export async function pollAnswer(to: string): Promise<string | null> {
  const conn = connection();
  const c = read();
  if (!c || !conn?.address) return null;
  const hex = await withTimeout(c.answerFor(conn.address, to), 10_000);
  if (!hex || hex === "0x") return null;
  const opened = await unseal(getBytes(hex as string));
  return opened ? inflate(opened) : null;
}

export async function declineInvite(from: string): Promise<void> {
  const c = await write();
  if (c) await withTimeout((async () => { await (await c.decline(from)).wait(); return true; })(), 60_000);
}
