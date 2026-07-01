// Glyphs, palette, and the (themed) monster table.

import { fp, getFlavor, nameOf } from "./flavor";

export const COLORS = {
  bg:        "#0a0a0c",
  floor:     "#3c3a30",
  floorDim:  "#222019",
  wall:      "#7a6a3a",
  wallDim:   "#3a3320",
  door:      "#c08a3a",
  stairs:    "#e0b94d",
  player:    "#f0e6c0",
  good:      "#76c66a",
  bad:       "#c75c5c",
  gold:      "#e0b94d",
  dim:       "#6c6a60",
};

export type TileType = "wall" | "floor" | "door" | "doorClosed" | "doorLocked" | "doorHidden" | "stairsDown" | "stairsUp" | "altar" | "portal" | "faucet" | "throne" | "sink" | "vibrating" | "water" | "branchDown" | "pit" | "drawbridge" | "drawbridgeUp" | "lever";

export const TILE_GLYPH: Record<TileType, { ch: string; fg: string; fgDim: string }> = {
  wall:       { ch: "#", fg: COLORS.wall,   fgDim: COLORS.wallDim },
  floor:      { ch: "·", fg: COLORS.floor,  fgDim: COLORS.floorDim },
  door:       { ch: "'", fg: COLORS.door,   fgDim: "#5a4520" }, // an open doorway
  doorClosed: { ch: "+", fg: COLORS.door,   fgDim: "#5a4520" }, // closed — blocks sight, open by walking in
  doorLocked: { ch: "+", fg: "#d07040",     fgDim: "#5a3520" }, // locked — kick to break in
  doorHidden: { ch: "#", fg: COLORS.wall,   fgDim: COLORS.wallDim }, // looks exactly like wall — search (s) to find
  stairsDown: { ch: ">", fg: COLORS.stairs, fgDim: "#6a5a28" },
  stairsUp:   { ch: "<", fg: COLORS.stairs, fgDim: "#6a5a28" },
  altar:      { ch: "_", fg: "#c0d0e0",     fgDim: "#4a5560" },
  portal:     { ch: "Ω", fg: "#e060d0",     fgDim: "#6a3060" },
  faucet:     { ch: "{", fg: "#4fb0e0",     fgDim: "#2a5570" }, // a testnet faucet — quaff (q)
  throne:     { ch: "\\", fg: "#e0c040",    fgDim: "#6a5a20" }, // the Sudo Throne — sit (s)
  sink:       { ch: "=", fg: "#7fa0b0",     fgDim: "#3a4a55" }, // a burn sink — quaff (q) for chaos, kick (K) for a ring
  vibrating:  { ch: "≈", fg: "#ff60ff",     fgDim: "#7a307a" }, // the vibrating square — invoke (I) the ritual here
  water:      { ch: "}", fg: "#3f7ad0",     fgDim: "#1d3a66" }, // open water — impassable; cross by causeway or XCM jump (the Liquidity Pools)
  branchDown: { ch: ">", fg: "#c07a30",     fgDim: "#5a3a18" }, // a craggy side-stair into a branch (the Storage Caverns) — copper, not the gold main stair
  pit:        { ch: "^", fg: "#6a78b0",     fgDim: "#33415e" }, // a chasm (Consensus Vault) — impassable; shove a boulder in to fill it
  drawbridge: { ch: "=", fg: "#9a7a4a",     fgDim: "#4a3a22" }, // a consensus bridge, lowered — walk across
  drawbridgeUp: { ch: "▚", fg: "#9a7a4a",   fgDim: "#4a3a22" }, // raised — an impassable span (blocks passage + sight)
  lever:      { ch: "|", fg: "#d0b040",     fgDim: "#665820" }, // a lever — walk into it to raise/lower the bridge
};

export const MAX_DEPTH = 25; // the foot of the relay — the vibrating square; the Invocation opens Gehennom below (NetHack-scale ~25-floor main descent)

// ── Phase 6: the character sheet ─────────────────────────────────────────────
/** The six attributes, Polkadot-flavored. Stored 3–18; modifier is D&D-style. */
export const ATTRS = ["str", "dex", "con", "int", "wis", "cha"] as const;
export type Attr = (typeof ATTRS)[number];
export const ATTR_LABEL: Record<Attr, string> = { str: "STR", dex: "DEX", con: "CON", int: "INT", wis: "WIS", cha: "CHA" };
export const ATTR_FLAVOR: Record<Attr, string> = {
  str: "Stake-weight", dex: "Latency", con: "Resilience", int: "Throughput", wis: "Insight", cha: "Reputation",
};
const ATTR_FLAVOR_F: Record<Attr, string> = {
  str: "Strength", dex: "Dexterity", con: "Constitution", int: "Intelligence", wis: "Wisdom", cha: "Charisma",
};
/** The flavored long-name of an attribute (fantasy uses the classic D&D names). */
export function attrFlavor(a: Attr): string { return getFlavor() === "fantasy" ? ATTR_FLAVOR_F[a] : ATTR_FLAVOR[a]; }
/** −4..+4 ability modifier (D&D 10 = +0). Feeds to-hit, damage, HP, dodge. */
export function abilityMod(score: number): number { return Math.floor((score - 10) / 2); }

/** Ethos (alignment): Order ≈ Lawful, Balance ≈ Neutral, Chaos ≈ Chaotic. */
export type Ethos = "Order" | "Balance" | "Chaos";

export interface Archetype {
  id: string; name: string; fname: string; blurb: string; fblurb: string;
  stats: Record<Attr, number>;
  hp: number;
  start: string[]; // extra starting item ids, beyond the dagger + ration kit
  spell?: string;  // a spell known from the start (casters)
  ethos: Ethos;
}
export const ARCHETYPES: Archetype[] = [
  { id: "validator", name: "Validator", fname: "Knight", blurb: "Secures the chain — strong and tough.", fblurb: "Sworn to the blade — strong and tough.",
    stats: { str: 16, dex: 11, con: 16, int: 9, wis: 11, cha: 10 }, hp: 26, start: ["mace", "vest"], ethos: "Order" },
  { id: "nominator", name: "Nominator", fname: "Cleric", blurb: "Backs validators — balanced and well-liked.", fblurb: "Keeper of the faith — balanced and well-liked.",
    stats: { str: 12, dex: 13, con: 13, int: 11, wis: 12, cha: 15 }, hp: 22, start: ["heal"], ethos: "Balance" },
  { id: "cypherpunk", name: "Cypherpunk", fname: "Rogue", blurb: "Privacy and speed — quick, clever, unseen.", fblurb: "Shadow and speed — quick, clever, unseen.",
    stats: { str: 10, dex: 16, con: 11, int: 15, wis: 12, cha: 8 }, hp: 18, start: ["ring_priv", "tele"], spell: "tele", ethos: "Chaos" },
  { id: "builder", name: "Builder", fname: "Wizard", blurb: "Ships primitives — versatile and bright.", fblurb: "Weaver of spells — versatile and bright.",
    stats: { str: 11, dex: 12, con: 12, int: 16, wis: 13, cha: 11 }, hp: 20, start: ["book_map"], spell: "bolt", ethos: "Balance" },
  { id: "maximalist", name: "Maximalist", fname: "Barbarian", blurb: "A maximalist brute — raw stake and fury.", fblurb: "A wild brute — raw might and fury.",
    stats: { str: 17, dex: 12, con: 16, int: 8, wis: 10, cha: 8 }, hp: 28, start: ["mace"], ethos: "Chaos" },
  { id: "watcher", name: "Watcher", fname: "Ranger", blurb: "A keen-eyed node — strikes from range.", fblurb: "A keen-eyed hunter — strikes from range.",
    stats: { str: 12, dex: 16, con: 12, int: 11, wis: 13, cha: 9 }, hp: 20, start: ["dagger", "dagger"], ethos: "Balance" },
  { id: "solostaker", name: "Solo Staker", fname: "Monk", blurb: "A self-reliant ascetic — fights bare-handed, swift and calm.", fblurb: "A disciplined ascetic — fights bare-handed, swift and serene.",
    stats: { str: 13, dex: 15, con: 13, int: 11, wis: 16, cha: 10 }, hp: 22, start: [], ethos: "Order" },
  { id: "auditor", name: "Auditor", fname: "Archeologist", blurb: "A meticulous explorer — armed with tools and insight.", fblurb: "A meticulous delver — armed with tools and insight.",
    stats: { str: 11, dex: 13, con: 12, int: 15, wis: 14, cha: 10 }, hp: 20, start: ["scope", "lamp", "pickaxe"], ethos: "Order" },
];

/** Ecosystem (NetHack race): a stat tweak + a starting intrinsic, on top of the chosen archetype. */
export interface Race { id: string; name: string; fname: string; blurb: string; fblurb: string; statMod: Partial<Record<Attr, number>>; intrinsics: string[]; }
export const RACES: Race[] = [
  { id: "substrate", name: "Substrate-native", fname: "Human", blurb: "The native chain — balanced and adaptable.", fblurb: "Balanced and adaptable — no innate gifts, no flaws.", statMod: {}, intrinsics: [] },
  { id: "evm",       name: "EVM",       fname: "Elf",   blurb: "Quick and clever, a touch frail.", fblurb: "Quick and clever, a touch frail.", statMod: { dex: 2, int: 1, con: -1 }, intrinsics: [] },
  { id: "bitcoiner", name: "Bitcoiner", fname: "Dwarf", blurb: "A tough HODLer — can't be drained.", fblurb: "A tough delver — unshakeable, can't be drained.", statMod: { con: 2, str: 1, dex: -1 }, intrinsics: ["drainResist"] },
  { id: "kusaman",   name: "Kusaman",   fname: "Orc",   blurb: "Chaos-forged — strong and poison-proof, but abrasive.", fblurb: "War-forged — strong and poison-proof, but abrasive.", statMod: { str: 1, con: 1, cha: -2, int: -1 }, intrinsics: ["poisonResist"] },
  { id: "botnet",    name: "Botnet",    fname: "Gnome", blurb: "A networked swarm — clever and sensing, but slight.", fblurb: "A clever little folk — sharp-witted and far-sensing, but slight.", statMod: { dex: 1, int: 1, str: -1, con: -1 }, intrinsics: ["telepathy"] },
];
export function raceById(id: string): Race { return RACES.find((r) => r.id === id) ?? RACES[0]; }
export function raceName(r: Race): string { return getFlavor() === "fantasy" ? r.fname : r.name; }
export function raceBlurb(r: Race): string { return getFlavor() === "fantasy" ? r.fblurb : r.blurb; }
export function archetypeById(id: string): Archetype { return ARCHETYPES.find((a) => a.id === id) ?? ARCHETYPES[0]; }
/** An archetype's class name + blurb, flavored. */
export function archetypeName(a: Archetype): string { return getFlavor() === "fantasy" ? a.fname : a.name; }
export function archetypeBlurb(a: Archetype): string { return getFlavor() === "fantasy" ? a.fblurb : a.blurb; }
/** Alignment label, flavored: fantasy uses the classic Lawful/Neutral/Chaotic. */
export function ethosName(e: string): string {
  return fp(e === "Order" ? "Lawful" : e === "Chaos" ? "Chaotic" : "Neutral", e);
}

/** Per-archetype Quest (Phase 13c): a homeland portal, a nemesis, and your signature artifact. */
export interface Quest { homeland: string; fhomeland: string; portalDepth: number; artifactId: string; nemesis: MonsterDef; }
export const QUESTS: Record<string, Quest> = {
  validator: {
    homeland: "the Validator's Vault", fhomeland: "the Knight's Keep", portalDepth: 14, artifactId: "art_sceptre",
    nemesis: { name: "the Equivocator", fname: "the Doppel-King", ch: "E", fg: "#ff6060", hp: 42, dmg: [5, 10], ai: "chase", minDepth: 99, weight: 0, boss: true, fearless: true, splits: true },
  },
  nominator: {
    homeland: "the Bonding Hall", fhomeland: "the Cleric's Sanctuary", portalDepth: 14, artifactId: "art_aegis",
    nemesis: { name: "the Oversubscriber", fname: "the Glutton Lord", ch: "N", fg: "#e0a040", hp: 48, dmg: [5, 9], ai: "chase", minDepth: 99, weight: 0, boss: true, fearless: true, summons: true },
  },
  cypherpunk: {
    homeland: "the Panopticon", fhomeland: "the Rogue's Warren", portalDepth: 14, artifactId: "art_cipher",
    nemesis: { name: "the Surveillor", fname: "the Eye Tyrant", ch: "U", fg: "#c060e0", hp: 40, dmg: [4, 8], ai: "chase", minDepth: 99, weight: 0, boss: true, fearless: true, ranged: true },
  },
  builder: {
    homeland: "the Rent Foundry", fhomeland: "the Wizard's Tower", portalDepth: 14, artifactId: "art_compiler",
    nemesis: { name: "the Rent Extractor", fname: "the Tithe-Reaver", ch: "R", fg: "#e07030", hp: 44, dmg: [5, 9], ai: "chase", minDepth: 99, weight: 0, boss: true, fearless: true, steals: true },
  },
};
/** A quest's homeland name, flavored. */
export function questHomeland(q: Quest): string { return getFlavor() === "fantasy" ? q.fhomeland : q.homeland; }
/** A monster's display name, flavored. */
export function monName(d: MonsterDef): string { return nameOf(d); }
export function questFor(archetypeId: string): Quest { return QUESTS[archetypeId] ?? QUESTS.validator; }

// ── Phase 8: spellcasting ("extrinsics" cast from energy) ────────────────────
export interface Spell { id: string; name: string; fname: string; cost: number; dir: boolean; school: string; }
export const SPELLS: Spell[] = [
  { id: "bolt",  name: "finality bolt", fname: "force bolt",       cost: 5, dir: true,  school: "attack" },
  { id: "heal",  name: "self-mend",     fname: "healing",          cost: 6, dir: false, school: "healing" },
  { id: "map",   name: "light client",  fname: "magic mapping",    cost: 7, dir: false, school: "divination" },
  { id: "sense", name: "sense minds",   fname: "detect monsters",  cost: 5, dir: false, school: "divination" },
  { id: "tele",  name: "XCM jump",      fname: "teleport",         cost: 8, dir: false, school: "escape" },
  { id: "haste", name: "overclock",     fname: "haste self",       cost: 7, dir: false, school: "enchantment" },
  { id: "fireball", name: "immolation",  fname: "fireball",          cost: 9, dir: true,  school: "attack" },
  { id: "cure",  name: "cleanse",        fname: "cure sickness",     cost: 6, dir: false, school: "clerical" },
  { id: "detect", name: "ledger scan",   fname: "detect treasure",   cost: 6, dir: false, school: "divination" },
  { id: "dig",   name: "excavate",       fname: "dig",               cost: 7, dir: true,  school: "escape" },
  { id: "slow",  name: "throttle",       fname: "slow monster",      cost: 5, dir: true,  school: "enchantment" },
  { id: "sleep", name: "stasis field",   fname: "sleep",             cost: 6, dir: true,  school: "enchantment" },
  { id: "turn",  name: "slash the unfinalized", fname: "turn undead", cost: 7, dir: false, school: "clerical" },
  { id: "uncurse", name: "formal verification", fname: "remove curse", cost: 8, dir: false, school: "clerical" },
  { id: "cryo",  name: "cryo-lance",     fname: "cone of cold",      cost: 8, dir: true,  school: "attack" },
  { id: "charm", name: "delegate",       fname: "charm monster",     cost: 8, dir: true,  school: "enchantment" },
  { id: "clair", name: "remote sync",    fname: "clairvoyance",      cost: 7, dir: false, school: "divination" },
];
export function spellById(id: string): Spell | undefined { return SPELLS.find((s) => s.id === id); }
/** A spell's display name, flavored. */
export function spellName(s: Spell): string { return getFlavor() === "fantasy" ? s.fname : s.name; }

/** XCM destinations: each parachain branch scales difficulty + loot vs. the relay. */
// `layout` = the parachain's signature level generator, so each branch feels distinct.
export interface ChainDef { id: string; name: string; fname?: string; difficulty: number; loot: number; color: string; layout?: string; }
export const CHAINS: ChainDef[] = [
  { id: "kusama",    name: "Kusama",    fname: "the Wildlands",     difficulty: 1.6, loot: 1.6, color: "#e060d0", layout: "maze" }, // chaos, high risk/reward
  { id: "moonbeam",  name: "Moonbeam",  fname: "the Moonlit Keep",  difficulty: 1.3, loot: 1.4, color: "#53cbc9", layout: "grid" }, // an EVM contract-city
  { id: "astar",     name: "Astar",     fname: "the Star Vault",    difficulty: 1.2, loot: 1.3, color: "#1b6dff", layout: "grid" },
  { id: "phala",     name: "Phala",     fname: "the Shrouded Vale", difficulty: 1.1, loot: 1.2, color: "#cdfa50", layout: "maze" }, // privacy/compute — a dark labyrinth
  { id: "interlay",  name: "Interlay",  fname: "the Coinbridge",    difficulty: 1.0, loot: 1.5, color: "#f7931a", layout: "cave" }, // treasure caverns (BTC bridge)
  { id: "bifrost",   name: "Bifrost",   fname: "Bifrost",          difficulty: 0.9, loot: 1.0, color: "#5a25f0", layout: "labyrinth" },
  { id: "hydration", name: "Hydration", fname: "the Drowned Marsh", difficulty: 0.8, loot: 1.1, color: "#f6297c", layout: "swamp" }, // the Liquidity Pools — open water + islands
  { id: "acala",     name: "Acala",     fname: "the Haven",         difficulty: 0.6, loot: 0.8, color: "#e40c5b", layout: "normal" }, // safe DeFi haven
];
/** A parachain/realm's display name, flavored. */
export function chainName(c: ChainDef): string { return getFlavor() === "fantasy" ? (c.fname ?? c.name) : c.name; }

/** A mandatory-feeling sub-dungeon branch off the main descent (NetHack's Mines/Sokoban).
 *  Unlike an XCM parachain it has a fixed run of floors entered by a branch-stair (not a portal),
 *  a floor-by-floor climb, and a guaranteed prize on its end floor. `dir` is which way it runs. */
export interface BranchDef extends ChainDef {
  branch: true;
  entryDepth: number; // the main-dungeon depth that hosts the branch-stair
  floors: number;     // how many floors deep the branch runs
  prizeId: string;    // the guaranteed reward on the end floor
  end: string;        // the themed name of the end floor ("the Storage Caverns' End")
  fend?: string;      // fantasy name of the end floor
  entryFlavor?: string; // override the entry message (e.g. the Vault "climbs up")
  fentryFlavor?: string; // fantasy entry message
  sokoban?: boolean;  // hand-built boulder-puzzle floors (the Consensus Vault) instead of procedural
  upward?: boolean;   // a tower you climb (the Validator's Tower) — flips "deeper/up" wording
  bossDef?: MonsterDef; // a unique boss wards the End floor's prize (else a plain guardian)
  prizeEnchant?: number; // enchant the guaranteed End prize (a tower climax earns more than +0)
}
export const BRANCHES: BranchDef[] = [
  {
    id: "mines", name: "the Storage Caverns", fname: "the Gnomish Mines", branch: true, difficulty: 1.15, loot: 1.6, color: "#c9a04a",
    layout: "cave", entryDepth: 5, floors: 3, prizeId: "hodlstone", end: "the Storage Caverns' End", fend: "the Mines' End",
  }, // a DA/storage parachain rendered as treasure caverns; its End yields a luckstone-grade HODL stone
  {
    id: "vault", name: "the Consensus Vault", fname: "Sokoban", branch: true, sokoban: true, difficulty: 0.5, loot: 0.5,
    color: "#7ad0c0", layout: "normal", entryDepth: 9, floors: 1, prizeId: "vault", end: "the Vault's Crown", fend: "Sokoban's Prize",
    entryFlavor: "You squeeze up into the Consensus Vault — a sealed puzzle of blocks and chasms. Shove the blocks into the gaps; claim the prize at the top.",
    fentryFlavor: "You squeeze up into Sokoban — a sealed puzzle of boulders and chasms. Shove the boulders into the pits; claim the prize at the top.",
  }, // a Sokoban-style boulder puzzle; clear it for a guaranteed multisig vault (bag of holding)
  {
    id: "tower", name: "the Validator's Tower", fname: "Vlad's Tower", branch: true, upward: true,
    difficulty: 1.4, loot: 1.4, color: "#c04040", layout: "fortress", entryDepth: 16, floors: 3,
    prizeId: "plate", prizeEnchant: 2, end: "the Tower's Crown", fend: "the Tower's Summit",
    entryFlavor: "You climb the spiral stair into the Validator's Tower — a slashing lord holds its summit.",
    fentryFlavor: "You climb the winding stair into Vlad's Tower — a dread lord holds its summit.",
    bossDef: { name: "the Slashing Lord", fname: "Vlad the Impaler", ch: "L", fg: "#e02020", hp: 72, dmg: [7, 13], ai: "chase", minDepth: 99, weight: 0, boss: true, fearless: true, muse: true },
  }, // a fortress tower you climb; its Lord wards a +2 blessed plate at the Crown
];
export function branchById(id: string): BranchDef | undefined { return BRANCHES.find((b) => b.id === id); }
/** A branch's end-floor name + entry flavor, flavored. */
export function branchEnd(b: BranchDef): string { return getFlavor() === "fantasy" ? (b.fend ?? b.end) : b.end; }
export function branchEntryFlavor(b: BranchDef): string | undefined { return getFlavor() === "fantasy" ? (b.fentryFlavor ?? b.entryFlavor) : b.entryFlavor; }

/** Realms deepen and grow chaotic — a nod to Polkadot → Kusama. */
export function realmName(depth: number): string {
  if (depth >= 48) return fp("Moloch's Sanctum", "Moloch's Sanctum");           // GEHENNOM_BOTTOM
  if (depth >= 26) return fp("Gehennom, the Dark Forest", "Gehennom, the Dark Forest");  // below the foot of the relay
  if (depth >= 25) return fp("the Castle Gate", "the Foot of the Relay");       // MAX_DEPTH — the vibrating square
  if (depth >= 18) return fp("the Deep Caverns", "the Kusama Deeps");
  if (depth >= 9) return fp("the Dungeon Reaches", "the Parachain Reaches");
  return fp("the Upper Dungeon", "the Legacy Stack");
}

const GRAY_PAPER_F = [
  "An old prophecy: 'A soul ascends when it bows to no master.'",
  "Descend the Dungeon of Doom to depth 12 — the Castle Gate. There, the",
  "vibrating square: perform the invocation, brave Gehennom, wrest the Amulet",
  "of Yendor from Moloch, then climb back and ASCEND.",
];
const GRAY_PAPER_P = [
  "From the Gray Paper: 'A chain ascends when it needs no master.'",
  "Descend the Dungeon of Doom to depth 12 — the foot of the relay. There, the",
  "vibrating square: invoke the rite, descend Gehennom, wrest the JAM from Moloch,",
  "then climb back and ASCEND.",
];
/** The opening prophecy, flavored. */
export function grayPaper(): string[] { return getFlavor() === "fantasy" ? GRAY_PAPER_F : GRAY_PAPER_P; }

export interface MonsterDef {
  name: string;        // polkadot flavor
  fname?: string;      // fantasy flavor (the default skin)
  ch: string;
  fg: string;
  hp: number;
  dmg: [number, number]; // inclusive min..max
  ai: "chase" | "wander";
  minDepth: number;
  weight: number;        // spawn weight
  splits?: boolean;      // a sybil — occasionally replicates (the Sybil attack)
  pack?: [number, number]; // a social hunter — spawns as a cluster of this many, so surround/flank tactics bite
  speed?: number;        // turn speed (100 = normal; higher acts more often)
  inflict?: "poison" | "confuse"; // status applied on a hit (30% chance)
  ranged?: boolean;      // fires at the player from a distance with line-of-sight
  breath?: number;       // a dragon-style breath ray (max damage) down a line
  summons?: boolean;     // conjures more monsters
  cowardly?: boolean;    // flees once badly hurt
  heals?: boolean;       // a medic — mends wounded allies instead of fighting
  breeds?: boolean;      // multiplies when a pair of its kind is adjacent
  corpseEffect?: "poisonous" | "petrify" | "speed" | "telepathy" | "levelup" | "fire" | "cold" | "shock"; // what eating its corpse does
  corrodes?: boolean;    // its touch rusts/corrodes a worn armor piece
  drains?: boolean;      // a barrow-wight (wraith) — its touch saps an epoch (XP level); eat its corpse to regain one
  steals?: boolean;      // a thief — snatches a pack item and flees (the rug pull)
  stealsGold?: boolean;  // an airdrop farmer (leprechaun) — snatches gold and blinks away
  stealsLuck?: boolean;  // a doubt gremlin — leeches your Fortune (Luck) on a hit
  paralyzes?: boolean;   // a watcher eye (floating eye) — passive, but melee it and its gaze freezes you
  engulfs?: boolean;     // a trapper (liquidity trap) — a hit swallows you whole; struggle out or cut free
  silences?: boolean;    // a gag wraith — a hit smothers you in silence (no casting; in co-op, no chat)
  drainsStat?: boolean;  // a mind flayer — a hit drains a random attribute (restored by prayer)
  infects?: boolean;     // a werewolf — a hit may infect you with lycanthropy (uncontrolled were-forms)
  muse?: boolean;        // muse.c — gulps a healing draught when badly hurt; cornered, it blinks away
  zaps?: "sleep" | "blind" | "confuse"; // muse.c — zaps a wand-borne debuff at you from range
  throws?: "dart" | "rock"; // mthrowu.c — hurls a physical projectile at you from range (darts are recoverable)
  wears?: boolean;       // muse.c — dons armor it finds on the floor, growing harder to hit
  diseases?: boolean;    // a plague fly — a hit may make you sick (a deadly illness countdown; cure fast)
  seduces?: boolean;     // a succubus — adjacent, it charms you (a lost turn) and lifts an item, then blinks
  mimic?: boolean;       // a honeypot — sits disguised as loot, strikes when touched
  fearless?: boolean;    // ignores warding engravings (bosses fear no Gray Paper)
  keeper?: boolean;      // a shopkeeper — peaceful until you shoplift, then merciless
  priest?: boolean;      // a temple priest — peaceful guardian of an altar; turns lethal if struck
  seer?: boolean;        // the Oracle — a peaceful seer; #chat for a paid consultation (lethal if struck)
  guard?: boolean;       // a Council Guard — escorts you out of the Treasury vault; merciless if provoked
  boss?: boolean;        // a unique mini-boss — drops a guaranteed prize on death
}

// Themed bestiary — the centralised legacy stack fights back.
export const MONSTERS: MonsterDef[] = [
  { name: "a sybil",           fname: "a doppelganger",  ch: "s", fg: "#9a9a9a", hp: 3,  dmg: [1, 2], ai: "chase",  minDepth: 1, weight: 4, splits: true, speed: 105, pack: [2, 4] },
  { name: "a rust bug",        fname: "a rust monster",  ch: "x", fg: "#7ac06a", hp: 2,  dmg: [1, 1], ai: "wander", minDepth: 1, weight: 5, speed: 90, corrodes: true },
  { name: "a validator golem", fname: "a stone golem",   ch: "V", fg: "#5c8ad0", hp: 12, dmg: [2, 4], ai: "chase",  minDepth: 2, weight: 3, speed: 85, wears: true },
  { name: "a fork daemon",     fname: "a quickling",     ch: "f", fg: "#d0a0d0", hp: 7,  dmg: [2, 4], ai: "chase",  minDepth: 3, weight: 3, speed: 120, corpseEffect: "speed", pack: [2, 3] },
  { name: "a gas wraith",      fname: "a stench wraith", ch: "w", fg: "#c08adf", hp: 6,  dmg: [2, 3], ai: "chase",  minDepth: 3, weight: 3, inflict: "poison", corpseEffect: "poisonous" },
  { name: "a freezer",         fname: "a cockatrice",    ch: "c", fg: "#bcd6e6", hp: 10, dmg: [2, 4], ai: "chase",  minDepth: 4, weight: 2, corpseEffect: "petrify" },
  { name: "a rug puller",      fname: "a treasure nymph", ch: "r", fg: "#d08040", hp: 5,  dmg: [3, 6], ai: "chase",  minDepth: 4, weight: 2, speed: 115, steals: true },
  { name: "an airdrop farmer", fname: "a leprechaun",    ch: "l", fg: "#40d040", hp: 6,  dmg: [1, 3], ai: "chase",  minDepth: 3, weight: 2, speed: 120, stealsGold: true },
  { name: "a doubt gremlin",   fname: "a gremlin",       ch: "g", fg: "#5fb0b0", hp: 7,  dmg: [1, 3], ai: "chase",  minDepth: 5, weight: 2, speed: 110, stealsLuck: true, pack: [2, 3] },
  { name: "a watcher eye",     fname: "a floating eye",  ch: "e", fg: "#d8d040", hp: 14, dmg: [0, 0], ai: "chase",  minDepth: 4, weight: 2, speed: 60,  paralyzes: true },
  { name: "a censor imp",      fname: "a confusion imp", ch: "i", fg: "#d05c5c", hp: 8,  dmg: [3, 5], ai: "chase",  minDepth: 4, weight: 2, inflict: "confuse", corpseEffect: "telepathy" },
  { name: "a whale",           fname: "a hill giant",    ch: "O", fg: "#4090c0", hp: 24, dmg: [3, 6], ai: "chase",  minDepth: 5, weight: 2, speed: 60, throws: "rock" },
  { name: "a front-runner",    fname: "a kobold archer", ch: "k", fg: "#c0a050", hp: 7,  dmg: [2, 4], ai: "chase",  minDepth: 3, weight: 2, speed: 110, throws: "dart", pack: [2, 3] },
  { name: "a dilution wraith",  fname: "a barrow-wight",  ch: "W", fg: "#b6b0d4", hp: 16, dmg: [2, 4], ai: "chase",  minDepth: 6, weight: 2, speed: 90, drains: true, corpseEffect: "levelup" },
  { name: "an oracle",         fname: "a dark seer",     ch: "o", fg: "#e0c040", hp: 9,  dmg: [3, 6], ai: "chase",  minDepth: 5, weight: 2, ranged: true },
  { name: "a liquidity trap",  fname: "a trapper",       ch: "t", fg: "#6ec0a0", hp: 20, dmg: [3, 6], ai: "chase",  minDepth: 6, weight: 2, speed: 80, engulfs: true },
  { name: "a 51% attacker",    fname: "a berserker",     ch: "A", fg: "#e05050", hp: 16, dmg: [4, 8], ai: "chase",  minDepth: 6, weight: 2, speed: 110, inflict: "confuse" },
  { name: "a gag enforcer",    fname: "a silence wraith", ch: "q", fg: "#8090a0", hp: 18, dmg: [2, 4], ai: "chase",  minDepth: 7, weight: 2, speed: 95, silences: true },
  { name: "a MEV bot",         fname: "a giant bat",     ch: "b", fg: "#80c060", hp: 6,  dmg: [2, 4], ai: "chase",  minDepth: 3, weight: 3, speed: 135, corpseEffect: "shock", pack: [2, 4] },
  { name: "a slashing daemon", fname: "a giant serpent", ch: "S", fg: "#e06060", hp: 14, dmg: [4, 8], ai: "chase",  minDepth: 5, weight: 2, muse: true },
  { name: "a darkpool eel",    fname: "an eel",          ch: ";", fg: "#40a080", hp: 14, dmg: [4, 9], ai: "chase",  minDepth: 5, weight: 2, speed: 110 },
  { name: "a were-validator",  fname: "a werewolf",      ch: "d", fg: "#c08040", hp: 18, dmg: [3, 6], ai: "chase",  minDepth: 6, weight: 2, speed: 110, infects: true, pack: [2, 3] },
  { name: "a sudo conjurer",   fname: "a summoner cultist", ch: "&", fg: "#c080e0", hp: 16, dmg: [2, 4], ai: "chase",  minDepth: 6, weight: 2, summons: true },
  { name: "a hex caster",      fname: "a sorcerer",      ch: "H", fg: "#b060d0", hp: 18, dmg: [3, 6], ai: "chase",  minDepth: 7, weight: 2, zaps: "sleep" },
  { name: "a thought leech",   fname: "a mind flayer",   ch: "u", fg: "#b060c0", hp: 20, dmg: [2, 5], ai: "chase",  minDepth: 8, weight: 2, speed: 95, drainsStat: true },
  { name: "a finality dragon", fname: "an ancient dragon", ch: "D", fg: "#ff5040", hp: 34, dmg: [5, 9], ai: "chase",  minDepth: 6, weight: 1, breath: 16, fearless: true, corpseEffect: "fire" },
  { name: "a panic seller",    fname: "a craven goblin", ch: "p", fg: "#d0d060", hp: 5,  dmg: [1, 3], ai: "chase",  minDepth: 2, weight: 3, cowardly: true },
  { name: "a mercenary node",  fname: "a soldier",       ch: "@", fg: "#a0a070", hp: 16, dmg: [3, 7], ai: "chase",  minDepth: 4, weight: 2, wears: true },
  { name: "a malware fly",     fname: "a plague fly",    ch: "a", fg: "#9ac070", hp: 5,  dmg: [1, 3], ai: "chase",  minDepth: 4, weight: 2, speed: 120, diseases: true },
  { name: "a relay medic",     fname: "a healer acolyte", ch: "h", fg: "#80e0c0", hp: 10, dmg: [1, 2], ai: "chase",  minDepth: 5, weight: 2, heals: true },
  { name: "a honeypot siren",  fname: "a succubus",      ch: "n", fg: "#e080b0", hp: 12, dmg: [2, 4], ai: "chase",  minDepth: 6, weight: 2, speed: 105, seduces: true },
  { name: "a dust gremlin",    fname: "a gremlin",       ch: "g", fg: "#90a070", hp: 4,  dmg: [1, 2], ai: "chase",  minDepth: 2, weight: 3, breeds: true },
  // ── bestiary breadth: rodents, humanoids, the shallow undead (turnable), thieves, slimes ──
  { name: "a sybil rat",       fname: "a sewer rat",     ch: "r", fg: "#a09070", hp: 3,  dmg: [1, 2], ai: "chase",  minDepth: 1, weight: 2, breeds: true },
  { name: "a spam kobold",     fname: "a kobold",        ch: "k", fg: "#90b070", hp: 5,  dmg: [1, 3], ai: "chase",  minDepth: 1, weight: 2 },
  { name: "a legacy zombie",   fname: "a zombie",        ch: "z", fg: "#8090a0", hp: 8,  dmg: [2, 4], ai: "chase",  minDepth: 3, weight: 2 },
  { name: "a shill nymph",     fname: "a nymph",         ch: "n", fg: "#e0a0d0", hp: 10, dmg: [1, 3], ai: "chase",  minDepth: 4, weight: 2, steals: true },
  { name: "a spam slime",      fname: "a green slime",   ch: "j", fg: "#90c060", hp: 12, dmg: [2, 5], ai: "chase",  minDepth: 5, weight: 2, corrodes: true },
  { name: "a legacy mummy",    fname: "a mummy",         ch: "M", fg: "#c0b080", hp: 20, dmg: [3, 7], ai: "chase",  minDepth: 8, weight: 2 },
  // ── Gehennom demons (Phase 12c) — the Dark Forest's servants of centralization ──
  { name: "a custodian fiend",   fname: "a dungeon fiend",  ch: "&", fg: "#c04040", hp: 22, dmg: [4, 8], ai: "chase", minDepth: 9,  weight: 2, steals: true, speed: 110 },
  { name: "a KYC wraith",        fname: "a watcher wraith", ch: "W", fg: "#a060a0", hp: 18, dmg: [3, 6], ai: "chase", minDepth: 9,  weight: 2, inflict: "confuse", ranged: true },
  { name: "a permission daemon", fname: "a warden demon",   ch: "P", fg: "#d05050", hp: 24, dmg: [4, 7], ai: "chase", minDepth: 9,  weight: 2, summons: true },
  { name: "a rent-seeker imp",   fname: "a snatch imp",     ch: "j", fg: "#d0a040", hp: 12, dmg: [3, 5], ai: "chase", minDepth: 9,  weight: 3, steals: true, speed: 120 },
  { name: "a censorship demon",  fname: "a hellfire demon", ch: "X", fg: "#e03030", hp: 30, dmg: [5, 9], ai: "chase", minDepth: 10, weight: 2, breath: 14, fearless: true },
  // ── deep Gehennom (Phase 18) — the back half of the descent gets fresh terrors, not just scaled-up shallows ──
  { name: "a cartel enforcer",   fname: "an iron enforcer",   ch: "B", fg: "#d06030", hp: 34, dmg: [6, 10], ai: "chase", minDepth: 13, weight: 2, corrodes: true, speed: 85, muse: true },
  { name: "a darkpool kraken",   fname: "a deepwater horror", ch: "Y", fg: "#5060c0", hp: 30, dmg: [5, 9],  ai: "chase", minDepth: 15, weight: 2, ranged: true, inflict: "confuse", corpseEffect: "cold" },
  { name: "a sovereign daemon",  fname: "an arch-lich",       ch: "Z", fg: "#e02020", hp: 42, dmg: [6, 11], ai: "chase", minDepth: 17, weight: 1, summons: true, fearless: true, muse: true, zaps: "blind" },
  // ── rival adventurers (mplayer.c) — other ascendants who came for the JAM and never left; deep only ──
  { name: "a rogue validator",   fname: "a rogue",            ch: "@", fg: "#c0b070", hp: 40, dmg: [6, 11], ai: "chase", minDepth: 20, weight: 1, steals: true, muse: true, speed: 110 },
  { name: "a rival ascendant",   fname: "a valkyrie",         ch: "@", fg: "#b8c8e8", hp: 48, dmg: [7, 12], ai: "chase", minDepth: 26, weight: 1, muse: true, throws: "dart", zaps: "sleep" },
  // ── the deep Gehennom apex — the last terrors before Moloch ──
  { name: "a rollup titan",      fname: "a titan",            ch: "H", fg: "#d0a850", hp: 44, dmg: [7, 12], ai: "chase", minDepth: 30, weight: 1, throws: "rock", speed: 90 },
  { name: "a 51% attacker",      fname: "a minotaur",         ch: "H", fg: "#e05030", hp: 52, dmg: [8, 14], ai: "chase", minDepth: 34, weight: 1, speed: 110 },
  { name: "a finality reaper",   fname: "a death knight",     ch: "&", fg: "#c03030", hp: 50, dmg: [7, 13], ai: "chase", minDepth: 38, weight: 1, drains: true, fearless: true, muse: true, corpseEffect: "levelup" },
];

/** The Marketmaker — a bazaar shopkeeper. Peaceful while you pay; lethal if you shoplift. */
export const SHOPKEEPER: MonsterDef = {
  name: "the Marketmaker", fname: "the Shopkeeper", ch: "$", fg: "#e8c84a", hp: 54, dmg: [6, 11], ai: "chase", minDepth: 1, weight: 0, fearless: true, keeper: true,
};

/** A temple priest — peaceful keeper of a shrine's altar; turns lethal if struck or robbed. */
export const PRIEST: MonsterDef = {
  name: "the Gavin priest", fname: "the temple priest", ch: "@", fg: "#d6d0f4", hp: 30, dmg: [4, 8], ai: "chase", minDepth: 1, weight: 0, fearless: true, priest: true,
};

/** The Oracle — a peaceful seer in a spring-ringed chamber; #chat (with coin) for a consultation. */
export const ORACLE: MonsterDef = {
  name: "the Oracle", fname: "the Oracle", ch: "@", fg: "#c060e0", hp: 32, dmg: [4, 8], ai: "chase", minDepth: 1, weight: 0, fearless: true, seer: true,
};

/** Major consultations — genuinely useful guidance (skin() reflavors the proper nouns). */
export const ORACLE_HINTS = [
  "The foot of the relay hides a vibrating square — bring the Bell, the Candelabrum, and the Gray Paper, and #invoke there.",
  "A blessed scroll of formal verification audits your gear — proofed, it will never rust.",
  "Slay the barrow-wight, then eat its corpse: the epoch it drained returns to you.",
  "Dip a worthy blade in a fountain and you may draw the lawful relic.",
  "Cursed gear welds fast to the flesh — a remove-curse alone will free it.",
  "Eat a censor-imp's corpse and your mind will sense the unseen, even in the dark.",
  "Prayer mends the direst troubles — but never pray twice before the cooldown lapses, lest wrath answer.",
  "The Treasury is sealed to feet — only a blink or teleport finds the gold within.",
  "Reflection rebounds a dragon's breath; an amulet of life saving spends itself to deny one death.",
  "Carry a lit lamp into the dark, or the deep will swallow your sight to a single stride.",
];
/** Minor consultations — cryptic rumors in the NetHack idiom. */
export const ORACLE_RUMORS = [
  "Not all that shimmers is a token; some is only worthless glass.",
  "Probe a foe before you strike, and you will not be surprised.",
  "The HODL stone steadies the fortunate and chains the cursed.",
  "A shout carries far through the relay — and the deep is always listening.",
  "Trapdoors yawn on the descent; tread light, lest the floor give way.",
  "A silenced tongue casts no spell.",
  "Some doors only look like walls; search, and they reveal themselves.",
  "The thirstier the liquidity, the harder it is to climb back out.",
];

/** The Council Guard — keeper of the Treasury vault. Peaceful escort; lethal if you strike it. */
export const COUNCIL_GUARD: MonsterDef = {
  name: "the Council Guard", fname: "the Vault Guard", ch: "@", fg: "#d0c060", hp: 60, dmg: [6, 12], ai: "chase", minDepth: 1, weight: 0, fearless: true, guard: true,
};

/** An Astral high priest — each Genesis altar is warded by one of these clerical guardians. */
export const HIGH_PRIEST: MonsterDef = {
  name: "an Astral High Minister", fname: "a high priest", ch: "@", fg: "#fff0c0", hp: 56, dmg: [7, 13], ai: "chase", minDepth: 99, weight: 0, fearless: true, summons: true, breath: 12,
};

/** The honeypot — a mimic. Spawned separately (placeMimics), disguised as loot. */
export const HONEYPOT: MonsterDef = {
  name: "a honeypot", fname: "a mimic", ch: "m", fg: "#e0b020", hp: 16, dmg: [3, 7], ai: "chase", minDepth: 3, weight: 0, mimic: true, speed: 90,
};

/** The Censor — high keeper of the vibrating square at the foot of the relay (MAX_DEPTH). */
export const CENSOR: MonsterDef = {
  name: "THE CENSOR", fname: "THE WARDEN", ch: "C", fg: "#ff3b3b", hp: 48, dmg: [6, 11], ai: "chase", minDepth: 99, weight: 0, fearless: true,
};

/** MOLOCH, the Central Planner — the final tyrant who hoards the JAM at the bottom of Gehennom. */
export const MOLOCH: MonsterDef = {
  name: "MOLOCH, the Central Planner", fname: "MOLOCH, the Dark Lord", ch: "&", fg: "#ff2020", hp: 80, dmg: [8, 14], ai: "chase", minDepth: 99, weight: 0, fearless: true, boss: true, summons: true, breath: 20,
};

/** Realm mini-bosses — one guards a specific depth and drops a prize when slain. */
export const MINIBOSSES: Record<number, MonsterDef> = {
  8:  { name: "the Forkmaster", fname: "the Mirror Fiend", ch: "F", fg: "#ff80ff", hp: 30, dmg: [4, 7], ai: "chase", minDepth: 99, weight: 0, boss: true, splits: true },
  18: { name: "the Sudo Key",   fname: "the Iron Warden",  ch: "K", fg: "#ffd040", hp: 44, dmg: [5, 9], ai: "chase", minDepth: 99, weight: 0, boss: true, speed: 90 },
};

const DEATHS_F = [
  "You die.",
  "Death claims you — but not as you'd hoped.",
  "The dungeon swallows you whole.",
  "Cut down to nothing.",
  "Cast into oblivion.",
];
const DEATHS_P = [
  "Your stack overflowed.",
  "Finalised — but not as you'd hoped.",
  "The chain forked you off.",
  "Slashed to nothing.",
  "Reorged into oblivion.",
];
/** Death epitaphs, flavored. */
export function deaths(): string[] { return getFlavor() === "fantasy" ? DEATHS_F : DEATHS_P; }

const GREETINGS_F = [
  "You descend into the dungeon. Recover the Amulet of Yendor, and ascend.",
  "The dungeon breathes an ancient dread. Hold to your purpose.",
  "Welcome, Seeker. The old prophecy says: trust no master.",
];
const GREETINGS_P = [
  "You descend into the legacy stack. Recover the JAM, and ascend.",
  "The dungeon hums with centralised dread. Stay independent.",
  "Welcome, Seeker. The Gray Paper says: trust no single node.",
];
/** Opening greetings, flavored. */
export function greetings(): string[] { return getFlavor() === "fantasy" ? GREETINGS_F : GREETINGS_P; }
