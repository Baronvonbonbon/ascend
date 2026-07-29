// Co-op lobby: serverless WebRTC matchmaking via paste-based signalling, plus a
// channel self-test (hello + ping/pong) so both sides can confirm the peer link
// before the authoritative game sync is wired on top.

import { hostOffer, guestAnswer, Peer } from "./peer";
import type { Game } from "../game";

export type CoopMode = "solo" | "coop-ff";

export function initLobby(game: Game): void {
  const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T | null;
  const lobby = $("lobby");
  const status = $("lobby-status");
  const hostPane = $("lobby-host-pane");
  const joinPane = $("lobby-join-pane");
  if (!lobby) return;

  const say = (m: string) => { if (status) status.textContent = m; };
  const mode = (): CoopMode => "coop-ff"; // the only co-op mode: friendly-fire (slip past on bump; harm by choice)

  const connected = (peer: Peer, role: "host" | "guest", m: CoopMode) => {
    lobby.hidden = true;
    if (role === "host") game.startCoopHost(peer, m);
    else game.startCoopGuest(peer);
  };

  const hostBtn = $<HTMLButtonElement>("lobby-host");
  const joinBtn = $<HTMLButtonElement>("lobby-join");

  // ── Host flow ──
  hostBtn?.addEventListener("click", async () => {
    if (hostPane) hostPane.hidden = false;
    if (joinPane) joinPane.hidden = true;
    if (joinBtn) joinBtn.hidden = true; // a host only sees host controls
    say("Creating offer…");
    try {
      const m = mode();
      const { peer, code, accept } = await hostOffer();
      const offer = $<HTMLTextAreaElement>("lobby-offer");
      if (offer) offer.value = code;
      say("Share the offer code, paste your partner's answer, then Connect.");
      peer.onState((open) => { if (open) connected(peer, "host", m); });
      $<HTMLButtonElement>("lobby-connect")?.addEventListener("click", async () => {
        const ans = $<HTMLTextAreaElement>("lobby-answer-in")?.value ?? "";
        if (!ans.trim()) { say("Paste your partner's answer code first."); return; }
        say("Connecting…");
        try { await accept(ans); } catch { say("That answer code didn't parse. Try again."); }
      }, { once: false });
    } catch (e) {
      say(`Could not create offer: ${e instanceof Error ? e.message : "?"}`);
    }
  });

  // ── Join flow ──
  joinBtn?.addEventListener("click", () => {
    if (joinPane) joinPane.hidden = false;
    if (hostPane) hostPane.hidden = true;
    if (hostBtn) hostBtn.hidden = true;       // a joiner only sees join controls
    say("Paste the host's offer code, then Generate answer.");
  });

  $<HTMLButtonElement>("lobby-gen-answer")?.addEventListener("click", async () => {
    const offerIn = $<HTMLTextAreaElement>("lobby-offer-in")?.value ?? "";
    if (!offerIn.trim()) { say("Paste the host's offer code first."); return; }
    say("Generating answer…");
    try {
      const m = mode();
      const { peer, code } = await guestAnswer(offerIn);
      const ans = $<HTMLTextAreaElement>("lobby-answer");
      if (ans) ans.value = code;
      say("Send this answer code back to the host. Linking…");
      peer.onState((open) => { if (open) connected(peer, "guest", m); });
    } catch (e) {
      say(`Could not generate answer: ${e instanceof Error ? e.message : "?"}`);
    }
  });

  // Copy helpers
  const copy = (fromId: string) => {
    const el = $<HTMLTextAreaElement>(fromId);
    if (el) { el.select(); navigator.clipboard?.writeText(el.value).then(() => say("Copied to clipboard.")); }
  };
  $("lobby-copy-offer")?.addEventListener("click", () => copy("lobby-offer"));
  $("lobby-copy-answer")?.addEventListener("click", () => copy("lobby-answer"));

  // ── 1-click invites over the chain ──
  // Strictly an alternative to the paste flow above, which stays for anyone without coffers.
  // Only the WebRTC handshake goes through the chain; the game itself never does.
  void initChainInvites(game, connected, say);
}

/**
 * Wire the invite pane to whichever addressed transport is available — the statement store inside
 * the Polkadot app, the invite contract elsewhere. The paste panes above stay on screen regardless,
 * because neither transport reaches a player with no wallet at all.
 */
async function initChainInvites(
  game: Game,
  connected: (p: Peer, role: "host" | "guest", m: CoopMode) => void,
  say: (m: string) => void,
): Promise<void> {
  const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T | null;
  const pane = $("lobby-chain");
  const list = $("lobby-invites");
  const note = $("lobby-chain-note");
  const to = $<HTMLInputElement>("lobby-invite-to");
  const send = $<HTMLButtonElement>("lobby-invite-send");
  if (!pane || !list) return;

  const { pickSignal } = await import("./signal");
  const chain = await import("../chain");

  let signal: Awaited<ReturnType<typeof pickSignal>> = null;
  let timer: number | undefined;

  const describe = () => {
    if (!note || !signal) return;
    note.textContent = signal.mailbox
      ? "🔐 Sealed to the recipient — the chain stores only ciphertext. An invitation waits about an hour, so they need not be online yet. Your address and the fact you invited someone are public."
      : "🔐 Sent over the People chain statement store, exactly as the Polkadot app signals its own calls. Statements never enter block storage and expire in seconds, so nothing is recorded — but your partner must have this lobby open right now.";
  };

  const refresh = async () => {
    if (!signal || pane.hidden) return;
    render(await signal.inbox());
  };

  // Never hide this pane without saying why. It used to vanish silently whenever anything was
  // not ready, which made "the invite option isn't there" impossible to diagnose from the outside.
  const state = (msg: string, working = false) => {
    const el = $("lobby-chain-state");
    if (el) { el.textContent = msg; el.classList.toggle("working", working); }
  };

  const setup = async () => {
    signal?.stop();
    const st = chain.chainStatus();
    pane.hidden = false;

    if (!st.connected) { state("Connect your coffers in the ⚙ panel to invite by address."); signal = null; return; }
    if (!st.contracts) { state("No invite rune is deployed on this build — use the codes below."); signal = null; return; }
    if (!st.canSign)   { state("This connection is read-only. Reconnect with a wallet that can sign."); signal = null; return; }

    state("Preparing…", true);
    signal = await pickSignal();
    if (!signal) { state("Could not reach the invite rune — use the codes below."); return; }

    describe();
    state("Ready — invite by address, or wait for one to arrive.");
    // Being INVITED needs our sealing key on chain; sending does not. Report it without blocking.
    void signal.ready?.then((ok) => {
      state(ok
        ? "Ready — invite by address, or wait for one to arrive."
        : "You can send invites, but until you approve the one-off key signature, others cannot invite you.");
    });

    void refresh();
    if (timer) clearInterval(timer);
    // The statement transport is push-driven and keeps its own list; polling just repaints it.
    timer = window.setInterval(() => void refresh(), signal.mailbox ? 15_000 : 2_000);
  };
  chain.onChainStatus(() => { void setup(); });
  await setup();

  // Every refusal has a different fix, so never collapse them into "something went wrong".
  const explain = (r: string, who: string) => ({
    "no-wallet": "Connect your coffers first (the ⚙ panel).",
    "no-recipient-key": `${who} has not opened Ascend with coffers connected yet, so there is no key to seal the invitation to. Ask them to do that once — or use the offer/answer codes below instead.`,
    "no-crypto": "This browser cannot seal the invitation, so it will not be sent. Use the offer/answer codes below.",
    "offline": `${who} does not have the lobby open. This rail only reaches someone who is here right now — use the codes below instead.`,
    "failed": "The invitation was not sent.",
  } as Record<string, string>)[r] ?? "The invitation was not sent.";

  // ── outgoing ──
  send?.addEventListener("click", async () => {
    const addr = await chain.normalizeChainAddress(to?.value ?? "");
    if (!addr) { say("That is not an address."); return; }
    if (!signal) { say("No invite rail is available — see the note above."); return; }
    send.disabled = true;
    say("Sealing an invitation…");
    try {
      const res = await signal.invite(addr, (peer) => connected(peer, "host", "coop-ff"));
      if (res !== "sent") { say(explain(res, `${addr.slice(0, 6)}…${addr.slice(-4)}`)); send.disabled = false; return; }
      say(signal.mailbox ? "Invitation sent — waiting for them to accept…" : "Ringing — waiting for them to accept…");
    } catch (e) {
      say(`Could not send: ${e instanceof Error ? e.message : "?"}`);
      send.disabled = false;
    }
  });

  // ── incoming ──
  function render(invites: { from: string; at: number; offer: string }[]) {
    if (!list) return;
    list.textContent = "";
    for (const inv of invites) {
      const row = document.createElement("div");
      row.className = "invite";
      const who = document.createElement("span");
      who.className = "invite-who";
      who.textContent = `${inv.from.slice(0, 6)}…${inv.from.slice(-4)} invites you to descend`;
      const ok = document.createElement("button");
      ok.type = "button"; ok.textContent = "Accept";
      const no = document.createElement("button");
      no.type = "button"; no.textContent = "Decline";
      ok.addEventListener("click", async () => {
        ok.disabled = no.disabled = true;
        say("Accepting…");
        try {
          const res = await signal!.accept(inv, (peer) => connected(peer, "guest", "coop-ff"));
          if (res === "sent") say("Accepted — linking…");
          else { say(explain(res, "They")); ok.disabled = no.disabled = false; }
        } catch {
          say("That invitation did not parse.");
          ok.disabled = no.disabled = false;
        }
      });
      no.addEventListener("click", async () => { no.disabled = true; await signal!.decline(inv); void refresh(); });
      row.append(who, ok, no);
      list.appendChild(row);
    }
  }

  void game; // the game only enters the picture once a peer link is open
}
