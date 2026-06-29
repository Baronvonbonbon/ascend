// Scrolling message log (DOM).

import { skin } from "./flavor";
import type { Player } from "./entities";

type Kind = "" | "good" | "bad" | "sys" | "dim";

/** Who a log line is for. Omitted = the acting player; "both" = a shared/world line; a Player = that one. */
export type LogWho = "both" | Player;

export class Log {
  private el: HTMLElement;
  /** Co-op hook: the host mirrors a guest-bound log line to the guest. */
  onAdd: ((text: string, kind: Kind) => void) | null = null;
  /** Host co-op router: resolve a line's audience (who paints it / who it streams to). Null = solo/guest. */
  audience: ((who: LogWho | undefined) => { host: boolean; guest: boolean }) | null = null;

  constructor(el: HTMLElement) {
    this.el = el;
  }

  add(text: string, kind: Kind = "", who?: LogWho) {
    if (this.audience) {
      const a = this.audience(who); // host-authoritative co-op: route per adventurer
      if (a.host) this.paint(text, kind);
      if (a.guest) this.onAdd?.(text, kind);
      return;
    }
    this.paint(text, kind);
    this.onAdd?.(text, kind);
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
