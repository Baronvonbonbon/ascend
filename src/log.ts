// Scrolling message log (DOM).

type Kind = "" | "good" | "bad" | "sys" | "dim";

export class Log {
  private el: HTMLElement;
  /** Co-op hook: the host mirrors every log line to the guest. */
  onAdd: ((text: string, kind: Kind) => void) | null = null;

  constructor(el: HTMLElement) {
    this.el = el;
  }

  add(text: string, kind: Kind = "") {
    this.paint(text, kind);
    this.onAdd?.(text, kind);
  }

  /** Append a line without re-broadcasting it (used when rendering a remote log line). */
  paint(text: string, kind: Kind = "") {
    const div = document.createElement("div");
    if (kind) div.className = `msg--${kind}`;
    div.textContent = text;
    this.el.appendChild(div);
    this.el.scrollTop = this.el.scrollHeight;
    // Trim old lines to keep the DOM light.
    while (this.el.childElementCount > 200) this.el.removeChild(this.el.firstChild!);
  }
}
