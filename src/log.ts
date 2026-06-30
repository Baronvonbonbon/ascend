// Scrolling message log (DOM).

import { skin } from "./flavor";
import type { Player } from "./entities";

type Kind = "" | "good" | "bad" | "sys" | "dim";

/** Who a log line is for. Omitted = the acting player; "both" = a shared/world line; a Player = that one. */
export type LogWho = "both" | Player;

export class Log {
  private el: HTMLElement;
  /** Co-op filter: paint a line iff THIS client's local adventurer should see it. Null = solo (paint all).
   *  Both clients run the same sim, so each just keeps the lines its own player is the audience for. */
  audience: ((who: LogWho | undefined) => boolean) | null = null;

  constructor(el: HTMLElement) {
    this.el = el;
  }

  add(text: string, kind: Kind = "", who?: LogWho) {
    if (!this.audience || this.audience(who)) this.paint(text, kind);
  }

  /** Append a line without re-broadcasting it (used when rendering a remote log line). */
  paint(text: string, kind: Kind = "") {
    const div = document.createElement("div");
    if (kind) div.className = `msg--${kind}`;
    div.textContent = skin(text); // apply the fantasy proper-noun skin at render (no-op in polkadot mode)
    this.el.appendChild(div);
    this.el.scrollTop = this.el.scrollHeight;
    // Trim old lines to keep the DOM light.
    while (this.el.childElementCount > 200) this.el.removeChild(this.el.firstChild!);
  }
}
