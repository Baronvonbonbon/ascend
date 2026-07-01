// A perpetual, global tally of runs begun and adventurers fallen across ALL players —
// surfaced on the site. Backed by a free, tokenless hosted counter (abacus), called
// fire-and-forget: every request is wrapped so the game never blocks or breaks if the
// service is slow, down, or blocked by a privacy extension — the display just shows "—".

const BASE = "https://abacus.jasoncameron.dev";
const NS = "ascend-jam-dungeon"; // our namespace on the shared counter service
const KEY_GAMES = "games";
const KEY_DEATHS = "deaths";

let last: { games: number | null; deaths: number | null } = { games: null, deaths: null };

/** One best-effort request (4s cap); returns the counter's new value, or null on any failure. */
async function hit(path: string): Promise<number | null> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 4000);
    const res = await fetch(`${BASE}/${path}`, { signal: ctrl.signal });
    clearTimeout(timer);
    if (!res.ok) return null;
    const body = (await res.json()) as { value?: number };
    return typeof body.value === "number" ? body.value : null;
  } catch {
    return null; // offline / blocked / timed out — never surface an error into the game
  }
}

/** Paint the site's stats line from the latest known values. */
function render(): void {
  const el = document.getElementById("stats");
  if (!el) return;
  const n = (v: number | null) => (v === null ? "—" : v.toLocaleString());
  el.textContent = `⚔ ${n(last.games)} runs braved · ☠ ${n(last.deaths)} fallen in the dungeon`;
}

/** Read both totals (no increment) — call once on load to populate the display. */
export async function loadCounts(): Promise<void> {
  const [g, d] = await Promise.all([hit(`get/${NS}/${KEY_GAMES}`), hit(`get/${NS}/${KEY_DEATHS}`)]);
  if (g !== null) last.games = g;
  if (d !== null) last.deaths = d;
  render();
}

/** A new run has begun — increment the global games tally. */
export async function bumpGames(): Promise<void> {
  const n = await hit(`hit/${NS}/${KEY_GAMES}`);
  if (n !== null) { last.games = n; render(); }
}

/** An adventurer has fallen — increment the global deaths tally. */
export async function bumpDeaths(): Promise<void> {
  const n = await hit(`hit/${NS}/${KEY_DEATHS}`);
  if (n !== null) { last.deaths = n; render(); }
}
