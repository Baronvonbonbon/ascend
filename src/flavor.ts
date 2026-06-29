// Dual flavor — a classic roguelike FANTASY skin (default) and the POLKADOT skin
// (the original crypto theme), toggled live by the Konami code. Per-session: every
// load starts in fantasy. Names live on the data defs as `name` (polkadot) + `fname`
// (fantasy); loose strings use fp("fantasy", "polkadot"). Resolution is live, so a
// toggle reflavors the whole game without reload.

export type Flavor = "fantasy" | "polkadot";

let _flavor: Flavor = "fantasy"; // the world wears its fantasy face until the code is entered

export function getFlavor(): Flavor { return _flavor; }
export function setFlavor(f: Flavor): void { _flavor = f; }
export function toggleFlavor(): Flavor { _flavor = _flavor === "fantasy" ? "polkadot" : "fantasy"; return _flavor; }

/** Pick the fantasy or polkadot variant of a loose string, live. */
export function fp(fantasy: string, polkadot: string): string { return _flavor === "fantasy" ? fantasy : polkadot; }

/** Resolve a def's display name: its fantasy `fname` in fantasy mode (falling back to
 *  `name` if none authored), else its polkadot `name`. */
export function nameOf(d: { name: string; fname?: string }): string {
  return _flavor === "fantasy" ? (d.fname ?? d.name) : d.name;
}

// The long tail: recurring proper nouns sprinkled through log/HUD text. In fantasy mode a
// final word-boundary pass swaps them; in polkadot mode it's a no-op, so that path is exact.
// (Most other strings already read right because they interpolate the now-flavored names.)
const FANTASY_SUBS: [RegExp, string][] = [
  [/\bthe JAM\b/g, "the Amulet of Yendor"], [/\bThe JAM\b/g, "The Amulet of Yendor"], [/\bJAM\b/g, "Amulet"],
  [/\bGavin\b/g, "Marduk"], // the deity of prayer/altars — a proper name works as both noun and adjective
  [/\bthe relay\b/g, "the dungeon"], [/\bthe Relay\b/g, "the Dungeon"], [/\bRelay\b/g, "Dungeon"],
  [/\bthe Mempool\b/g, "the Great Hall"], [/\bTHE MEMPOOL\b/g, "THE GREAT HALL"], [/\bMempool\b/g, "Great Hall"],
  [/\byour nominator\b/g, "your hound"], [/\bnominator\b/g, "hound"],
  [/\bthe Marketmaker\b/g, "the Shopkeeper"], [/\bMarketmaker\b/g, "Shopkeeper"],
  [/\bthe Censor\b/g, "the Warden"], [/\bTHE CENSOR\b/g, "THE WARDEN"], [/\bCensor\b/g, "Warden"],
];
/** Apply the fantasy proper-noun skin to a finished log/HUD string (no-op in polkadot mode). */
export function skin(s: string): string {
  if (_flavor !== "fantasy") return s;
  let out = s;
  for (const [re, to] of FANTASY_SUBS) out = out.replace(re, to);
  return out;
}
