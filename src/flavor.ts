// The game wears a single classic-roguelike FANTASY / NetHack face. (An older build had a
// live-toggleable crypto skin; it's fully retired — names live directly on the data defs and in the
// source strings.) `skin()` remains as a light final scrub over log/HUD text, a safety net for any
// stray proper noun; it is a no-op once the source is clean.

/** Scrub a finished log/HUD string of any stray legacy proper noun. */
export function skin(s: string): string {
  let out = s;
  for (const [re, to] of SUBS) out = out.replace(re, to);
  return out;
}

// Compound/possessive forms MUST precede the generic single-word subs below them.
const SUBS: [RegExp, string][] = [
  [/\bthe JAM\b/g, "the Amulet of Yendor"], [/\bThe JAM\b/g, "The Amulet of Yendor"], [/\bJAM\b/g, "Amulet"],
  [/\bGavin\b/g, "Marduk"],
  [/\bthe relay\b/g, "the dungeon"], [/\bthe Relay\b/g, "the Dungeon"], [/\bRelay\b/g, "Dungeon"],
  [/\bthe Mempool\b/g, "the Great Hall"], [/\bMempool\b/g, "Great Hall"],
  [/\byour nominator\b/g, "your hound"], [/\bnominator\b/g, "hound"],
  [/\bthe Marketmaker\b/g, "the Shopkeeper"], [/\bMarketmaker\b/g, "Shopkeeper"],
  [/\bthe Censor\b/g, "the Warden"], [/\bTHE CENSOR\b/g, "THE WARDEN"], [/\bCensor\b/g, "Warden"],
  [/\bPolkadot's Edge\b/g, "Excalibur"],
  [/\bParachain Reaches\b/g, "the Dungeon Reaches"], [/\bparachain\b/gi, "dungeon"],
  [/\bKusama Deeps\b/g, "the Deep Caverns"], [/\bthe Storage Caverns\b/g, "the Gnomish Mines"],
  [/\bDeed of Ascension\b/g, "Mark of Ascension"], [/\bsoulbound\b/g, "eternal"],
  [/\bXCM ← /g, ""], [/\bXCM → /g, ""], [/\bXCM-/g, ""], [/\bXCM\b/g, "the planar gate"],
  [/\bon-chain\b/g, "ancient"], [/\bNFT relics?\b/g, "relic"], [/\bNFT\b/g, "relic"],
  [/\bwallet\b/gi, "coffers"], [/\bPAS\b/g, "gold"],
  [/\bConsensus Vault\b/g, "Sokoban"], [/\bthe Sudo Throne\b/g, "the throne"], [/\bSudo Throne\b/g, "throne"],
];
