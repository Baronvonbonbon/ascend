import { Game } from "./game";
import { initLobby } from "./net/lobby";
import { loadCounts } from "./net/counter";
import { readSave } from "./save";
import { ARCHETYPES, archetypeName, archetypeBlurb, RACES, raceName, raceBlurb, introStory } from "./data";
import { setFlavor, fp } from "./flavor";

const screen = document.getElementById("screen");
const logEl = document.getElementById("log");
if (screen && logEl) {
  const game = new Game(screen, logEl);
  initLobby(game); // co-op (P2P) lobby — Stage 1: connection + channel self-test

  const archetype = document.getElementById("archetype") as HTMLSelectElement | null;
  const race = document.getElementById("race") as HTMLSelectElement | null;
  // Class/Ecosystem option labels are flavor-aware, so we can rebuild them when names toggle
  // (keeping the current pick). onchange keeps the game's selected ids in sync.
  const fillSelects = () => {
    if (archetype) {
      const keep = game.archetypeId || archetype.value;
      archetype.innerHTML = "";
      for (const a of ARCHETYPES) {
        const opt = document.createElement("option");
        opt.value = a.id; opt.textContent = `${archetypeName(a)} — ${archetypeBlurb(a)}`;
        archetype.appendChild(opt);
      }
      if (keep) archetype.value = keep;
      game.archetypeId = archetype.value;
      archetype.onchange = () => { game.archetypeId = archetype.value; };
    }
    if (race) {
      const keep = game.raceId || race.value;
      race.innerHTML = "";
      for (const r of RACES) {
        const opt = document.createElement("option");
        opt.value = r.id; opt.textContent = `${raceName(r)} — ${raceBlurb(r)}`;
        race.appendChild(opt);
      }
      if (keep) race.value = keep;
      game.raceId = race.value;
      race.onchange = () => { game.raceId = race.value; };
    }
  };
  fillSelects();

  // ── start splash: banner subtitle, auto-scrolling story, mode/flavor, Begin Descent ──
  const subtitle = document.getElementById("splash-subtitle");
  const titleSub = document.getElementById("title-sub");
  const storyInner = document.getElementById("splash-story-inner");
  const beginBtn = document.getElementById("begin-btn") as HTMLButtonElement | null;
  const coopSetup = document.getElementById("coop-setup");
  let storyTimers: number[] = [];

  const renderSubtitle = () => {
    const s = fp("— a descent to reclaim the Amulet —", "— a descent to recover the JAM —");
    if (subtitle) subtitle.textContent = s;
    if (titleSub) titleSub.textContent = fp("— reclaim the Amulet of Yendor", "— descend to recover the JAM");
  };

  // Reveal the intro line-by-line with a gentle fade + upward drift. `instant` shows it all at
  // once (used when returning to the menu after death — no re-watching the whole crawl).
  const playStory = (instant = false) => {
    if (!storyInner) return;
    storyTimers.forEach(clearTimeout); storyTimers = [];
    storyInner.innerHTML = "";
    const lines = introStory();
    lines.forEach((text, i) => {
      const div = document.createElement("div");
      div.className = "story-line" + (text === "" ? " blank" : "");
      div.textContent = text;
      storyInner.appendChild(div);
      if (instant) { div.classList.add("show"); return; }
      storyTimers.push(window.setTimeout(() => {
        div.classList.add("show");
        // Once the crawl outgrows the masked window, drift the block upward to keep the newest line in view.
        storyInner.style.transform = `translateY(-${Math.max(0, i - 7) * 22}px)`;
      }, 500 + i * 850));
    });
    if (instant) storyInner.style.transform = "translateY(0)";
  };

  // Mode radios: Solo shows the Begin button; Co-op reveals the P2P lobby (its connect starts the run).
  const syncMode = () => {
    const coop = (document.querySelector('input[name="mode"]:checked') as HTMLInputElement | null)?.value === "coop";
    if (coopSetup) coopSetup.hidden = !coop;
    if (beginBtn) beginBtn.hidden = coop;
  };
  document.querySelectorAll('input[name="mode"]').forEach((el) => el.addEventListener("change", syncMode));

  // Name-flavor radios: reflavor the world before the run (banner, story, class/eco labels).
  const syncFlavor = () => {
    const f = (document.querySelector('input[name="flavor"]:checked') as HTMLInputElement | null)?.value;
    setFlavor(f === "polkadot" ? "polkadot" : "fantasy");
    renderSubtitle(); fillSelects(); playStory(true);
  };
  document.querySelectorAll('input[name="flavor"]').forEach((el) => el.addEventListener("change", syncFlavor));

  // Begin Descent (solo): lock in the picks and drop into the dungeon. newGame() hides the splash.
  beginBtn?.addEventListener("click", () => {
    if (archetype) game.archetypeId = archetype.value;
    if (race) game.raceId = race.value;
    game.newGame();
  });

  // Continue: if a suspended run exists, offer to resume it (restores exactly where you left off).
  const continueBtn = document.getElementById("continue-btn") as HTMLButtonElement | null;
  void readSave().then((save) => {
    if (!save || !continueBtn) return;
    const meta = save.meta as { player?: { fields?: { depth?: number } }; coop?: boolean } | undefined;
    const depth = (save.player as { fields?: { depth?: number } } | undefined)?.fields?.depth;
    continueBtn.textContent = `Continue your descent${depth ? ` — depth ${depth}` : ""} ▸`;
    continueBtn.hidden = false;
    if (meta?.coop) continueBtn.title = "This was a co-op run — resuming solo restores your own adventurer.";
    continueBtn.addEventListener("click", async () => {
      // A co-op run resumes over a fresh peer link: stash the snapshot, flip to Co-op mode so the
      // lobby shows, and let one player Host (ships the saved run) and the other Join.
      if (meta?.coop) {
        game.pendingResume = save;
        const coopRadio = document.querySelector('input[name="mode"][value="coop"]') as HTMLInputElement | null;
        if (coopRadio) { coopRadio.checked = true; syncMode(); }
        continueBtn.hidden = true;
        const status = document.getElementById("lobby-status");
        if (status) status.textContent = "Resuming — one of you Hosts (restores the run), the other Joins.";
        return;
      }
      continueBtn.disabled = true; continueBtn.textContent = "Restoring…";
      const ok = await game.resumeSave();
      if (!ok) { continueBtn.textContent = "Save was unreadable — start fresh"; continueBtn.disabled = false; }
    });
  });

  // Returning from a death (solo): re-arm the menu with the story already shown.
  document.addEventListener("ascend:menu", () => { syncMode(); playStory(true); });

  renderSubtitle();
  syncMode();
  playStory();

  // Wallet connect + on-chain (PAS) payments are deferred — to be reintroduced in a later update.

  // On-screen touch controls: each button carries a data-key; tapping it drives the
  // game through the very same keyboard path (synthetic keydown on window).
  const touch = document.getElementById("touch");
  if (touch) {
    const fire = (key: string) => window.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
    touch.addEventListener("click", (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLElement>("[data-key]");
      if (!btn) return;
      e.preventDefault();
      fire(btn.dataset.key!);
    });
    // A "⌨" toggle reveals the letter strip + verb deck for inventory selections.
    const more = document.getElementById("touch-more");
    const deck = document.getElementById("touch-deck");
    if (more && deck) more.addEventListener("click", () => deck.classList.toggle("open"));
  }

  // ── controls / how-to-play modal (desktop button + mobile deck button) ──
  const modal = document.getElementById("controls-modal");
  if (modal) {
    const open = () => modal.classList.add("open");
    const close = () => modal.classList.remove("open");
    document.getElementById("help-btn")?.addEventListener("click", open);
    document.getElementById("touch-help")?.addEventListener("click", open);
    document.getElementById("controls-close")?.addEventListener("click", close);
    modal.addEventListener("click", (e) => { if (e.target === modal) close(); }); // click the backdrop to dismiss
    // Swallow Escape (and keep game keys out) while the modal is up.
    window.addEventListener("keydown", (e) => {
      if (!modal.classList.contains("open")) return;
      if (e.key === "Escape") close();
      e.stopPropagation();
    }, true);
  }

  // ── perpetual global tally (runs braved / fallen) — best-effort, fails silent ──
  void loadCounts();

  // ── co-op chat bar: type + Send (PC keyboard or mobile touch keyboard) ──
  const chatInput = document.getElementById("chat-input") as HTMLInputElement | null;
  const chatSend = document.getElementById("chat-send") as HTMLButtonElement | null;
  const chatPower = document.getElementById("chat-power") as HTMLSelectElement | null;
  if (chatInput && chatSend) {
    const send = () => { const v = chatInput.value; chatInput.value = ""; if (v.trim()) game.submitChat(v, (chatPower?.value as "whisper" | "say" | "shout") ?? "say"); chatInput.blur(); };
    chatSend.addEventListener("click", send);
    chatInput.addEventListener("keydown", (e) => {
      e.stopPropagation(); // keep chat typing out of the game's keyboard handler
      if (e.key === "Enter") { e.preventDefault(); send(); }
      else if (e.key === "Escape") { chatInput.value = ""; chatInput.blur(); }
    });
  }

  // ── audio: master toggle + soundtrack picker (procedural Web Audio) ──
  const musicBtn = document.getElementById("music-toggle") as HTMLButtonElement | null;
  const musicPick = document.getElementById("music-pick") as HTMLSelectElement | null;
  if (musicPick) {
    for (const t of game.music.trackList) {
      const o = document.createElement("option"); o.value = t.id; o.textContent = t.name; musicPick.appendChild(o);
    }
    musicPick.value = game.music.mode;
    musicPick.onchange = () => { game.music.resume(); game.music.setMode(musicPick.value); };
  }
  if (musicBtn) {
    const sync = () => { musicBtn.textContent = `♪ Music: ${game.music.enabled ? "on" : "off"}`; musicBtn.classList.toggle("on", game.music.enabled); };
    musicBtn.onclick = () => { game.music.toggle(); sync(); };
    sync();
  }
  // The Web Audio context needs a user gesture; resume (and honour a saved "on") on first interaction.
  const kick = () => {
    game.music.resume();
    if (game.music.enabled) game.music.setEnabled(true);
    window.removeEventListener("pointerdown", kick);
    window.removeEventListener("keydown", kick);
  };
  window.addEventListener("pointerdown", kick);
  window.addEventListener("keydown", kick);
} else {
  document.body.textContent = "Ascend failed to find its mount points.";
}
