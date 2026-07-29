// Self-rendered <select> popups.
//
// The native popup is the one piece of a <select> the page does not control: it is drawn by the
// browser (or, inside the Polkadot app, by an embedded web view) and there are environments where
// it simply never appears. When that happens the menu looks alive — it shows the current value,
// it focuses, it highlights — and picking a class or a soundtrack is impossible.
//
// So the popup is drawn here instead. The <select> itself stays exactly where it was, styled by
// exactly the same CSS, and remains the single source of truth: options are read from it, the
// choice is written back to it, and a normal bubbling `change` fires. Every existing caller
// (fillSelects, musicPick.onchange, the chat power picker, opt-chain-kind) keeps working untouched,
// and nothing here needs to know what any of them mean.

let open: { sel: HTMLSelectElement; pop: HTMLElement } | null = null;

function closePop(): void {
  if (!open) return;
  open.pop.remove();
  open.sel.removeAttribute("aria-expanded");
  open = null;
}

/** Place the popup against the select, flipping above it when the space below is too tight. */
function position(sel: HTMLSelectElement, pop: HTMLElement): void {
  const r = sel.getBoundingClientRect();
  const margin = 6;
  pop.style.minWidth = `${Math.round(r.width)}px`;
  pop.style.left = "0px";
  pop.style.top = "0px";
  // Measure once placed, then clamp — the popup is as wide as its longest option, which for the
  // class/ecosystem blurbs can be far wider than the select itself.
  const p = pop.getBoundingClientRect();
  const left = Math.max(margin, Math.min(r.left, window.innerWidth - p.width - margin));
  const below = window.innerHeight - r.bottom;
  const top = below >= p.height + margin || below >= r.top ? r.bottom + 2 : Math.max(margin, r.top - p.height - 2);
  pop.style.left = `${Math.round(left)}px`;
  pop.style.top = `${Math.round(top)}px`;
}

function openPop(sel: HTMLSelectElement): void {
  if (open?.sel === sel) { closePop(); return; }
  closePop();
  if (sel.disabled || !sel.options.length) return;

  const pop = document.createElement("div");
  pop.className = "dd-pop";
  pop.setAttribute("role", "listbox");

  Array.from(sel.options).forEach((opt, i) => {
    const row = document.createElement("div");
    row.className = "dd-opt" + (i === sel.selectedIndex ? " on" : "");
    row.setAttribute("role", "option");
    row.setAttribute("aria-selected", String(i === sel.selectedIndex));
    row.textContent = opt.textContent ?? opt.value;
    if (opt.disabled) row.classList.add("off");
    else row.addEventListener("click", () => {
      sel.selectedIndex = i;
      closePop();
      // Bubbling + composed, so `onchange` handlers and delegated listeners both see it.
      sel.dispatchEvent(new Event("change", { bubbles: true }));
    });
    pop.appendChild(row);
  });

  document.body.appendChild(pop);
  position(sel, pop);
  sel.setAttribute("aria-expanded", "true");
  open = { sel, pop };
  pop.querySelector<HTMLElement>(".dd-opt.on")?.scrollIntoView({ block: "nearest" });
}

/**
 * Take over one select's popup. Idempotent — enhancing twice is a no-op, so it is safe to call
 * again after options are rebuilt (the popup reads them fresh on every open anyway).
 */
export function enhanceSelect(sel: HTMLSelectElement): void {
  if (sel.dataset.dd === "1") return;
  sel.dataset.dd = "1";

  // EXACTLY ONE of these events may toggle. A single real click fires `pointerdown` AND `mousedown`
  // (and on a touch screen `touchstart` as well), so wiring the toggle to all of them opened the
  // popup and then immediately closed it again — the control looked completely dead. `pointerdown`
  // is the opener because it covers mouse, touch and pen in every browser we target; the others
  // exist only to suppress the native popup, which is what preventDefault on the press does.
  sel.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    e.stopPropagation();
    sel.focus();
    openPop(sel);
  });
  const suppress = (e: Event) => e.preventDefault();
  sel.addEventListener("mousedown", suppress);
  sel.addEventListener("touchstart", suppress, { passive: false });
  sel.addEventListener("click", suppress);

  // Keyboard: the select still owns arrow keys (they move the value natively, which is fine and
  // needs no popup). Enter/Space open the list, Escape closes it.
  sel.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openPop(sel); }
    else if (e.key === "Escape" && open?.sel === sel) { e.preventDefault(); closePop(); }
  });
  // No `blur` handler. Focusing the popup — or just tapping it — blurs the select, and tearing the
  // popup down there detached the row before its own `click` could fire, so picking silently did
  // nothing. Dismissal is handled once, globally, by the outside-press listener in initDropdowns().
}

/** Enhance every select on the page, now and for any added later. */
export function enhanceDropdowns(root: ParentNode = document): void {
  root.querySelectorAll<HTMLSelectElement>("select").forEach(enhanceSelect);
}

let wired = false;
/** One-time global wiring: dismiss on outside click, scroll, resize or Escape. */
export function initDropdowns(): void {
  if (wired) return;
  wired = true;
  enhanceDropdowns();
  document.addEventListener("pointerdown", (e) => {
    if (open && !open.pop.contains(e.target as Node) && e.target !== open.sel) closePop();
  }, true);
  window.addEventListener("keydown", (e) => { if (open && e.key === "Escape") { closePop(); e.stopPropagation(); } }, true);
  window.addEventListener("resize", closePop);
  // Capture phase: the splash and the options modal are their own scroll containers.
  window.addEventListener("scroll", closePop, true);
  // Selects that appear later (none today, but the lobby builds rows dynamically) get picked up.
  new MutationObserver(() => enhanceDropdowns()).observe(document.body, { childList: true, subtree: true });
}
