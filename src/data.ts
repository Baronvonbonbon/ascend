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

export type TileType = "wall" | "floor" | "door" | "doorClosed" | "doorLocked" | "doorHidden" | "stairsDown" | "stairsUp" | "altar" | "portal" | "faucet" | "throne" | "sink" | "vibrating" | "water" | "branchDown" | "pit";

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
};

export const MAX_DEPTH = 12; // the foot of the relay — the vibrating square; the Invocation opens Gehennom below

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
];
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
    homeland: "the Validator's Vault", fhomeland: "the Knight's Keep", portalDepth: 6, artifactId: "art_sceptre",
    nemesis: { name: "the Equivocator", fname: "the Doppel-King", ch: "E", fg: "#ff6060", hp: 42, dmg: [5, 10], ai: "chase", minDepth: 99, weight: 0, boss: true, fearless: true, splits: true },
  },
  nominator: {
    homeland: "the Bonding Hall", fhomeland: "the Cleric's Sanctuary", portalDepth: 6, artifactId: "art_aegis",
    nemesis: { name: "the Oversubscriber", fname: "the Glutton Lord", ch: "N", fg: "#e0a040", hp: 48, dmg: [5, 9], ai: "chase", minDepth: 99, weight: 0, boss: true, fearless: true, summons: true },
  },
  cypherpunk: {
    homeland: "the Panopticon", fhomeland: "the Rogue's Warren", portalDepth: 6, artifactId: "art_cipher",
    nemesis: { name: "the Surveillor", fname: "the Eye Tyrant", ch: "U", fg: "#c060e0", hp: 40, dmg: [4, 8], ai: "chase", minDepth: 99, weight: 0, boss: true, fearless: true, ranged: true },
  },
  builder: {
    homeland: "the Rent Foundry", fhomeland: "the Wizard's Tower", portalDepth: 6, artifactId: "art_compiler",
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
}
export const BRANCHES: BranchDef[] = [
  {
    id: "mines", name: "the Storage Caverns", fname: "the Gnomish Mines", branch: true, difficulty: 1.15, loot: 1.6, color: "#c9a04a",
    layout: "cave", entryDepth: 3, floors: 3, prizeId: "hodlstone", end: "the Storage Caverns' End", fend: "the Mines' End",
  }, // a DA/storage parachain rendered as treasure caverns; its End yields a luckstone-grade HODL stone
  {
    id: "vault", name: "the Consensus Vault", fname: "Sokoban", branch: true, sokoban: true, difficulty: 0.5, loot: 0.5,
    color: "#7ad0c0", layout: "normal", entryDepth: 4, floors: 1, prizeId: "vault", end: "the Vault's Crown", fend: "Sokoban's Prize",
    entryFlavor: "You squeeze up into the Consensus Vault — a sealed puzzle of blocks and chasms. Shove the blocks into the gaps; claim the prize at the top.",
    fentryFlavor: "You squeeze up into Sokoban — a sealed puzzle of boulders and chasms. Shove the boulders into the pits; claim the prize at the top.",
  }, // a Sokoban-style boulder puzzle; clear it for a guaranteed multisig vault (bag of holding)
];
export function branchById(id: string): BranchDef | undefined { return BRANCHES.find((b) => b.id === id); }
/** A branch's end-floor name + entry flavor, flavored. */
export function branchEnd(b: BranchDef): string { return getFlavor() === "fantasy" ? (b.fend ?? b.end) : b.end; }
export function branchEntryFlavor(b: BranchDef): string | undefined { return getFlavor() === "fantasy" ? (b.fentryFlavor ?? b.entryFlavor) : b.entryFlavor; }

/** Realms deepen and grow chaotic — a nod to Polkadot → Kusama. */
export function realmName(depth: number): string {
  if (depth >= 20) return fp("Moloch's Sanctum", "Moloch's Sanctum");           // GEHENNOM_BOTTOM
  if (depth >= 13) return fp("Gehennom, the Dark Forest", "Gehennom, the Dark Forest");  // below the foot of the relay
  if (depth >= 12) return fp("the Castle Gate", "the Foot of the Relay");       // MAX_DEPTH — the vibrating square
  if (depth >= 9) return fp("the Deep Caverns", "the Kusama Deeps");
  if (depth >= 5) return fp("the Dungeon Reaches", "the Parachain Reaches");
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
  speed?: number;        // turn speed (100 = normal; higher acts more often)
  inflict?: "poison" | "confuse"; // status applied on a hit (30% chance)
  ranged?: boolean;      // fires at the player from a distance with line-of-sight
  breath?: number;       // a dragon-style breath ray (max damage) down a line
  summons?: boolean;     // conjures more monsters
  cowardly?: boolean;    // flees once badly hurt
  heals?: boolean;       // a medic — mends wounded allies instead of fighting
  breeds?: boolean;      // multiplies when a pair of its kind is adjacent
  corpseEffect?: "poisonous" | "petrify" | "speed" | "telepathy"; // what eating its corpse does
  corrodes?: boolean;    // its touch rusts/corrodes a worn armor piece
  steals?: boolean;      // a thief — snatches a pack item and flees (the rug pull)
  stealsGold?: boolean;  // an airdrop farmer (leprechaun) — snatches gold and blinks away
  stealsLuck?: boolean;  // a doubt gremlin — leeches your Fortune (Luck) on a hit
  mimic?: boolean;       // a honeypot — sits disguised as loot, strikes when touched
  fearless?: boolean;    // ignores warding engravings (bosses fear no Gray Paper)
  keeper?: boolean;      // a shopkeeper — peaceful until you shoplift, then merciless
  priest?: boolean;      // a temple priest — peaceful guardian of an altar; turns lethal if struck
  boss?: boolean;        // a unique mini-boss — drops a guaranteed prize on death
}

// Themed bestiary — the centralised legacy stack fights back.
export const MONSTERS: MonsterDef[] = [
  { name: "a sybil",           fname: "a doppelganger",  ch: "s", fg: "#9a9a9a", hp: 3,  dmg: [1, 2], ai: "chase",  minDepth: 1, weight: 4, splits: true, speed: 105 },
  { name: "a rust bug",        fname: "a rust monster",  ch: "x", fg: "#7ac06a", hp: 2,  dmg: [1, 1], ai: "wander", minDepth: 1, weight: 5, speed: 90, corrodes: true },
  { name: "a validator golem", fname: "a stone golem",   ch: "V", fg: "#5c8ad0", hp: 12, dmg: [2, 4], ai: "chase",  minDepth: 2, weight: 3, speed: 85 },
  { name: "a fork daemon",     fname: "a quickling",     ch: "f", fg: "#d0a0d0", hp: 7,  dmg: [2, 4], ai: "chase",  minDepth: 3, weight: 3, speed: 120, corpseEffect: "speed" },
  { name: "a gas wraith",      fname: "a stench wraith", ch: "w", fg: "#c08adf", hp: 6,  dmg: [2, 3], ai: "chase",  minDepth: 3, weight: 3, inflict: "poison", corpseEffect: "poisonous" },
  { name: "a freezer",         fname: "a cockatrice",    ch: "c", fg: "#bcd6e6", hp: 10, dmg: [2, 4], ai: "chase",  minDepth: 4, weight: 2, corpseEffect: "petrify" },
  { name: "a rug puller",      fname: "a treasure nymph", ch: "r", fg: "#d08040", hp: 5,  dmg: [3, 6], ai: "chase",  minDepth: 4, weight: 2, speed: 115, steals: true },
  { name: "an airdrop farmer", fname: "a leprechaun",    ch: "l", fg: "#40d040", hp: 6,  dmg: [1, 3], ai: "chase",  minDepth: 3, weight: 2, speed: 120, stealsGold: true },
  { name: "a doubt gremlin",   fname: "a gremlin",       ch: "g", fg: "#5fb0b0", hp: 7,  dmg: [1, 3], ai: "chase",  minDepth: 5, weight: 2, speed: 110, stealsLuck: true },
  { name: "a censor imp",      fname: "a confusion imp", ch: "i", fg: "#d05c5c", hp: 8,  dmg: [3, 5], ai: "chase",  minDepth: 4, weight: 2, inflict: "confuse", corpseEffect: "telepathy" },
  { name: "a whale",           fname: "a hill giant",    ch: "O", fg: "#4090c0", hp: 24, dmg: [3, 6], ai: "chase",  minDepth: 5, weight: 2, speed: 60 },
  { name: "an oracle",         fname: "a dark seer",     ch: "o", fg: "#e0c040", hp: 9,  dmg: [3, 6], ai: "chase",  minDepth: 5, weight: 2, ranged: true },
  { name: "a 51% attacker",    fname: "a berserker",     ch: "A", fg: "#e05050", hp: 16, dmg: [4, 8], ai: "chase",  minDepth: 6, weight: 2, speed: 110, inflict: "confuse" },
  { name: "a MEV bot",         fname: "a giant bat",     ch: "b", fg: "#80c060", hp: 6,  dmg: [2, 4], ai: "chase",  minDepth: 3, weight: 3, speed: 135 },
  { name: "a slashing daemon", fname: "a giant serpent", ch: "S", fg: "#e06060", hp: 14, dmg: [4, 8], ai: "chase",  minDepth: 5, weight: 2 },
  { name: "a sudo conjurer",   fname: "a summoner cultist", ch: "&", fg: "#c080e0", hp: 16, dmg: [2, 4], ai: "chase",  minDepth: 6, weight: 2, summons: true },
  { name: "a finality dragon", fname: "an ancient dragon", ch: "D", fg: "#ff5040", hp: 34, dmg: [5, 9], ai: "chase",  minDepth: 6, weight: 1, breath: 16, fearless: true },
  { name: "a panic seller",    fname: "a craven goblin", ch: "p", fg: "#d0d060", hp: 5,  dmg: [1, 3], ai: "chase",  minDepth: 2, weight: 3, cowardly: true },
  { name: "a relay medic",     fname: "a healer acolyte", ch: "h", fg: "#80e0c0", hp: 10, dmg: [1, 2], ai: "chase",  minDepth: 5, weight: 2, heals: true },
  { name: "a dust gremlin",    fname: "a gremlin",       ch: "g", fg: "#90a070", hp: 4,  dmg: [1, 2], ai: "chase",  minDepth: 2, weight: 3, breeds: true },
  // ── Gehennom demons (Phase 12c) — the Dark Forest's servants of centralization ──
  { name: "a custodian fiend",   fname: "a dungeon fiend",  ch: "&", fg: "#c04040", hp: 22, dmg: [4, 8], ai: "chase", minDepth: 9,  weight: 2, steals: true, speed: 110 },
  { name: "a KYC wraith",        fname: "a watcher wraith", ch: "W", fg: "#a060a0", hp: 18, dmg: [3, 6], ai: "chase", minDepth: 9,  weight: 2, inflict: "confuse", ranged: true },
  { name: "a permission daemon", fname: "a warden demon",   ch: "P", fg: "#d05050", hp: 24, dmg: [4, 7], ai: "chase", minDepth: 9,  weight: 2, summons: true },
  { name: "a rent-seeker imp",   fname: "a snatch imp",     ch: "j", fg: "#d0a040", hp: 12, dmg: [3, 5], ai: "chase", minDepth: 9,  weight: 3, steals: true, speed: 120 },
  { name: "a censorship demon",  fname: "a hellfire demon", ch: "X", fg: "#e03030", hp: 30, dmg: [5, 9], ai: "chase", minDepth: 10, weight: 2, breath: 14, fearless: true },
  // ── deep Gehennom (Phase 18) — the back half of the descent gets fresh terrors, not just scaled-up shallows ──
  { name: "a cartel enforcer",   fname: "an iron enforcer",   ch: "B", fg: "#d06030", hp: 34, dmg: [6, 10], ai: "chase", minDepth: 13, weight: 2, corrodes: true, speed: 85 },
  { name: "a darkpool kraken",   fname: "a deepwater horror", ch: "Y", fg: "#5060c0", hp: 30, dmg: [5, 9],  ai: "chase", minDepth: 15, weight: 2, ranged: true, inflict: "confuse" },
  { name: "a sovereign daemon",  fname: "an arch-lich",       ch: "Z", fg: "#e02020", hp: 42, dmg: [6, 11], ai: "chase", minDepth: 17, weight: 1, summons: true, fearless: true, breath: 16 },
];

/** The Marketmaker — a bazaar shopkeeper. Peaceful while you pay; lethal if you shoplift. */
export const SHOPKEEPER: MonsterDef = {
  name: "the Marketmaker", fname: "the Shopkeeper", ch: "$", fg: "#e8c84a", hp: 54, dmg: [6, 11], ai: "chase", minDepth: 1, weight: 0, fearless: true, keeper: true,
};

/** A temple priest — peaceful keeper of a shrine's altar; turns lethal if struck or robbed. */
export const PRIEST: MonsterDef = {
  name: "the Gavin priest", fname: "the temple priest", ch: "@", fg: "#d6d0f4", hp: 30, dmg: [4, 8], ai: "chase", minDepth: 1, weight: 0, fearless: true, priest: true,
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
  3: { name: "the Forkmaster", fname: "the Mirror Fiend", ch: "F", fg: "#ff80ff", hp: 30, dmg: [4, 7], ai: "chase", minDepth: 99, weight: 0, boss: true, splits: true },
  6: { name: "the Sudo Key",   fname: "the Iron Warden",  ch: "K", fg: "#ffd040", hp: 44, dmg: [5, 9], ai: "chase", minDepth: 99, weight: 0, boss: true, speed: 90 },
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
