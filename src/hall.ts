// A local Hall of Fame — past runs kept in the browser (no server, no chain). Seeds the bones
// (graves of the fallen that surface in later dungeons) and the splash's roll of past adventurers.

export interface RunEntry { name: string; depth: number; won: boolean; }

const KEY = "ascend.hall";
const MAX = 200;

/** The most recent runs, newest first (capped at `n`). Empty if none / storage blocked. */
export function readRecent(n = 12): RunEntry[] {
  try {
    const a = JSON.parse(localStorage.getItem(KEY) ?? "[]") as RunEntry[];
    return Array.isArray(a) ? a.slice(-n).reverse() : [];
  } catch { return []; }
}

/** Append a finished run to the local roll (kept to the last MAX). */
export function recordRun(name: string, depth: number, won: boolean): void {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    const a: RunEntry[] = Array.isArray(raw) ? raw : [];
    a.push({ name, depth, won });
    localStorage.setItem(KEY, JSON.stringify(a.slice(-MAX)));
  } catch { /* storage blocked — the roll just stays as it was */ }
}
