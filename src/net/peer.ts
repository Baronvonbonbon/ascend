// True peer-to-peer transport for Ascend co-op, over a WebRTC data channel.
//
// One peer HOSTS (runs the authoritative simulation), the other JOINS (a thin
// terminal). Signalling is serverless and paste-based: the host shares an offer
// code, the guest returns an answer code. A public STUN server is used only for
// NAT discovery — all game traffic flows directly browser-to-browser.

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
    onState: (cb) => stateCbs.push(cb),
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
