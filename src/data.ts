// Glyphs, palette, and the (themed) monster table.


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
/** The six attributes. Stored 3–18; modifier is D&D-style. */
export const ATTRS = ["str", "dex", "con", "int", "wis", "cha"] as const;
export type Attr = (typeof ATTRS)[number];
export const ATTR_LABEL: Record<Attr, string> = { str: "STR", dex: "DEX", con: "CON", int: "INT", wis: "WIS", cha: "CHA" };
const ATTR_FULL: Record<Attr, string> = {
  str: "Strength", dex: "Dexterity", con: "Constitution", int: "Intelligence", wis: "Wisdom", cha: "Charisma",
};
/** The full long-name of an attribute (the classic D&D names). */
export function attrFlavor(a: Attr): string { return ATTR_FULL[a]; }
/** −4..+4 ability modifier (D&D 10 = +0). Feeds to-hit, damage, HP, dodge. */
export function abilityMod(score: number): number { return Math.floor((score - 10) / 2); }

/** Ethos (alignment): Order ≈ Lawful, Balance ≈ Neutral, Chaos ≈ Chaotic. */
export type Ethos = "Order" | "Balance" | "Chaos";

export interface Archetype {
  id: string; name: string; blurb: string;
  stats: Record<Attr, number>;
  hp: number;
  start: string[]; // extra starting item ids, beyond the dagger + ration kit
  spell?: string;  // a spell known from the start (casters)
  ethos: Ethos;
}
export const ARCHETYPES: Archetype[] = [
  { id: "validator", name: "Knight", blurb: "Sworn to the blade — strong and tough.",
    stats: { str: 16, dex: 11, con: 16, int: 9, wis: 11, cha: 10 }, hp: 26, start: ["mace", "vest"], ethos: "Order" },
  { id: "nominator", name: "Cleric", blurb: "Keeper of the faith — balanced and well-liked.",
    stats: { str: 12, dex: 13, con: 13, int: 11, wis: 12, cha: 15 }, hp: 22, start: ["heal"], ethos: "Balance" },
  { id: "cypherpunk", name: "Rogue", blurb: "Shadow and speed — quick, clever, unseen.",
    stats: { str: 10, dex: 16, con: 11, int: 15, wis: 12, cha: 8 }, hp: 18, start: ["ring_priv", "tele"], spell: "tele", ethos: "Chaos" },
  { id: "builder", name: "Wizard", blurb: "Weaver of spells — versatile and bright.",
    stats: { str: 11, dex: 12, con: 12, int: 16, wis: 13, cha: 11 }, hp: 20, start: ["book_map"], spell: "bolt", ethos: "Balance" },
  { id: "maximalist", name: "Barbarian", blurb: "A wild brute — raw might and fury.",
    stats: { str: 17, dex: 12, con: 16, int: 8, wis: 10, cha: 8 }, hp: 28, start: ["mace"], ethos: "Chaos" },
  { id: "watcher", name: "Ranger", blurb: "A keen-eyed hunter — strikes from range.",
    stats: { str: 12, dex: 16, con: 12, int: 11, wis: 13, cha: 9 }, hp: 20, start: ["dagger", "dagger"], ethos: "Balance" },
  { id: "solostaker", name: "Monk", blurb: "A disciplined ascetic — fights bare-handed, swift and serene.",
    stats: { str: 13, dex: 15, con: 13, int: 11, wis: 16, cha: 10 }, hp: 22, start: [], ethos: "Order" },
  { id: "auditor", name: "Archeologist", blurb: "A meticulous delver — armed with tools and insight.",
    stats: { str: 11, dex: 13, con: 12, int: 15, wis: 14, cha: 10 }, hp: 20, start: ["scope", "lamp", "pickaxe"], ethos: "Order" },
];

/** Ecosystem (NetHack race): a stat tweak + a starting intrinsic, on top of the chosen archetype. */
export interface Race { id: string; name: string; blurb: string; statMod: Partial<Record<Attr, number>>; intrinsics: string[]; }
export const RACES: Race[] = [
  { id: "substrate", name: "Human", blurb: "Balanced and adaptable — no innate gifts, no flaws.", statMod: {}, intrinsics: [] },
  { id: "evm",       name: "Elf",   blurb: "Quick and clever, a touch frail.", statMod: { dex: 2, int: 1, con: -1 }, intrinsics: [] },
  { id: "bitcoiner", name: "Dwarf", blurb: "A tough delver — unshakeable, can't be drained.", statMod: { con: 2, str: 1, dex: -1 }, intrinsics: ["drainResist"] },
  { id: "kusaman",   name: "Orc",   blurb: "War-forged — strong and poison-proof, but abrasive.", statMod: { str: 1, con: 1, cha: -2, int: -1 }, intrinsics: ["poisonResist"] },
  { id: "botnet",    name: "Gnome", blurb: "A clever little folk — sharp-witted and far-sensing, but slight.", statMod: { dex: 1, int: 1, str: -1, con: -1 }, intrinsics: ["telepathy"] },
];
export function raceById(id: string): Race { return RACES.find((r) => r.id === id) ?? RACES[0]; }
export function raceName(r: Race): string { return r.name; }
export function raceBlurb(r: Race): string { return r.blurb; }
export function archetypeById(id: string): Archetype { return ARCHETYPES.find((a) => a.id === id) ?? ARCHETYPES[0]; }
/** An archetype's class name + blurb, flavored. */
export function archetypeName(a: Archetype): string { return a.name; }
export function archetypeBlurb(a: Archetype): string { return a.blurb; }
/** Alignment label, flavored: fantasy uses the classic Lawful/Neutral/Chaotic. */
export function ethosName(e: string): string {
  return e === "Order" ? "Lawful" : e === "Chaos" ? "Chaotic" : "Neutral";
}

/** Per-archetype Quest (Phase 13c): a homeland portal, a nemesis, and your signature artifact. */
export interface Quest { homeland: string; portalDepth: number; artifactId: string; nemesis: MonsterDef; }
export const QUESTS: Record<string, Quest> = {
  validator: {
    homeland: "the Knight's Keep", portalDepth: 14, artifactId: "art_sceptre",
    nemesis: { name: "the Doppel-King", ch: "E", fg: "#ff6060", hp: 42, dmg: [5, 10], ai: "chase", minDepth: 99, weight: 0, boss: true, fearless: true, splits: true },
  },
  nominator: {
    homeland: "the Cleric's Sanctuary", portalDepth: 14, artifactId: "art_aegis",
    nemesis: { name: "the Glutton Lord", ch: "N", fg: "#e0a040", hp: 48, dmg: [5, 9], ai: "chase", minDepth: 99, weight: 0, boss: true, fearless: true, summons: true },
  },
  cypherpunk: {
    homeland: "the Rogue's Warren", portalDepth: 14, artifactId: "art_cipher",
    nemesis: { name: "the Eye Tyrant", ch: "U", fg: "#c060e0", hp: 40, dmg: [4, 8], ai: "chase", minDepth: 99, weight: 0, boss: true, fearless: true, ranged: true },
  },
  builder: {
    homeland: "the Wizard's Tower", portalDepth: 14, artifactId: "art_compiler",
    nemesis: { name: "the Tithe-Reaver", ch: "R", fg: "#e07030", hp: 44, dmg: [5, 9], ai: "chase", minDepth: 99, weight: 0, boss: true, fearless: true, steals: true },
  },
};
/** A quest's homeland name, flavored. */
export function questHomeland(q: Quest): string { return q.homeland; }
/** A monster's display name, flavored. */
export function monName(d: MonsterDef): string { return d.name; }
export function questFor(archetypeId: string): Quest { return QUESTS[archetypeId] ?? QUESTS.validator; }

// ── Phase 8: spellcasting ("extrinsics" cast from energy) ────────────────────
export interface Spell { id: string; name: string; cost: number; dir: boolean; school: string; }
export const SPELLS: Spell[] = [
  { id: "bolt",  name: "force bolt",       cost: 5, dir: true,  school: "attack" },
  { id: "heal",  name: "healing",          cost: 6, dir: false, school: "healing" },
  { id: "map",   name: "magic mapping",    cost: 7, dir: false, school: "divination" },
  { id: "sense", name: "detect monsters",  cost: 5, dir: false, school: "divination" },
  { id: "tele",  name: "teleport",         cost: 8, dir: false, school: "escape" },
  { id: "haste", name: "haste self",       cost: 7, dir: false, school: "enchantment" },
  { id: "fireball", name: "fireball",          cost: 9, dir: true,  school: "attack" },
  { id: "cure",  name: "cure sickness",     cost: 6, dir: false, school: "clerical" },
  { id: "detect", name: "detect treasure",   cost: 6, dir: false, school: "divination" },
  { id: "dig",   name: "dig",               cost: 7, dir: true,  school: "escape" },
  { id: "slow",  name: "slow monster",      cost: 5, dir: true,  school: "enchantment" },
  { id: "sleep", name: "sleep",             cost: 6, dir: true,  school: "enchantment" },
  { id: "turn",  name: "turn undead", cost: 7, dir: false, school: "clerical" },
  { id: "uncurse", name: "remove curse", cost: 8, dir: false, school: "clerical" },
  { id: "cryo",  name: "cone of cold",      cost: 8, dir: true,  school: "attack" },
  { id: "charm", name: "charm monster",     cost: 8, dir: true,  school: "enchantment" },
  { id: "clair", name: "clairvoyance",      cost: 7, dir: false, school: "divination" },
];
export function spellById(id: string): Spell | undefined { return SPELLS.find((s) => s.id === id); }
/** A spell's display name, flavored. */
export function spellName(s: Spell): string { return s.name; }

/** XCM destinations: each parachain branch scales difficulty + loot vs. the relay. */
// `layout` = the parachain's signature level generator, so each branch feels distinct.
export interface ChainDef { id: string; name: string; difficulty: number; loot: number; color: string; layout?: string; }
export const CHAINS: ChainDef[] = [
  { id: "kusama",    name: "the Wildlands",     difficulty: 1.6, loot: 1.6, color: "#e060d0", layout: "maze" }, // chaos, high risk/reward
  { id: "moonbeam",  name: "the Moonlit Keep",  difficulty: 1.3, loot: 1.4, color: "#53cbc9", layout: "grid" }, // an EVM contract-city
  { id: "astar",     name: "the Star Vault",    difficulty: 1.2, loot: 1.3, color: "#1b6dff", layout: "grid" },
  { id: "phala",     name: "the Shrouded Vale", difficulty: 1.1, loot: 1.2, color: "#cdfa50", layout: "maze" }, // privacy/compute — a dark labyrinth
  { id: "interlay",  name: "the Coinbridge",    difficulty: 1.0, loot: 1.5, color: "#f7931a", layout: "cave" }, // treasure caverns (BTC bridge)
  { id: "bifrost",   name: "Bifrost",          difficulty: 0.9, loot: 1.0, color: "#5a25f0", layout: "labyrinth" },
  { id: "hydration", name: "the Drowned Marsh", difficulty: 0.8, loot: 1.1, color: "#f6297c", layout: "swamp" }, // the Liquidity Pools — open water + islands
  { id: "acala",     name: "the Haven",         difficulty: 0.6, loot: 0.8, color: "#e40c5b", layout: "normal" }, // safe DeFi haven
];
/** A parachain/realm's display name, flavored. */
export function chainName(c: ChainDef): string { return c.name; }

/** A mandatory-feeling sub-dungeon branch off the main descent (NetHack's Mines/Sokoban).
 *  Unlike an XCM parachain it has a fixed run of floors entered by a branch-stair (not a portal),
 *  a floor-by-floor climb, and a guaranteed prize on its end floor. `dir` is which way it runs. */
export interface BranchDef extends ChainDef {
  branch: true;
  entryDepth: number; // the main-dungeon depth that hosts the branch-stair
  floors: number;     // how many floors deep the branch runs
  prizeId: string;    // the guaranteed reward on the end floor
  end: string;        // the themed name of the end floor ("the Storage Caverns' End")
  entryFlavor?: string; // override the entry message (e.g. the Vault "climbs up")
  sokoban?: boolean;  // hand-built boulder-puzzle floors (the Consensus Vault) instead of procedural
  upward?: boolean;   // a tower you climb (the Validator's Tower) — flips "deeper/up" wording
  bossDef?: MonsterDef; // a unique boss wards the End floor's prize (else a plain guardian)
  prizeEnchant?: number; // enchant the guaranteed End prize (a tower climax earns more than +0)
}
export const BRANCHES: BranchDef[] = [
  {
    id: "mines", name: "the Gnomish Mines", branch: true, difficulty: 1.15, loot: 1.6, color: "#c9a04a",
    layout: "cave", entryDepth: 5, floors: 3, prizeId: "hodlstone", end: "the Mines' End",
  }, // a DA/storage parachain rendered as treasure caverns; its End yields a luckstone-grade HODL stone
  {
    id: "vault", name: "Sokoban", branch: true, sokoban: true, difficulty: 0.5, loot: 0.5,
    color: "#7ad0c0", layout: "normal", entryDepth: 9, floors: 1, prizeId: "vault", end: "Sokoban's Prize",
    entryFlavor: "You squeeze up into Sokoban — a sealed puzzle of boulders and chasms. Shove the boulders into the pits; claim the prize at the top.",
  }, // a Sokoban-style boulder puzzle; clear it for a guaranteed multisig vault (bag of holding)
  {
    id: "tower", name: "Vlad's Tower", branch: true, upward: true,
    difficulty: 1.4, loot: 1.4, color: "#c04040", layout: "fortress", entryDepth: 16, floors: 3,
    prizeId: "plate", prizeEnchant: 2, end: "the Tower's Summit",
    entryFlavor: "You climb the winding stair into Vlad's Tower — a dread lord holds its summit.",
    bossDef: { name: "Vlad the Impaler", ch: "L", fg: "#e02020", hp: 72, dmg: [7, 13], ai: "chase", minDepth: 99, weight: 0, boss: true, fearless: true, muse: true },
  }, // a fortress tower you climb; its Lord wards a +2 blessed plate at the Crown
];
export function branchById(id: string): BranchDef | undefined { return BRANCHES.find((b) => b.id === id); }
/** A branch's end-floor name + entry flavor, flavored. */
export function branchEnd(b: BranchDef): string { return b.end; }
export function branchEntryFlavor(b: BranchDef): string | undefined { return b.entryFlavor; }

/** Realms deepen and grow chaotic — a nod to Polkadot → Kusama. */
export function realmName(depth: number): string {
  if (depth >= 48) return "Moloch's Sanctum";           // GEHENNOM_BOTTOM
  if (depth >= 26) return "Gehennom, the Dark Forest";  // below the foot of the relay
  if (depth >= 25) return "the Castle Gate";       // MAX_DEPTH — the vibrating square
  if (depth >= 18) return "the Deep Caverns";
  if (depth >= 9) return "the Dungeon Reaches";
  return "the Upper Dungeon";
}

const GRAY_PAPER_F = [
  "An old prophecy: 'A soul ascends when it bows to no master.'",
  "Descend the Dungeon of Doom to depth 12 — the Castle Gate. There, the",
  "vibrating square: perform the invocation, brave Gehennom, wrest the Amulet",
  "of Yendor from Moloch, then climb back and ASCEND.",
];
/** The opening prophecy, flavored. */
export function grayPaper(): string[] { return GRAY_PAPER_F; }

/** The scrolling splash intro — flavor-aware (fantasy vs Polkadot). Blank strings are beats/pauses. */
export function introStory(): string[] {
  return [
    "In the age before the long dark, one relic kept the realm in accord —",
    "the Amulet of Yendor, the heart of all order.",
    "",
    "It was torn from the light and dragged down into the deep,",
    "where the dungeon coiled into endless, treacherous halls.",
    "",
    "The old powers festered below, jealous of the surface world.",
    "One by one, heroes descended. None returned.",
    "",
    "Now the lot falls to you — and the hound that pads at your heel.",
    "",
    "Descend. Reclaim the Amulet. Climb back into the sun.",
  ];
}

export interface MonsterDef {
  name: string;        // polkadot flavor
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
  { name: "a doppelganger",  ch: "s", fg: "#9a9a9a", hp: 3,  dmg: [1, 2], ai: "chase",  minDepth: 1, weight: 4, splits: true, speed: 105, pack: [2, 4] },
  { name: "a rust monster",  ch: "x", fg: "#7ac06a", hp: 2,  dmg: [1, 1], ai: "wander", minDepth: 1, weight: 5, speed: 90, corrodes: true },
  { name: "a stone golem",   ch: "V", fg: "#5c8ad0", hp: 12, dmg: [2, 4], ai: "chase",  minDepth: 2, weight: 3, speed: 85, wears: true },
  { name: "a quickling",     ch: "f", fg: "#d0a0d0", hp: 7,  dmg: [2, 4], ai: "chase",  minDepth: 3, weight: 3, speed: 120, corpseEffect: "speed", pack: [2, 3] },
  { name: "a stench wraith", ch: "w", fg: "#c08adf", hp: 6,  dmg: [2, 3], ai: "chase",  minDepth: 3, weight: 3, inflict: "poison", corpseEffect: "poisonous" },
  { name: "a cockatrice",    ch: "c", fg: "#bcd6e6", hp: 10, dmg: [2, 4], ai: "chase",  minDepth: 4, weight: 2, corpseEffect: "petrify" },
  { name: "a treasure nymph", ch: "r", fg: "#d08040", hp: 5,  dmg: [3, 6], ai: "chase",  minDepth: 4, weight: 2, speed: 115, steals: true },
  { name: "a leprechaun",    ch: "l", fg: "#40d040", hp: 6,  dmg: [1, 3], ai: "chase",  minDepth: 3, weight: 2, speed: 120, stealsGold: true },
  { name: "a gremlin",       ch: "g", fg: "#5fb0b0", hp: 7,  dmg: [1, 3], ai: "chase",  minDepth: 5, weight: 2, speed: 110, stealsLuck: true, pack: [2, 3] },
  { name: "a floating eye",  ch: "e", fg: "#d8d040", hp: 14, dmg: [0, 0], ai: "chase",  minDepth: 4, weight: 2, speed: 60,  paralyzes: true },
  { name: "a confusion imp", ch: "i", fg: "#d05c5c", hp: 8,  dmg: [3, 5], ai: "chase",  minDepth: 4, weight: 2, inflict: "confuse", corpseEffect: "telepathy" },
  { name: "a hill giant",    ch: "O", fg: "#4090c0", hp: 24, dmg: [3, 6], ai: "chase",  minDepth: 5, weight: 2, speed: 60, throws: "rock" },
  { name: "a kobold archer", ch: "k", fg: "#c0a050", hp: 7,  dmg: [2, 4], ai: "chase",  minDepth: 3, weight: 2, speed: 110, throws: "dart", pack: [2, 3] },
  { name: "a barrow-wight",  ch: "W", fg: "#b6b0d4", hp: 16, dmg: [2, 4], ai: "chase",  minDepth: 6, weight: 2, speed: 90, drains: true, corpseEffect: "levelup" },
  { name: "a dark seer",     ch: "o", fg: "#e0c040", hp: 9,  dmg: [3, 6], ai: "chase",  minDepth: 5, weight: 2, ranged: true },
  { name: "a trapper",       ch: "t", fg: "#6ec0a0", hp: 20, dmg: [3, 6], ai: "chase",  minDepth: 6, weight: 2, speed: 80, engulfs: true },
  { name: "a berserker",     ch: "A", fg: "#e05050", hp: 16, dmg: [4, 8], ai: "chase",  minDepth: 6, weight: 2, speed: 110, inflict: "confuse" },
  { name: "a silence wraith", ch: "q", fg: "#8090a0", hp: 18, dmg: [2, 4], ai: "chase",  minDepth: 7, weight: 2, speed: 95, silences: true },
  { name: "a giant bat",     ch: "b", fg: "#80c060", hp: 6,  dmg: [2, 4], ai: "chase",  minDepth: 3, weight: 3, speed: 135, corpseEffect: "shock", pack: [2, 4] },
  { name: "a giant serpent", ch: "S", fg: "#e06060", hp: 14, dmg: [4, 8], ai: "chase",  minDepth: 5, weight: 2, muse: true },
  { name: "an eel",          ch: ";", fg: "#40a080", hp: 14, dmg: [4, 9], ai: "chase",  minDepth: 5, weight: 2, speed: 110 },
  { name: "a werewolf",      ch: "d", fg: "#c08040", hp: 18, dmg: [3, 6], ai: "chase",  minDepth: 6, weight: 2, speed: 110, infects: true, pack: [2, 3] },
  { name: "a summoner cultist", ch: "&", fg: "#c080e0", hp: 16, dmg: [2, 4], ai: "chase",  minDepth: 6, weight: 2, summons: true },
  { name: "a sorcerer",      ch: "H", fg: "#b060d0", hp: 18, dmg: [3, 6], ai: "chase",  minDepth: 7, weight: 2, zaps: "sleep" },
  { name: "a mind flayer",   ch: "u", fg: "#b060c0", hp: 20, dmg: [2, 5], ai: "chase",  minDepth: 8, weight: 2, speed: 95, drainsStat: true },
  { name: "an ancient dragon", ch: "D", fg: "#ff5040", hp: 34, dmg: [5, 9], ai: "chase",  minDepth: 6, weight: 1, breath: 16, fearless: true, corpseEffect: "fire" },
  { name: "a craven goblin", ch: "p", fg: "#d0d060", hp: 5,  dmg: [1, 3], ai: "chase",  minDepth: 2, weight: 3, cowardly: true },
  { name: "a soldier",       ch: "@", fg: "#a0a070", hp: 16, dmg: [3, 7], ai: "chase",  minDepth: 4, weight: 2, wears: true },
  { name: "a plague fly",    ch: "a", fg: "#9ac070", hp: 5,  dmg: [1, 3], ai: "chase",  minDepth: 4, weight: 2, speed: 120, diseases: true },
  { name: "a healer acolyte", ch: "h", fg: "#80e0c0", hp: 10, dmg: [1, 2], ai: "chase",  minDepth: 5, weight: 2, heals: true },
  { name: "a succubus",      ch: "n", fg: "#e080b0", hp: 12, dmg: [2, 4], ai: "chase",  minDepth: 6, weight: 2, speed: 105, seduces: true },
  { name: "a gremlin",       ch: "g", fg: "#90a070", hp: 4,  dmg: [1, 2], ai: "chase",  minDepth: 2, weight: 3, breeds: true },
  // ── bestiary breadth: rodents, humanoids, the shallow undead (turnable), thieves, slimes ──
  { name: "a sewer rat",     ch: "r", fg: "#a09070", hp: 3,  dmg: [1, 2], ai: "chase",  minDepth: 1, weight: 2, breeds: true },
  { name: "a kobold",        ch: "k", fg: "#90b070", hp: 5,  dmg: [1, 3], ai: "chase",  minDepth: 1, weight: 2 },
  { name: "a zombie",        ch: "z", fg: "#8090a0", hp: 8,  dmg: [2, 4], ai: "chase",  minDepth: 3, weight: 2 },
  { name: "a nymph",         ch: "n", fg: "#e0a0d0", hp: 10, dmg: [1, 3], ai: "chase",  minDepth: 4, weight: 2, steals: true },
  { name: "a green slime",   ch: "j", fg: "#90c060", hp: 12, dmg: [2, 5], ai: "chase",  minDepth: 5, weight: 2, corrodes: true },
  { name: "a mummy",         ch: "M", fg: "#c0b080", hp: 20, dmg: [3, 7], ai: "chase",  minDepth: 8, weight: 2 },
  // ── Gehennom demons (Phase 12c) — the Dark Forest's servants of centralization ──
  { name: "a dungeon fiend",  ch: "&", fg: "#c04040", hp: 22, dmg: [4, 8], ai: "chase", minDepth: 9,  weight: 2, steals: true, speed: 110 },
  { name: "a watcher wraith", ch: "W", fg: "#a060a0", hp: 18, dmg: [3, 6], ai: "chase", minDepth: 9,  weight: 2, inflict: "confuse", ranged: true },
  { name: "a warden demon",   ch: "P", fg: "#d05050", hp: 24, dmg: [4, 7], ai: "chase", minDepth: 9,  weight: 2, summons: true },
  { name: "a snatch imp",     ch: "j", fg: "#d0a040", hp: 12, dmg: [3, 5], ai: "chase", minDepth: 9,  weight: 3, steals: true, speed: 120 },
  { name: "a hellfire demon", ch: "X", fg: "#e03030", hp: 30, dmg: [5, 9], ai: "chase", minDepth: 10, weight: 2, breath: 14, fearless: true },
  // ── deep Gehennom (Phase 18) — the back half of the descent gets fresh terrors, not just scaled-up shallows ──
  { name: "an iron enforcer",   ch: "B", fg: "#d06030", hp: 34, dmg: [6, 10], ai: "chase", minDepth: 13, weight: 2, corrodes: true, speed: 85, muse: true },
  { name: "a deepwater horror", ch: "Y", fg: "#5060c0", hp: 30, dmg: [5, 9],  ai: "chase", minDepth: 15, weight: 2, ranged: true, inflict: "confuse", corpseEffect: "cold" },
  { name: "an arch-lich",       ch: "Z", fg: "#e02020", hp: 42, dmg: [6, 11], ai: "chase", minDepth: 17, weight: 1, summons: true, fearless: true, muse: true, zaps: "blind" },
  // ── rival adventurers (mplayer.c) — other ascendants who came for the JAM and never left; deep only ──
  { name: "a rogue",            ch: "@", fg: "#c0b070", hp: 40, dmg: [6, 11], ai: "chase", minDepth: 20, weight: 1, steals: true, muse: true, speed: 110 },
  { name: "a valkyrie",         ch: "@", fg: "#b8c8e8", hp: 48, dmg: [7, 12], ai: "chase", minDepth: 26, weight: 1, muse: true, throws: "dart", zaps: "sleep" },
  // ── the deep Gehennom apex — the last terrors before Moloch ──
  { name: "a titan",            ch: "H", fg: "#d0a850", hp: 44, dmg: [7, 12], ai: "chase", minDepth: 30, weight: 1, throws: "rock", speed: 90 },
  { name: "a minotaur",         ch: "H", fg: "#e05030", hp: 52, dmg: [8, 14], ai: "chase", minDepth: 34, weight: 1, speed: 110 },
  { name: "a death knight",     ch: "&", fg: "#c03030", hp: 50, dmg: [7, 13], ai: "chase", minDepth: 38, weight: 1, drains: true, fearless: true, muse: true, corpseEffect: "levelup" },
];

/** The Marketmaker — a bazaar shopkeeper. Peaceful while you pay; lethal if you shoplift. */
export const SHOPKEEPER: MonsterDef = {
  name: "the Shopkeeper", ch: "$", fg: "#e8c84a", hp: 54, dmg: [6, 11], ai: "chase", minDepth: 1, weight: 0, fearless: true, keeper: true,
};

/** A temple priest — peaceful keeper of a shrine's altar; turns lethal if struck or robbed. */
export const PRIEST: MonsterDef = {
  name: "the temple priest", ch: "@", fg: "#d6d0f4", hp: 30, dmg: [4, 8], ai: "chase", minDepth: 1, weight: 0, fearless: true, priest: true,
};

/** The Oracle — a peaceful seer in a spring-ringed chamber; #chat (with coin) for a consultation. */
export const ORACLE: MonsterDef = {
  name: "the Oracle", ch: "@", fg: "#c060e0", hp: 32, dmg: [4, 8], ai: "chase", minDepth: 1, weight: 0, fearless: true, seer: true,
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
  name: "the Vault Guard", ch: "@", fg: "#d0c060", hp: 60, dmg: [6, 12], ai: "chase", minDepth: 1, weight: 0, fearless: true, guard: true,
};

/** An Astral high priest — each Genesis altar is warded by one of these clerical guardians. */
export const HIGH_PRIEST: MonsterDef = {
  name: "a high priest", ch: "@", fg: "#fff0c0", hp: 56, dmg: [7, 13], ai: "chase", minDepth: 99, weight: 0, fearless: true, summons: true, breath: 12,
};

/** The honeypot — a mimic. Spawned separately (placeMimics), disguised as loot. */
export const HONEYPOT: MonsterDef = {
  name: "a mimic", ch: "m", fg: "#e0b020", hp: 16, dmg: [3, 7], ai: "chase", minDepth: 3, weight: 0, mimic: true, speed: 90,
};

/** The Censor — high keeper of the vibrating square at the foot of the relay (MAX_DEPTH). */
export const CENSOR: MonsterDef = {
  name: "THE WARDEN", ch: "C", fg: "#ff3b3b", hp: 48, dmg: [6, 11], ai: "chase", minDepth: 99, weight: 0, fearless: true,
};

/** MOLOCH, the Central Planner — the final tyrant who hoards the JAM at the bottom of Gehennom. */
export const MOLOCH: MonsterDef = {
  name: "MOLOCH, the Dark Lord", ch: "&", fg: "#ff2020", hp: 80, dmg: [8, 14], ai: "chase", minDepth: 99, weight: 0, fearless: true, boss: true, summons: true, breath: 20,
};

/** Realm mini-bosses — one guards a specific depth and drops a prize when slain. */
export const MINIBOSSES: Record<number, MonsterDef> = {
  8:  { name: "the Mirror Fiend", ch: "F", fg: "#ff80ff", hp: 30, dmg: [4, 7], ai: "chase", minDepth: 99, weight: 0, boss: true, splits: true },
  18: { name: "the Iron Warden",  ch: "K", fg: "#ffd040", hp: 44, dmg: [5, 9], ai: "chase", minDepth: 99, weight: 0, boss: true, speed: 90 },
};

const DEATHS_F = [
  "You die.",
  "Death claims you — but not as you'd hoped.",
  "The dungeon swallows you whole.",
  "Cut down to nothing.",
  "Cast into oblivion.",
];
/** Death epitaphs, flavored. */
export function deaths(): string[] { return DEATHS_F; }

const GREETINGS_F = [
  "You descend into the dungeon. Recover the Amulet of Yendor, and ascend.",
  "The dungeon breathes an ancient dread. Hold to your purpose.",
  "Welcome, Seeker. The old prophecy says: trust no master.",
];
/** Opening greetings, flavored. */
export function greetings(): string[] { return GREETINGS_F; }
