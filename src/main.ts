import { Game } from "./game";

const screen = document.getElementById("screen");
const logEl = document.getElementById("log");
if (screen && logEl) {
  const game = new Game(screen, logEl);

  const connect = document.getElementById("connect") as HTMLButtonElement | null;
  const deposit = document.getElementById("deposit") as HTMLButtonElement | null;
  const wstatus = document.getElementById("wstatus");
  if (connect) connect.onclick = () => { void game.connect(); };
  if (deposit) deposit.onclick = () => { void game.deposit(20); };
  game.onWallet = (addr, pas) => {
    if (wstatus) wstatus.textContent = `${addr.slice(0, 6)}…${addr.slice(-4)} · purse ${pas} PAS`;
    if (connect) connect.textContent = "Wallet ✓";
  };
} else {
  document.body.textContent = "Ascend failed to find its mount points.";
}
