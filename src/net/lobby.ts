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

  // Invites need a signing rail; the table list does not — it is a plain chain read, so it keeps
  // refreshing for a player who has connected nothing at all. Seeing who is looking for a game is
  // how you decide whether connecting is worth it.
  const refresh = async () => {
    if (pane.hidden) return;
    if (signal) render(await signal.inbox());
    renderTables(await chain.openTables());
  };

  // ── the open table: announce that you are looking for a game ──
  // The listing carries only address, self-chosen name and time. Pressing Play on someone else's
  // table sends them an ordinary SEALED invite — no handshake data is ever public.
  const tablesEl = $("lobby-tables");
  const openBtn = $<HTMLButtonElement>("lobby-open-table");
  const openState = $("lobby-open-state");
  let mineOpen = false;

  const syncOpenBtn = () => {
    const canSign = chain.chainStatus().canSign;
    if (openBtn) {
      openBtn.textContent = mineOpen ? "Close my table" : "Open my table";
      openBtn.disabled = !canSign;
      openBtn.title = canSign ? "" : "Connect your coffers to announce a table.";
    }
    if (openState) openState.textContent = mineOpen
      ? "Listed publicly — anyone can see this address is looking for a game. Expires in ~30 min."
      : canSign ? "" : "Connect your coffers to put your own table up.";
  };

  openBtn?.addEventListener("click", async () => {
    if (!openBtn) return;
    openBtn.disabled = true;
    const was = openBtn.textContent;
    openBtn.textContent = mineOpen ? "Closing…" : "Opening…";
    const ok = mineOpen ? await chain.closeMyTable() : await chain.openMyTable();
    if (ok) mineOpen = !mineOpen; else say("That did not go through.");
    openBtn.disabled = false;
    openBtn.textContent = was;
    syncOpenBtn();
    void refresh();
  });

  function renderTables(tables: { host: string; name: string; at: number }[]) {
    if (!tablesEl) return;
    const me = (chain.chainStatus().address ?? "").toLowerCase();
    const others = tables.filter((t) => t.host.toLowerCase() !== me);
    mineOpen = tables.some((t) => t.host.toLowerCase() === me);
    syncOpenBtn();

    tablesEl.textContent = "";
    if (!others.length) {
      const none = document.createElement("p");
      none.className = "lobby-note";
      none.textContent = "No open tables right now. Open yours and someone can join it.";
      tablesEl.appendChild(none);
      return;
    }
    for (const t of others) {
      const row = document.createElement("div");
      row.className = "table-row";
      const name = document.createElement("span");
      name.className = "table-name";
      name.textContent = t.name;
      const addr = document.createElement("span");
      addr.className = "table-addr";
      addr.textContent = `${t.host.slice(0, 6)}…${t.host.slice(-4)}`;
      const ago = document.createElement("span");
      ago.className = "table-addr";
      const mins = Math.max(0, Math.round((Date.now() / 1000 - t.at) / 60));
      ago.textContent = mins < 1 ? "just now" : `${mins}m ago`;
      const play = document.createElement("button");
      play.type = "button"; play.textContent = "Play";
      play.addEventListener("click", async () => {
        // Joining sends a sealed invite, which needs a signer — but the table was browsable
        // without one, so say what is missing instead of leaving a dead button.
        if (!signal) { say("Connect your coffers to join a table — or use the offer/answer codes below."); return; }
        play.disabled = true;
        say(`Inviting ${t.name}…`);
        const res = await signal!.invite(t.host, (peer) => connected(peer, "host", "coop-ff"));
        if (res !== "sent") { say(explain(res, t.name)); play.disabled = false; }
        else say(`Invitation sent to ${t.name} — waiting for them to accept…`);
      });
      row.append(name, addr, ago, play);
      tablesEl.appendChild(row);
    }
  }

  // Never hide this pane without saying why. It used to vanish silently whenever anything was
  // not ready, which made "the invite option isn't there" impossible to diagnose from the outside.
  const state = (msg: string, working = false) => {
    const el = $("lobby-chain-state");
    if (el) { el.textContent = msg; el.classList.toggle("working", working); }
  };

  // Poll on a cadence that matches what we are actually watching: the statement transport is
  // push-driven and only needs repainting, a mailbox needs fetching, and with no signal at all the
  // only live thing on screen is the table list.
  const poll = () => {
    if (timer) clearInterval(timer);
    void refresh();
    timer = window.setInterval(() => void refresh(), !signal ? 20_000 : signal.mailbox ? 15_000 : 2_000);
  };

  const setup = async () => {
    signal?.stop();
    const st = chain.chainStatus();
    pane.hidden = false;

    if (!st.connected)      { signal = null; state("Connect your coffers to invite by address or open a table — the tables below are readable without it."); poll(); return; }
    if (!st.contracts)      { signal = null; state("No invite rune is deployed on this build — use the codes below."); poll(); return; }
    if (!st.canSign)        { signal = null; state("This connection is read-only. Reconnect with a wallet that can sign to join or open a table."); poll(); return; }

    state("Preparing…", true);
    signal = await pickSignal();
    if (!signal) { state("Could not reach the invite rune — use the codes below."); poll(); return; }

    describe();
    state("Ready — invite by address, or wait for one to arrive.");
    // Being INVITED needs our sealing key on chain; sending does not. Report it without blocking.
    void signal.ready?.then((ok) => {
      state(ok
        ? "Ready — invite by address, or wait for one to arrive."
        : "You can send invites, but until you approve the one-off key signature, others cannot invite you.");
    });

    poll();
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
