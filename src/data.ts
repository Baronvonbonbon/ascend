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

export type TileType = "wall" | "floor" | "door" | "stairsDown";

export const TILE_GLYPH: Record<TileType, { ch: string; fg: string; fgDim: string }> = {
  wall:       { ch: "#", fg: COLORS.wall,   fgDim: COLORS.wallDim },
  floor:      { ch: "·", fg: COLORS.floor,  fgDim: COLORS.floorDim },
  door:       { ch: "+", fg: COLORS.door,   fgDim: "#5a4520" },
  stairsDown: { ch: ">", fg: COLORS.stairs, fgDim: "#6a5a28" },
};

export interface MonsterDef {
  name: string;
  ch: string;
  fg: string;
  hp: number;
  dmg: [number, number]; // inclusive min..max
  ai: "chase" | "wander";
  minDepth: number;
  weight: number; // spawn weight
}

// First themed bestiary — the centralised legacy stack fights back.
export const MONSTERS: MonsterDef[] = [
  { name: "a swarm of sybils", ch: "s", fg: "#9a9a9a", hp: 3,  dmg: [1, 2], ai: "chase",  minDepth: 1, weight: 6 },
  { name: "a rust bug",        ch: "x", fg: "#7ac06a", hp: 2,  dmg: [1, 1], ai: "wander", minDepth: 1, weight: 5 },
  { name: "a validator golem", ch: "V", fg: "#5c8ad0", hp: 12, dmg: [2, 4], ai: "chase",  minDepth: 2, weight: 3 },
  { name: "a gas wraith",      ch: "w", fg: "#c08adf", hp: 6,  dmg: [2, 3], ai: "chase",  minDepth: 3, weight: 3 },
  { name: "a censor imp",      ch: "i", fg: "#d05c5c", hp: 8,  dmg: [3, 5], ai: "chase",  minDepth: 4, weight: 2 },
];

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
