import { Game } from "./game";
import { initLobby } from "./net/lobby";

const screen = document.getElementById("screen");
const logEl = document.getElementById("log");
if (screen && logEl) {
  const game = new Game(screen, logEl);
  initLobby(game); // co-op (P2P) lobby — Stage 1: connection + channel self-test

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
} else {
  document.body.textContent = "Ascend failed to find its mount points.";
}
