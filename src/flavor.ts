// Flavor — the game wears a single classic-roguelike FANTASY / NetHack face. (It once had a
// live-toggleable POLKADOT crypto skin; that's retired — the flavor is now locked to fantasy and the
// toggle is gone.) Names live on the data defs as `fname` (fantasy) with `name` as a legacy fallback;
// loose strings use fp() which now always yields the fantasy variant; skin() scrubs any stray
// crypto proper nouns out of finished log/HUD text.

export type Flavor = "fantasy" | "polkadot";

/** The flavor is locked to fantasy. */
export function getFlavor(): Flavor { return "fantasy"; }
export function setFlavor(_f: Flavor): void { /* locked to fantasy — the crypto skin is retired */ }
export function toggleFlavor(): Flavor { return "fantasy"; }

/** The fantasy variant of a loose string (the polkadot arg is retained only as documentation). */
export function fp(fantasy: string, _polkadot?: string): string { return fantasy; }

/** A def's display name: its fantasy `fname` (falling back to `name` only where none was authored). */
export function nameOf(d: { name: string; fname?: string }): string { return d.fname ?? d.name; }

// A final word-boundary pass over finished log/HUD strings, scrubbing recurring crypto proper nouns
// to their fantasy equivalents (a safety net for text written directly rather than via fp()/fname).
const FANTASY_SUBS: [RegExp, string][] = [
  [/\bthe JAM\b/g, "the Amulet of Yendor"], [/\bThe JAM\b/g, "The Amulet of Yendor"], [/\bJAM\b/g, "Amulet"],
  [/\bGavin\b/g, "Marduk"], // the deity of prayer/altars
  [/\bthe relay\b/g, "the dungeon"], [/\bthe Relay\b/g, "the Dungeon"], [/\bRelay\b/g, "Dungeon"],
  [/\bthe Mempool\b/g, "the Great Hall"], [/\bTHE MEMPOOL\b/g, "THE GREAT HALL"], [/\bMempool\b/g, "Great Hall"],
  [/\byour nominator\b/g, "your hound"], [/\bnominator\b/g, "hound"],
  [/\bthe Marketmaker\b/g, "the Shopkeeper"], [/\bMarketmaker\b/g, "Shopkeeper"],
  [/\bthe Censor\b/g, "the Warden"], [/\bTHE CENSOR\b/g, "THE WARDEN"], [/\bCensor\b/g, "Warden"],
  // additional crypto proper nouns → fantasy, so nothing slips through in loose log text.
  // (Compound/possessive forms MUST precede the generic single-word subs below them.)
  [/\bPolkadot's Edge\b/g, "Excalibur"], // the lawful relic blade
  [/\bParachain Reaches\b/g, "the Dungeon Reaches"], [/\bparachain\b/gi, "dungeon"],
  [/\bKusama Deeps\b/g, "the Deep Caverns"], [/\bKusama\b/g, "the Wildlands"],
  [/\bLegacy Stack\b/g, "the Upper Dungeon"],
  [/\bDeed of Ascension\b/g, "Mark of Ascension"], [/\bsoulbound\b/g, "eternal"],
  [/\bXCM ← /g, ""], [/\bXCM → /g, ""], [/\bXCM-/g, ""], [/\bXCM\b/g, "the planar gate"],
  [/\bon-chain\b/g, "ancient"], [/\bNFT relics?\b/g, "relic"], [/\bNFT\b/g, "relic"],
  [/\bwallet\b/gi, "coffers"], [/\bPAS\b/g, "gold"],
  [/\bSubstrate-native\b/g, "Human"], [/\bSubstrate\b/g, "the bedrock"], [/\bPolkadot\b/g, "the realm"],
];
/** Scrub a finished log/HUD string to its fantasy face. */
export function skin(s: string): string {
  let out = s;
  for (const [re, to] of FANTASY_SUBS) out = out.replace(re, to);
  return out;
}
