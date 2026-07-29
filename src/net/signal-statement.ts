// Invites over the People chain statement store — the rail the Polkadot app itself uses for
// calls ("the call offer, answer, and connection candidates as encrypted chat messages over the
// statement-store channel").
//
// WHY IT IS THE RIGHT RAIL. Statements never enter block storage; they live briefly in nodes'
// local pools and decay. So unlike a contract, signalling leaves no permanent record of who
// played with whom — and none of the IP addresses inside an SDP are ever written down anywhere.
// It is also free: quota-based, not fee-based.
//
// WHY IT IS NOT THE ONLY RAIL. Publishing needs a statement allowance, and claiming one needs a
// personhood alias (`resources.setStatementStoreAccount` requires `Origin::StmtStoreAlias`,
// "produced ... after proof validation"). Inside the Polkadot app the host has already onboarded
// the player; in a plain browser nobody has. Hence signal-contract.ts.
//
// THREE HARD LIMITS SHAPE EVERYTHING BELOW, all from the SDK's own constants:
//   MAX_STATEMENT_SIZE   512 bytes per statement  -> the handshake must be trickled and chunked
//   MAX_USER_TOTAL      1024 bytes live per user  -> only ~2 statements alive at once
//   DEFAULT_TTL_SECONDS   30 seconds              -> NOT a mailbox; both players must be present
//
// The last one is the important one for callers: this transport can only reach someone who has
// the lobby open right now. `mailbox: false` says so, and the lobby tells the player.

import { hostOfferTrickle, guestAnswerTrickle, type Peer, type Trickle } from "./peer";
import type { AddressedSignal, Invite, SendResult } from "./signal";

const APP = "ascend";

/** One frame of the handshake. Kept terse — every byte counts against 512. */
interface Frame {
  /** ring = "I want to play", o = offer, a = answer, c = ICE candidate */
  k: "ring" | "o" | "a" | "c";
  /** sender address */
  f: string;
  /** message id, so two payloads of the same kind in flight cannot be interleaved */
  q: number;
  /** chunk index and count, for payloads that do not fit in one statement */
  i?: number;
  n?: number;
  /** payload chunk */
  d?: string;
}

/** Statements cap at 512 bytes including the envelope; leave generous room for it. */
export const CHUNK = 300;

/** Split a payload into statement-sized pieces. Always at least one, so empty payloads still send. */
export function chunks(s: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < s.length; i += CHUNK) out.push(s.slice(i, i + CHUNK));
  return out.length ? out : [""];
}

/**
 * Reassembles chunked payloads. Statements arrive out of order and can be dropped, so this holds
 * partial sets keyed by sender+kind and only yields once every piece is present.
 *
 * Exported for tests: a silent reassembly bug would look like "co-op sometimes doesn't connect",
 * which is close to undiagnosable in the wild.
 */
export function makeReassembler() {
  const parts = new Map<string, { n: number; got: Map<number, string> }>();
  return {
    /** Returns the whole payload once complete, else null. */
    add(key: string, f: { i?: number; n?: number; d?: string }): string | null {
      if (f.i === undefined || f.n === undefined) return f.d ?? null; // unchunked
      if (f.n <= 0 || f.i < 0 || f.i >= f.n) return null;             // malformed — ignore
      let e = parts.get(key);
      if (!e || e.n !== f.n) { e = { n: f.n, got: new Map() }; parts.set(key, e); }
      e.got.set(f.i, f.d ?? "");
      if (e.got.size < f.n) return null;
      parts.delete(key);
      return Array.from({ length: f.n }, (_, i) => e!.got.get(i) ?? "").join("");
    },
    drop(key: string) { parts.delete(key); },
    get pending() { return parts.size; },
  };
}

export async function statementSignal(): Promise<AddressedSignal | null> {
  const chain = await import("../chain");
  const status = chain.chainStatus();
  if (!status.connected || !status.address) return null;

  // The SDK is host-only by design ("designed to run exclusively inside a host container"), and
  // outside the app there is no personhood alias to claim a statement allowance with. Fail soft:
  // pickSignal() simply falls through to the contract.
  let client: {
    connect(c: unknown): Promise<void>;
    publish(d: unknown, o?: unknown): Promise<unknown>;
    subscribe<T>(cb: (s: { data: T }) => void, o?: { topic2?: string }): { unsubscribe(): void };
    destroy(): void;
  };
  try {
    const { StatementStoreClient } = await import("@parity/product-sdk-statement-store");
    client = new StatementStoreClient({ appName: APP }) as unknown as typeof client;
    await client.connect({ mode: "host" });
  } catch {
    return null; // not in a host container, or no allowance — the contract rail handles it
  }

  const me = status.address.toLowerCase();
  // Each player listens on a topic derived from their own address; to reach someone, publish
  // under theirs. One subscription per player, and no shared-room negotiation.
  const sub = (who: string) => who.toLowerCase();

  const inbound = makeReassembler();
  const invites: Invite[] = [];
  const handshakes = new Map<string, Trickle & { accept?(a: string): Promise<void> }>();
  let seq = 0;

  const publish = async (to: string, f: Frame) => {
    // A fresh channel per frame: last-write-wins would otherwise have each candidate evict the
    // one before it, and with only ~2 statements live at a time they would be lost in flight.
    await client.publish(f, { topic2: sub(to), channel: `${APP}/${me}/${f.k}/${seq++}`, ttlSeconds: 60 });
  };

  let msgId = 0;
  const sendChunked = async (to: string, k: Frame["k"], payload: string) => {
    const parts = chunks(payload);
    const q = msgId++;
    for (let i = 0; i < parts.length; i++) await publish(to, { k, f: me, q, i, n: parts.length, d: parts[i] });
  };

  const collect = (key: string, f: Frame): string | null => inbound.add(key, f);

  const handle = async (f: Frame) => {
    if (!f?.k || !f.f || f.f.toLowerCase() === me) return;
    const from = f.f;

    if (f.k === "ring") {
      if (!invites.some((i) => i.from === from)) invites.push({ from, at: Date.now(), offer: "" });
      return;
    }
    if (f.k === "o") {
      const sdp = collect(`o:${from}:${f.q}`, f);
      if (!sdp) return;
      const existing = invites.find((i) => i.from === from);
      if (existing) existing.offer = sdp;
      else invites.push({ from, at: Date.now(), offer: sdp });
      return;
    }
    if (f.k === "a") {
      const sdp = collect(`a:${from}:${f.q}`, f);
      const h = handshakes.get(from);
      if (sdp && h?.accept) await h.accept(sdp);
      return;
    }
    if (f.k === "c") {
      // Keyed by the sender's message id: chunks of ONE candidate must group together, and two
      // candidates in flight at once must not merge into each other.
      const cand = collect(`c:${from}:${f.q}`, f);
      if (cand) await handshakes.get(from)?.addCandidate(cand);
    }
  };

  const subscription = client.subscribe<Frame>((s) => { void handle(s.data); }, { topic2: sub(me) });

  /** Wire a trickle handshake to the wire: stream our candidates, remember it for theirs. */
  const wire = (other: string, t: Trickle & { accept?(a: string): Promise<void> }, onPeer: (p: Peer) => void) => {
    handshakes.set(other, t);
    t.onCandidate((c) => { void sendChunked(other, "c", c); });
    t.peer.onState((open) => { if (open) onPeer(t.peer); });
  };

  return {
    id: "statement",
    label: "Polkadot app invite",
    ready: Promise.resolve(true), // no key registry — the host account is already addressable
    mailbox: false, // 30-second TTL: the other player must have the lobby open right now

    async invite(to: string, onPeer: (p: Peer) => void): Promise<SendResult> {
      try {
        const t = await hostOfferTrickle();
        wire(to, t, onPeer); // subscribe before anything is awaited — see signal-contract.ts
        await publish(to, { k: "ring", f: me, q: msgId++ });
        await sendChunked(to, "o", t.sdp);
        return "sent";
      } catch { return "failed"; }
    },

    async inbox(): Promise<Invite[]> {
      // Only invitations whose offer has actually arrived can be accepted.
      return invites.filter((i) => i.offer).sort((a, b) => b.at - a.at);
    },

    async accept(inv: Invite, onPeer: (p: Peer) => void): Promise<SendResult> {
      try {
        const t = await guestAnswerTrickle(inv.offer);
        wire(inv.from, t, onPeer);
        await sendChunked(inv.from, "a", t.sdp);
        return "sent";
      } catch { return "failed"; }
    },

    async decline(inv: Invite): Promise<void> {
      const i = invites.findIndex((x) => x.from === inv.from);
      if (i >= 0) invites.splice(i, 1);
      handshakes.get(inv.from)?.close();
      handshakes.delete(inv.from);
    },

    stop() {
      try { subscription.unsubscribe(); } catch { /* */ }
      for (const h of handshakes.values()) { try { h.close(); } catch { /* */ } }
      handshakes.clear();
      try { client.destroy(); } catch { /* */ }
    },
  };
}
