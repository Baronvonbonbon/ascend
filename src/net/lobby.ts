// Co-op lobby: serverless WebRTC matchmaking via paste-based signalling, plus a
// channel self-test (hello + ping/pong) so both sides can confirm the peer link
// before the authoritative game sync is wired on top.

import { hostOffer, guestAnswer, Peer } from "./peer";
import type { Game } from "../game";

export type CoopMode = "solo" | "coop" | "coop-ff" | "race";

export function initLobby(game: Game): void {
  const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T | null;
  const lobby = $("lobby");
  const status = $("lobby-status");
  const modeSel = $<HTMLSelectElement>("lobby-mode");
  const hostPane = $("lobby-host-pane");
  const joinPane = $("lobby-join-pane");
  if (!lobby || !modeSel) return;

  const say = (m: string) => { if (status) status.textContent = m; };
  const mode = (): CoopMode => (modeSel.value as CoopMode) || "coop";

  const connected = (peer: Peer, role: "host" | "guest", m: CoopMode) => {
    lobby.hidden = true;
    if (role === "host") game.startCoopHost(peer, m);
    else game.startCoopGuest(peer);
  };

  // ── Host flow ──
  $<HTMLButtonElement>("lobby-host")?.addEventListener("click", async () => {
    if (hostPane) hostPane.hidden = false;
    if (joinPane) joinPane.hidden = true;
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
  $<HTMLButtonElement>("lobby-join")?.addEventListener("click", () => {
    if (joinPane) joinPane.hidden = false;
    if (hostPane) hostPane.hidden = true;
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
}
