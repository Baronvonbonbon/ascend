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

export type TileType = "wall" | "floor" | "door" | "stairsDown" | "stairsUp" | "altar" | "portal";

export const TILE_GLYPH: Record<TileType, { ch: string; fg: string; fgDim: string }> = {
  wall:       { ch: "#", fg: COLORS.wall,   fgDim: COLORS.wallDim },
  floor:      { ch: "·", fg: COLORS.floor,  fgDim: COLORS.floorDim },
  door:       { ch: "+", fg: COLORS.door,   fgDim: "#5a4520" },
  stairsDown: { ch: ">", fg: COLORS.stairs, fgDim: "#6a5a28" },
  stairsUp:   { ch: "<", fg: COLORS.stairs, fgDim: "#6a5a28" },
  altar:      { ch: "_", fg: "#c0d0e0",     fgDim: "#4a5560" },
  portal:     { ch: "Ω", fg: "#e060d0",     fgDim: "#6a3060" },
};

export const MAX_DEPTH = 8; // the JAM lies on the deepest floor

// ── Phase 6: the character sheet ─────────────────────────────────────────────
/** The six attributes, Polkadot-flavored. Stored 3–18; modifier is D&D-style. */
export const ATTRS = ["str", "dex", "con", "int", "wis", "cha"] as const;
export type Attr = (typeof ATTRS)[number];
export const ATTR_LABEL: Record<Attr, string> = { str: "STR", dex: "DEX", con: "CON", int: "INT", wis: "WIS", cha: "CHA" };
export const ATTR_FLAVOR: Record<Attr, string> = {
  str: "Stake-weight", dex: "Latency", con: "Resilience", int: "Throughput", wis: "Insight", cha: "Reputation",
};
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
  { id: "validator", name: "Validator", blurb: "Secures the chain — strong and tough.",
    stats: { str: 16, dex: 11, con: 16, int: 9, wis: 11, cha: 10 }, hp: 26, start: ["mace", "vest"], ethos: "Order" },
  { id: "nominator", name: "Nominator", blurb: "Backs validators — balanced and well-liked.",
    stats: { str: 12, dex: 13, con: 13, int: 11, wis: 12, cha: 15 }, hp: 22, start: ["heal"], ethos: "Balance" },
  { id: "cypherpunk", name: "Cypherpunk", blurb: "Privacy and speed — quick, clever, unseen.",
    stats: { str: 10, dex: 16, con: 11, int: 15, wis: 12, cha: 8 }, hp: 18, start: ["ring_priv", "tele"], spell: "tele", ethos: "Chaos" },
  { id: "builder", name: "Builder", blurb: "Ships primitives — versatile and bright.",
    stats: { str: 11, dex: 12, con: 12, int: 16, wis: 13, cha: 11 }, hp: 20, start: ["book_map"], spell: "bolt", ethos: "Balance" },
];
export function archetypeById(id: string): Archetype { return ARCHETYPES.find((a) => a.id === id) ?? ARCHETYPES[0]; }

// ── Phase 8: spellcasting ("extrinsics" cast from energy) ────────────────────
export interface Spell { id: string; name: string; cost: number; dir: boolean; school: string; }
export const SPELLS: Spell[] = [
  { id: "bolt",  name: "finality bolt", cost: 5, dir: true,  school: "attack" },
  { id: "heal",  name: "self-mend",     cost: 6, dir: false, school: "healing" },
  { id: "map",   name: "light client",  cost: 7, dir: false, school: "divination" },
  { id: "sense", name: "sense minds",   cost: 5, dir: false, school: "divination" },
  { id: "tele",  name: "XCM jump",      cost: 8, dir: false, school: "escape" },
  { id: "haste", name: "overclock",     cost: 7, dir: false, school: "enchantment" },
];
export function spellById(id: string): Spell | undefined { return SPELLS.find((s) => s.id === id); }

/** XCM destinations: each parachain branch scales difficulty + loot vs. the relay. */
export interface ChainDef { id: string; name: string; difficulty: number; loot: number; color: string; }
export const CHAINS: ChainDef[] = [
  { id: "kusama",    name: "Kusama",    difficulty: 1.6, loot: 1.6, color: "#e060d0" }, // chaos, high risk/reward
  { id: "moonbeam",  name: "Moonbeam",  difficulty: 1.3, loot: 1.4, color: "#53cbc9" },
  { id: "astar",     name: "Astar",     difficulty: 1.2, loot: 1.3, color: "#1b6dff" },
  { id: "phala",     name: "Phala",     difficulty: 1.1, loot: 1.2, color: "#cdfa50" }, // privacy/compute
  { id: "interlay",  name: "Interlay",  difficulty: 1.0, loot: 1.5, color: "#f7931a" }, // treasure (BTC bridge)
  { id: "bifrost",   name: "Bifrost",   difficulty: 0.9, loot: 1.0, color: "#5a25f0" },
  { id: "hydration", name: "Hydration", difficulty: 0.8, loot: 1.1, color: "#f6297c" }, // calmer, liquid loot
  { id: "acala",     name: "Acala",     difficulty: 0.6, loot: 0.8, color: "#e40c5b" }, // safe DeFi haven
];

/** Realms deepen and grow chaotic — a nod to Polkadot → Kusama. */
export function realmName(depth: number): string {
  if (depth >= 7) return "the Kusama Deeps";
  if (depth >= 4) return "the Parachain Reaches";
  return "the Legacy Stack";
}

export const GRAY_PAPER = [
  "From the Gray Paper: 'A chain ascends when it needs no master.'",
  "Descend the Dungeon of Doom to depth 8. There lies the JAM — the artifact",
  "of trustless finality. Take it, then climb back and ASCEND.",
];

export interface MonsterDef {
  name: string;
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
  corpseEffect?: "poisonous" | "petrify" | "speed" | "telepathy"; // what eating its corpse does
  corrodes?: boolean;    // its touch rusts/corrodes a worn armor piece
  steals?: boolean;      // a thief — snatches a pack item and flees (the rug pull)
  mimic?: boolean;       // a honeypot — sits disguised as loot, strikes when touched
  fearless?: boolean;    // ignores warding engravings (bosses fear no Gray Paper)
  keeper?: boolean;      // a shopkeeper — peaceful until you shoplift, then merciless
  boss?: boolean;        // a unique mini-boss — drops a guaranteed prize on death
}

// Themed bestiary — the centralised legacy stack fights back.
export const MONSTERS: MonsterDef[] = [
  { name: "a sybil",           ch: "s", fg: "#9a9a9a", hp: 3,  dmg: [1, 2], ai: "chase",  minDepth: 1, weight: 4, splits: true, speed: 105 },
  { name: "a rust bug",        ch: "x", fg: "#7ac06a", hp: 2,  dmg: [1, 1], ai: "wander", minDepth: 1, weight: 5, speed: 90, corrodes: true },
  { name: "a validator golem", ch: "V", fg: "#5c8ad0", hp: 12, dmg: [2, 4], ai: "chase",  minDepth: 2, weight: 3, speed: 85 },
  { name: "a fork daemon",     ch: "f", fg: "#d0a0d0", hp: 7,  dmg: [2, 4], ai: "chase",  minDepth: 3, weight: 3, speed: 120, corpseEffect: "speed" },
  { name: "a gas wraith",      ch: "w", fg: "#c08adf", hp: 6,  dmg: [2, 3], ai: "chase",  minDepth: 3, weight: 3, inflict: "poison", corpseEffect: "poisonous" },
  { name: "a freezer",         ch: "c", fg: "#bcd6e6", hp: 10, dmg: [2, 4], ai: "chase",  minDepth: 4, weight: 2, corpseEffect: "petrify" },
  { name: "a rug puller",      ch: "r", fg: "#d08040", hp: 5,  dmg: [3, 6], ai: "chase",  minDepth: 4, weight: 2, speed: 115, steals: true },
  { name: "a censor imp",      ch: "i", fg: "#d05c5c", hp: 8,  dmg: [3, 5], ai: "chase",  minDepth: 4, weight: 2, inflict: "confuse", corpseEffect: "telepathy" },
  { name: "a whale",           ch: "O", fg: "#4090c0", hp: 24, dmg: [3, 6], ai: "chase",  minDepth: 5, weight: 2, speed: 60 },
  { name: "an oracle",         ch: "o", fg: "#e0c040", hp: 9,  dmg: [3, 6], ai: "chase",  minDepth: 5, weight: 2, ranged: true },
  { name: "a 51% attacker",    ch: "A", fg: "#e05050", hp: 16, dmg: [4, 8], ai: "chase",  minDepth: 6, weight: 2, speed: 110, inflict: "confuse" },
];

/** The Marketmaker — a bazaar shopkeeper. Peaceful while you pay; lethal if you shoplift. */
export const SHOPKEEPER: MonsterDef = {
  name: "the Marketmaker", ch: "$", fg: "#e8c84a", hp: 54, dmg: [6, 11], ai: "chase", minDepth: 1, weight: 0, fearless: true, keeper: true,
};

/** The honeypot — a mimic. Spawned separately (placeMimics), disguised as loot. */
export const HONEYPOT: MonsterDef = {
  name: "a honeypot", ch: "m", fg: "#e0b020", hp: 16, dmg: [3, 7], ai: "chase", minDepth: 3, weight: 0, mimic: true, speed: 90,
};

/** The Censor — a unique boss guarding the JAM on the deepest floor. */
export const CENSOR: MonsterDef = {
  name: "THE CENSOR", ch: "C", fg: "#ff3b3b", hp: 48, dmg: [6, 11], ai: "chase", minDepth: 99, weight: 0, fearless: true,
};

/** Realm mini-bosses — one guards a specific depth and drops a prize when slain. */
export const MINIBOSSES: Record<number, MonsterDef> = {
  3: { name: "the Forkmaster", ch: "F", fg: "#ff80ff", hp: 30, dmg: [4, 7], ai: "chase", minDepth: 99, weight: 0, boss: true, splits: true },
  6: { name: "the Sudo Key",   ch: "K", fg: "#ffd040", hp: 44, dmg: [5, 9], ai: "chase", minDepth: 99, weight: 0, boss: true, speed: 90 },
};

export const DEATHS = [
  "Your stack overflowed.",
  "Finalised — but not as you'd hoped.",
  "The chain forked you off.",
  "Slashed to nothing.",
  "Reorged into oblivion.",
];

export const GREETINGS = [
  "You descend into the legacy stack. Recover the JAM, and ascend.",
  "The dungeon hums with centralised dread. Stay independent.",
  "Welcome, Seeker. The Gray Paper says: trust no single node.",
];
