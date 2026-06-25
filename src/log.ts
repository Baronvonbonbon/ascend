// Scrolling message log (DOM).

type Kind = "" | "good" | "bad" | "sys" | "dim";

export class Log {
  private el: HTMLElement;

  constructor(el: HTMLElement) {
    this.el = el;
  }

  add(text: string, kind: Kind = "") {
    const div = document.createElement("div");
    if (kind) div.className = `msg--${kind}`;
    div.textContent = text;
    this.el.appendChild(div);
    this.el.scrollTop = this.el.scrollHeight;
    // Trim old lines to keep the DOM light.
    while (this.el.childElementCount > 200) this.el.removeChild(this.el.firstChild!);
  }
}
