// Items, themed appearances, and the identification system.

import * as ROT from "rot-js";

export type ItemKind = "weapon" | "armor" | "food" | "potion" | "scroll" | "amulet";

/** The JAM — the Amulet of Yendor of this world. Unique; never randomly spawned. */
export const JAM: ItemType = { id: "jam", kind: "amulet", name: "the JAM", ch: "*", fg: "#f4e89a", weight: 0 };

export interface ItemType {
  id: string;
  kind: ItemKind;
  name: string;            // identified name
  ch: string;
  fg: string;
  dmg?: [number, number];  // weapon
  ac?: number;             // armor (flat damage reduction)
  nutrition?: number;      // food
  effect?: EffectId;       // potion / scroll
  weight: number;          // spawn weight
}

export type EffectId = "heal" | "harm" | "strength" | "teleport" | "map" | "identify" | "enchant";

export const ITEMS: ItemType[] = [
  // ── weapons ── )
  { id: "dagger", kind: "weapon", name: "a debug dagger",      ch: ")", fg: "#cfcf9a", dmg: [2, 4], weight: 5 },
  { id: "sword",  kind: "weapon", name: "a consensus sword",   ch: ")", fg: "#dfe6f0", dmg: [3, 6], weight: 3 },
  { id: "mace",   kind: "weapon", name: "a validator's mace",  ch: ")", fg: "#c0a060", dmg: [4, 9], weight: 2 },
  // ── armor ── [
  { id: "vest",   kind: "armor",  name: "a firewall vest",     ch: "[", fg: "#9ac0c0", ac: 1, weight: 5 },
  { id: "cloak",  kind: "armor",  name: "a ZK cloak",          ch: "[", fg: "#b09adf", ac: 2, weight: 3 },
  { id: "plate",  kind: "armor",  name: "validator plate",     ch: "[", fg: "#8aa0d0", ac: 3, weight: 2 },
  // ── food ── %
  { id: "ration", kind: "food",   name: "a ration of cycles",  ch: "%", fg: "#c0a050", nutrition: 600, weight: 5 },
  { id: "crumb",  kind: "food",   name: "a stale block",       ch: "%", fg: "#8a7a40", nutrition: 220, weight: 4 },
  // ── potions ── ! (appearance randomised per game)
  { id: "heal",   kind: "potion", name: "a potion of finality", ch: "!", fg: "#76c66a", effect: "heal",     weight: 5 },
  { id: "harm",   kind: "potion", name: "a potion of reorg",    ch: "!", fg: "#c75c5c", effect: "harm",     weight: 3 },
  { id: "boost",  kind: "potion", name: "a potion of staking",  ch: "!", fg: "#e0b94d", effect: "strength", weight: 3 },
  // ── scrolls ── ? (appearance randomised per game)
  { id: "tele",   kind: "scroll", name: "a scroll of teleport",     ch: "?", fg: "#c0c0e0", effect: "teleport", weight: 4 },
  { id: "map",    kind: "scroll", name: "a scroll of light client", ch: "?", fg: "#9ac0e0", effect: "map",      weight: 4 },
  { id: "ident",  kind: "scroll", name: "a scroll of identify",     ch: "?", fg: "#c0e0c0", effect: "identify", weight: 4 },
  { id: "ench",   kind: "scroll", name: "a scroll of enchantment",  ch: "?", fg: "#e0d090", effect: "enchant",  weight: 3 },
];

const POTION_LOOKS = ["a fizzy potion", "a murky potion", "a glowing vial", "a smoking flask", "a bubbling phial"];
const SCROLL_LOOKS = ["a scroll labeled XYZZY", "a scroll labeled ELBERETH", "a scroll labeled HODL", "a scroll labeled WAGMI", "a scroll labeled GM"];

/** Per-game randomised appearances + which item *types* the player has identified. */
export class Idents {
  private appearance = new Map<string, string>();
  private known = new Set<string>();

  constructor() {
    const potions = ITEMS.filter((i) => i.kind === "potion");
    const scrolls = ITEMS.filter((i) => i.kind === "scroll");
    const pl = ROT.RNG.shuffle(POTION_LOOKS.slice());
    const sl = ROT.RNG.shuffle(SCROLL_LOOKS.slice());
    potions.forEach((p, i) => this.appearance.set(p.id, pl[i] ?? "a strange potion"));
    scrolls.forEach((s, i) => this.appearance.set(s.id, sl[i] ?? "a strange scroll"));
  }

  isKnown(t: ItemType): boolean {
    return (t.kind !== "potion" && t.kind !== "scroll") || this.known.has(t.id);
  }
  learn(t: ItemType): void { this.known.add(t.id); }
  name(t: ItemType): string {
    return this.isKnown(t) ? t.name : (this.appearance.get(t.id) ?? t.name);
  }
}

export function pickItemType(): ItemType {
  const total = ITEMS.reduce((s, it) => s + it.weight, 0);
  let r = ROT.RNG.getUniform() * total;
  for (const it of ITEMS) { r -= it.weight; if (r <= 0) return it; }
  return ITEMS[0];
}
