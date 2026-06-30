import { Game } from "./game";
import { initLobby } from "./net/lobby";
import { ARCHETYPES, archetypeName } from "./data";

const screen = document.getElementById("screen");
const logEl = document.getElementById("log");
if (screen && logEl) {
  const game = new Game(screen, logEl);
  initLobby(game); // co-op (P2P) lobby — Stage 1: connection + channel self-test

  const archetype = document.getElementById("archetype") as HTMLSelectElement | null;
  if (archetype) {
    // Relabel the class options to the active flavor's names (fantasy by default — Knight/Cleric/…).
    for (const opt of Array.from(archetype.options)) {
      const a = ARCHETYPES.find((x) => x.id === opt.value);
      if (a && opt.textContent) opt.textContent = archetypeName(a) + opt.textContent.slice(a.name.length);
    }
    game.archetypeId = archetype.value;
    archetype.onchange = () => { game.archetypeId = archetype.value; };
  }

  const connect = document.getElementById("connect") as HTMLButtonElement | null;
  const wstatus = document.getElementById("wstatus");
  if (connect) connect.onclick = () => { void game.connect(); };
  game.onWallet = (addr, pas) => {
    if (wstatus) wstatus.textContent = `${addr.slice(0, 6)}…${addr.slice(-4)} · ${pas.toFixed(1)} PAS`;
    if (connect) connect.textContent = "Wallet ✓";
  };

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
