// True peer-to-peer transport for Ascend co-op, over a WebRTC data channel.
//
// One peer HOSTS (runs the authoritative simulation), the other JOINS (a thin
// terminal). A public STUN server is used only for NAT discovery — all game traffic
// flows directly browser-to-browser.
//
// There are two ways to get the handshake across, because the transports have very different
// shapes:
//
//   BUNDLED (hostOffer / guestAnswer) — wait for ICE gathering to finish, then hand back one
//     self-contained code. Used by the copy/paste flow, where a human carries the blob, and by
//     the invite contract, where one write is cheaper than many. Costs up to 4s of gathering.
//
//   TRICKLE (hostOfferTrickle / guestAnswerTrickle) — return the bare SDP immediately and stream
//     each ICE candidate as it is discovered. Required by the statement store, whose statements
//     cap at 512 bytes — a gathered offer is several KB and simply will not fit. It is also how
//     the Polkadot app's own calls signal, and it connects faster since nothing waits on the
//     gathering timeout.

const RTC_CONFIG: RTCConfiguration = { iceServers: [{ urls: "stun:stun.l.google.com:19302" }] };

export interface Peer {
  send(msg: unknown): void;
  onMessage(cb: (msg: any) => void): void;       // eslint-disable-line @typescript-eslint/no-explicit-any
  onState(cb: (open: boolean) => void): void;
  isOpen(): boolean;
  close(): void;
}

type MsgCb = (m: any) => void; // eslint-disable-line @typescript-eslint/no-explicit-any
type StateCb = (open: boolean) => void;

function makePeer(pc: RTCPeerConnection): { peer: Peer; bind: (dc: RTCDataChannel) => void } {
  const msgCbs: MsgCb[] = [];
  const stateCbs: StateCb[] = [];
  let chan: RTCDataChannel | null = null;
  const bind = (dc: RTCDataChannel) => {
    chan = dc;
    dc.onmessage = (e) => { try { const m = JSON.parse(e.data); msgCbs.forEach((cb) => cb(m)); } catch { /* ignore */ } };
    dc.onopen = () => stateCbs.forEach((cb) => cb(true));
    dc.onclose = () => stateCbs.forEach((cb) => cb(false));
  };
  const peer: Peer = {
    send: (m) => { if (chan && chan.readyState === "open") chan.send(JSON.stringify(m)); },
    onMessage: (cb) => msgCbs.push(cb),
    // A late subscriber is told the current state immediately. Without this, anyone who registers
    // after the channel has already opened never hears about it — and the open event is gone for
    // good. That is easy to do by accident: the invite transports await a chain transaction
    // between creating the peer and subscribing, and the link can form inside that window.
    onState: (cb) => { stateCbs.push(cb); if (chan?.readyState === "open") cb(true); },
    isOpen: () => chan?.readyState === "open",
    close: () => { try { chan?.close(); } catch { /* */ } pc.close(); },
  };
  return { peer, bind };
}

/** Wait until ICE candidates are gathered so the SDP we share is self-contained. */
function gatherComplete(pc: RTCPeerConnection): Promise<void> {
  if (pc.iceGatheringState === "complete") return Promise.resolve();
  return new Promise((res) => {
    const check = () => { if (pc.iceGatheringState === "complete") { pc.removeEventListener("icegatheringstatechange", check); res(); } };
    pc.addEventListener("icegatheringstatechange", check);
    setTimeout(res, 4000); // safety: some networks never report "complete"
  });
}

const encode = (d: RTCSessionDescription | null) => btoa(JSON.stringify(d));
const decode = (code: string): RTCSessionDescriptionInit => JSON.parse(atob(code.trim()));

/** Host side: returns the offer code to share + an `accept` to take the guest's answer. */
export async function hostOffer(): Promise<{ peer: Peer; code: string; accept: (answer: string) => Promise<void> }> {
  const pc = new RTCPeerConnection(RTC_CONFIG);
  const { peer, bind } = makePeer(pc);
  bind(pc.createDataChannel("ascend", { ordered: true }));
  await pc.setLocalDescription(await pc.createOffer());
  await gatherComplete(pc);
  return {
    peer,
    code: encode(pc.localDescription),
    accept: async (answer) => { await pc.setRemoteDescription(decode(answer)); },
  };
}

/** Guest side: consume the host's offer, return the answer code to send back. */
export async function guestAnswer(offer: string): Promise<{ peer: Peer; code: string }> {
  const pc = new RTCPeerConnection(RTC_CONFIG);
  const { peer, bind } = makePeer(pc);
  pc.ondatachannel = (e) => bind(e.channel);
  await pc.setRemoteDescription(decode(offer));
  await pc.setLocalDescription(await pc.createAnswer());
  await gatherComplete(pc);
  return { peer, code: encode(pc.localDescription) };
}

// ── trickle mode ────────────────────────────────────────────────────────────
// Each piece is published the moment it exists, so nothing has to fit in one message.

/** A handshake in progress: the local description now, candidates as they arrive. */
export interface Trickle {
  peer: Peer;
  /** The bare SDP, before any candidates — small enough for a 512-byte statement once deflated. */
  sdp: string;
  /** Fires for every local candidate found. Stops on its own once gathering completes. */
  onCandidate(cb: (candidate: string) => void): void;
  /** Feed in a candidate the far side published. Safe to call before the remote SDP arrives. */
  addCandidate(candidate: string): Promise<void>;
  close(): void;
}

/** Shared trickle plumbing: candidate fan-out, plus queuing for candidates that arrive early. */
function makeTrickle(pc: RTCPeerConnection, peer: Peer): Omit<Trickle, "sdp"> & { flush(): Promise<void> } {
  const cbs: ((c: string) => void)[] = [];
  pc.onicecandidate = (e) => {
    if (!e.candidate) return; // null marks the end of gathering — nothing to send
    const line = JSON.stringify(e.candidate.toJSON());
    for (const cb of cbs) cb(line);
  };
  // A candidate can legitimately arrive before setRemoteDescription; WebRTC rejects those, so
  // hold them until there is a remote description to attach them to.
  const queued: string[] = [];
  const drain = async () => {
    while (queued.length) {
      try { await pc.addIceCandidate(JSON.parse(queued.shift()!)); } catch { /* stale or malformed — skip it */ }
    }
  };
  return {
    peer,
    flush: drain,
    onCandidate: (cb) => { cbs.push(cb); },
    addCandidate: async (c) => {
      queued.push(c);
      if (pc.remoteDescription) await drain();
    },
    close: () => peer.close(),
  };
}

/** Host side, trickle: the offer is available immediately; candidates follow. */
export async function hostOfferTrickle(): Promise<Trickle & { accept(answer: string): Promise<void> }> {
  const pc = new RTCPeerConnection(RTC_CONFIG);
  const { peer, bind } = makePeer(pc);
  bind(pc.createDataChannel("ascend", { ordered: true }));
  await pc.setLocalDescription(await pc.createOffer());
  const { flush, ...t } = makeTrickle(pc, peer);
  return {
    ...t,
    sdp: encode(pc.localDescription),
    accept: async (answer) => {
      await pc.setRemoteDescription(decode(answer));
      await flush(); // candidates that raced ahead of the answer can now be attached
    },
  };
}

/** Guest side, trickle: consume the host's bare offer, answer immediately, then stream candidates. */
export async function guestAnswerTrickle(offer: string): Promise<Trickle> {
  const pc = new RTCPeerConnection(RTC_CONFIG);
  const { peer, bind } = makePeer(pc);
  pc.ondatachannel = (e) => bind(e.channel);
  await pc.setRemoteDescription(decode(offer));
  await pc.setLocalDescription(await pc.createAnswer());
  const { flush: _flush, ...t } = makeTrickle(pc, peer); // remote description is already set
  void _flush;
  return { ...t, sdp: encode(pc.localDescription) };
}
