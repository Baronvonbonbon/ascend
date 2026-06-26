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
}

// Themed bestiary — the centralised legacy stack fights back.
export const MONSTERS: MonsterDef[] = [
  { name: "a sybil",           ch: "s", fg: "#9a9a9a", hp: 3,  dmg: [1, 2], ai: "chase",  minDepth: 1, weight: 6, splits: true, speed: 130 },
  { name: "a rust bug",        ch: "x", fg: "#7ac06a", hp: 2,  dmg: [1, 1], ai: "wander", minDepth: 1, weight: 5, speed: 90 },
  { name: "a validator golem", ch: "V", fg: "#5c8ad0", hp: 12, dmg: [2, 4], ai: "chase",  minDepth: 2, weight: 3, speed: 85 },
  { name: "a fork daemon",     ch: "f", fg: "#d0a0d0", hp: 7,  dmg: [2, 4], ai: "chase",  minDepth: 3, weight: 3, speed: 120 },
  { name: "a gas wraith",      ch: "w", fg: "#c08adf", hp: 6,  dmg: [2, 3], ai: "chase",  minDepth: 3, weight: 3, inflict: "poison" },
  { name: "a rug puller",      ch: "r", fg: "#d08040", hp: 5,  dmg: [3, 6], ai: "chase",  minDepth: 4, weight: 2, speed: 115 },
  { name: "a censor imp",      ch: "i", fg: "#d05c5c", hp: 8,  dmg: [3, 5], ai: "chase",  minDepth: 4, weight: 2, inflict: "confuse" },
  { name: "a whale",           ch: "O", fg: "#4090c0", hp: 24, dmg: [3, 6], ai: "chase",  minDepth: 5, weight: 2, speed: 60 },
  { name: "a 51% attacker",    ch: "A", fg: "#e05050", hp: 16, dmg: [4, 8], ai: "chase",  minDepth: 6, weight: 2, speed: 110, inflict: "confuse" },
];

/** The Censor — a unique boss guarding the JAM on the deepest floor. */
export const CENSOR: MonsterDef = {
  name: "THE CENSOR", ch: "C", fg: "#ff3b3b", hp: 48, dmg: [6, 11], ai: "chase", minDepth: 99, weight: 0,
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
