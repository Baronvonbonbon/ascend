import { Game } from "./game";

const screen = document.getElementById("screen");
const logEl = document.getElementById("log");
if (screen && logEl) {
  new Game(screen, logEl);
} else {
  document.body.textContent = "Ascend failed to find its mount points.";
}
