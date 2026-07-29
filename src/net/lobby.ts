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

/** Wire the invite pane, if the player has coffers connected and the invite rune is deployed. */
async function initChainInvites(
  game: Game,
  connected: (p: Peer, role: "host" | "guest", m: CoopMode) => void,
  say: (m: string) => void,
): Promise<void> {
  const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T | null;
  const pane = $("lobby-chain");
  const list = $("lobby-invites");
  const to = $<HTMLInputElement>("lobby-invite-to");
  const send = $<HTMLButtonElement>("lobby-invite-send");
  if (!pane || !list) return;

  const chain = await import("../chain");

  // Publishing our sealing key is what lets anyone invite us. It costs one transaction, once,
  // and is a no-op afterwards — see src/chain/crypto.ts for why invites are sealed at all.
  let keyReady = false;
  const show = async () => {
    const on = await chain.invitesReady();
    pane.hidden = !on;
    if (on && !keyReady) {
      keyReady = await chain.publishInviteKey();
      if (!keyReady) say("Could not publish your invite key — others will not be able to invite you yet.");
    }
  };
  chain.onChainStatus(() => { void show(); });
  await show();

  // Every refusal has a different fix, so never collapse them into "something went wrong".
  const explain = (r: string, who: string) => ({
    "no-wallet": "Connect your coffers first (the ⚙ panel).",
    "no-recipient-key": `${who} has not opened Ascend with coffers connected yet, so there is no key to seal the invitation to. Ask them to do that once — or use the offer/answer codes below instead.`,
    "no-crypto": "This browser cannot seal the invitation, so it will not be sent. Use the offer/answer codes below.",
    "failed": "The invitation was not sent.",
  } as Record<string, string>)[r] ?? "The invitation was not sent.";

  // ── outgoing: create an offer, publish it, then watch for their answer ──
  send?.addEventListener("click", async () => {
    const addr = await chain.normalizeChainAddress(to?.value ?? "");
    if (!addr) { say("That is not an address."); return; }
    send.disabled = true;
    say("Sealing an invitation…");
    try {
      const { peer, code, accept } = await hostOffer();
      const res = await chain.sendCoopInvite(addr, code);
      if (res !== "sent") { say(explain(res, `${addr.slice(0, 6)}…${addr.slice(-4)}`)); send.disabled = false; return; }
      say("Invitation sent — waiting for them to accept…");
      peer.onState((open) => { if (open) connected(peer, "host", "coop-ff"); });
      // Poll for the answer. There is no push channel here, and a light client only serves
      // `latest`, so a slow poll is the honest mechanism — it stops the moment the link opens.
      const started = Date.now();
      const tick = async () => {
        if (peer.isOpen()) return;
        if (Date.now() - started > 10 * 60_000) { say("The invitation went unanswered."); send.disabled = false; return; }
        const answer = await chain.pollCoopAnswer(addr);
        if (answer) { say("Accepted — linking…"); try { await accept(answer); } catch { say("Their answer did not parse."); } return; }
        setTimeout(() => void tick(), 6000);
      };
      setTimeout(() => void tick(), 6000);
    } catch (e) {
      say(`Could not send: ${e instanceof Error ? e.message : "?"}`);
      send.disabled = false;
    }
  });

  // ── incoming: show pending invites, accept with one click ──
  const render = (invites: { from: string; at: number; offer: string }[]) => {
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
          const { peer, code } = await guestAnswer(inv.offer);
          peer.onState((open) => { if (open) connected(peer, "guest", "coop-ff"); });
          const res = await chain.acceptCoopInvite(inv.from, code);
          if (res === "sent") say("Accepted — linking…");
          else { say(explain(res, "They")); ok.disabled = no.disabled = false; }
        } catch {
          say("That invitation did not parse.");
          ok.disabled = no.disabled = false;
        }
      });
      no.addEventListener("click", async () => { no.disabled = true; await chain.declineCoopInvite(inv.from); void refresh(); });
      row.append(who, ok, no);
      list.appendChild(row);
    }
  };

  const refresh = async () => { if (!pane.hidden) render(await chain.coopInbox()); };
  void refresh();
  setInterval(() => void refresh(), 15_000); // the lobby is idle; a slow poll is plenty
  void game; // the game only enters the picture once a peer link is open
}
