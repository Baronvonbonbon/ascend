// The fantasy LEXICON — the single source of truth for the game's themeable names. The game wears a
// classic-roguelike / NetHack face; every proper noun and themed term maps to a fantasy name here.
// `skin()` applies these subs as a final scrub over any log/HUD text, so re-skinning the whole game to
// a different theme is a one-file change (edit the right-hand sides). The source strings are already
// fantasy, so at runtime this is a near no-op safety net for any stray term.

/** Scrub a finished log/HUD string through the lexicon. */
export function skin(s: string): string {
  let out = s;
  for (const [re, to] of LEXICON) out = out.replace(re, to);
  return out;
}

// Compound / possessive / capitalized forms MUST precede the generic single-word subs below them.
// The source is fully fantasy (including former code ids — the Amulet item, the polymorph scroll, the
// teleport/polymorph traps, the fountain tile), so at runtime this is a near no-op safety net.
const LEXICON: [RegExp, string][] = [
  // ── unique proper nouns ──
  [/\bthe JAM\b/g, "the Amulet of Yendor"], [/\bThe JAM\b/g, "The Amulet of Yendor"], [/\bJAM\b/g, "Amulet"],
  [/\bGavin\b/g, "Marduk"],
  [/\bPolkadot's Edge\b/g, "Excalibur"], [/\bPolkadot\b/g, "Yendor"],
  [/\bthe Censor\b/g, "the Warden"], [/\bTHE CENSOR\b/g, "THE WARDEN"], [/\bCensor\b/g, "Warden"],
  [/\bthe Marketmaker\b/g, "the Shopkeeper"], [/\bMarketmaker\b/g, "Shopkeeper"],
  // ── places ──
  [/\bthe relay\b/g, "the dungeon"], [/\bthe Relay\b/g, "the Dungeon"], [/\bRelay\b/g, "Dungeon"],
  [/\bthe Mempool\b/g, "the Great Hall"], [/\bMempool\b/g, "Great Hall"],
  [/\bParachain Reaches\b/g, "the Dungeon Reaches"], [/\bparachain\b/gi, "dungeon"],
  [/\bKusama Deeps\b/g, "the Deep Caverns"], [/\bKusama\b/g, "the Wilds"],
  [/\bthe Storage Caverns\b/g, "the Gnomish Mines"],
  [/\bConsensus Vault\b/g, "Sokoban"], [/\bLiquidity Pools\b/g, "the Sunken Pools"],
  [/\bthe Sudo Throne\b/g, "the throne"], [/\bSudo Throne\b/g, "throne"],
  // ── companions & foes ──
  [/\byour nominator\b/g, "your hound"], [/\bnominator\b/g, "hound"],
  [/\bwere-validator\b/g, "werewolf"], [/\bvalidator golem\b/g, "iron golem"], [/\bvalidator\b/g, "sentinel"],
  [/\bfront-?runners?\b/gi, "skirmisher"], [/\bMEV bots?\b/g, "storm sprite"], [/\bMEV\b/g, "storm"],
  [/\bairdrop farmers?\b/g, "coin-hoarder"], [/\bairdrop\b/g, "coin"],
  [/\bSybils?\b/g, "Phantom"], [/\bsybils?\b/g, "phantom"],
  // ── objects, tools & currency ──
  [/\bHODL stone\b/g, "luckstone"], [/\bHODL\b/g, "lucky"],
  [/\bmultisig vault\b/g, "bag of holding"], [/\bmultisig\b/g, "warded"],
  [/\ba testnet faucet\b/g, "a fountain"], [/\btestnet faucet\b/g, "fountain"], [/\btestnet\b/g, ""],
  [/\bcontract deployer\b/g, "rune-scribe's kit"], [/\bcontract\b/gi, "rune"],
  [/\bDeed of Ascension\b/g, "Mark of Ascension"], [/\bsoulbound\b/g, "eternal"],
  [/\bXCM ← /g, ""], [/\bXCM → /g, ""], [/\bXCM-/g, ""], [/\bXCM\b/g, "the planar gate"],
  [/\bon-chain\b/gi, "ancient"], [/\bgasless\b/g, ""], [/\bNFT relics?\b/g, "relic"], [/\bNFT\b/g, "relic"],
  [/\bwallet\b/gi, "coffers"], [/\bPAS\b/g, "gold"],
  // ── mechanics & flavor words ──
  [/\bStake-weight\b/g, "Brawn"],
  [/\bconsensus bridge\b/g, "drawbridge"], [/\bconsensus\b/gi, "accord"],
  [/\bepochs?\b/g, "level"], [/\bruntimes?\b/g, "tome"],
  [/\bbytecode\b/g, "the old tongue"], [/\bgas-?fee\b/gi, "gas"],
  [/\bliquidity\b/gi, ""],
];
