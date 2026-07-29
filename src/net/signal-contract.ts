// Invites over AscendInvites on Asset Hub — the rail for players outside the Polkadot app.
//
// This is the MAILBOX transport: an invite sits on chain for an hour, so you can invite someone
// who is not online yet. That is the one thing the statement store cannot do (30-second TTL), and
// it is why this path survives rather than being retired.
//
// Handshakes are bundled (not trickled): one contract write is far cheaper than a dozen, and the
// 512-byte ceiling that forces trickling on the statement store does not apply here.
//
// Payloads are sealed end-to-end. See src/chain/crypto.ts — the chain remembers calldata forever,
// so a plaintext SDP would publish the sender's IP permanently.

import { hostOffer, guestAnswer, type Peer } from "./peer";
import type { AddressedSignal, Invite, SendResult } from "./signal";

export async function contractSignal(): Promise<AddressedSignal | null> {
  const chain = await import("../chain");
  if (!(await chain.invitesReady())) return null;

  // Others can only invite us once our sealing key is on chain. One transaction, once.
  await chain.publishInviteKey();

  let stopped = false;
  /** Watch for the answer to an invite we sent. No push channel here, so poll — slowly. */
  const awaitAnswer = (to: string, accept: (a: string) => Promise<void>, isOpen: () => boolean) => {
    const started = Date.now();
    const tick = async () => {
      if (stopped || isOpen()) return;
      if (Date.now() - started > 10 * 60_000) return; // they never answered
      const answer = await chain.pollCoopAnswer(to);
      if (answer) { try { await accept(answer); } catch { /* malformed — let it lapse */ } return; }
      setTimeout(() => void tick(), 6000);
    };
    setTimeout(() => void tick(), 6000);
  };

  return {
    id: "contract",
    label: "on-chain invite",
    mailbox: true,

    async invite(to: string, onPeer: (p: Peer) => void): Promise<SendResult> {
      const { peer, code, accept } = await hostOffer();
      const res = await chain.sendCoopInvite(to, code);
      if (res !== "sent") { peer.close(); return res as SendResult; }
      peer.onState((open) => { if (open) onPeer(peer); });
      awaitAnswer(to, accept, () => peer.isOpen());
      return "sent";
    },

    async inbox(): Promise<Invite[]> {
      return (await chain.coopInbox()).map((i) => ({ from: i.from, at: i.at, offer: i.offer }));
    },

    async accept(inv: Invite, onPeer: (p: Peer) => void): Promise<SendResult> {
      const { peer, code } = await guestAnswer(inv.offer);
      const res = await chain.acceptCoopInvite(inv.from, code);
      if (res !== "sent") { peer.close(); return res as SendResult; }
      peer.onState((open) => { if (open) onPeer(peer); });
      return "sent";
    },

    async decline(inv: Invite): Promise<void> { await chain.declineCoopInvite(inv.from); },

    stop() { stopped = true; },
  };
}
