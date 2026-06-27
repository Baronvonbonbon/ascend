// Items, themed appearances, and the identification system.

import * as ROT from "rot-js";

export type ItemKind = "weapon" | "armor" | "food" | "potion" | "scroll" | "amulet" | "ring" | "wand";

/** Armor occupies one of seven body slots — wear one piece in each. */
export type ArmorSlot = "shirt" | "body" | "cloak" | "helm" | "gloves" | "boots" | "shield";

/** Blessed / uncursed / cursed — an item's hidden sanctity. Cursed gear welds on. */
export type Buc = "blessed" | "uncursed" | "cursed";

/** Roll a fresh item's BUC: mostly uncursed, a dangerous minority cursed, a few blessed. */
export function rollBuc(): Buc {
  const r = ROT.RNG.getUniform();
  if (r < 0.12) return "cursed";
  if (r < 0.22) return "blessed";
  return "uncursed";
}

/** The ±1 swing a known BUC lends to weapon damage, armor AC, etc. */
export function bucDelta(buc?: Buc): number {
  return buc === "blessed" ? 1 : buc === "cursed" ? -1 : 0;
}

/** The JAM — the Amulet of Yendor of this world. Unique; never randomly spawned. */
export const JAM: ItemType = { id: "jam", kind: "amulet", name: "the JAM", ch: "*", fg: "#f4e89a", weight: 0 };

/** Generic corpse glyph; the real identity rides on FloorItem.corpse (eat for effects). */
export const CORPSE: ItemType = { id: "corpse", kind: "food", name: "a corpse", ch: "%", fg: "#b06a5a", nutrition: 0, weight: 0 };

export interface ItemType {
  id: string;
  kind: ItemKind;
  name: string;            // identified name
  ch: string;
  fg: string;
  dmg?: [number, number];  // weapon
  ac?: number;             // armor — contributes to evasion (harder to hit)
  slot?: ArmorSlot;        // which body slot this armor fills
  nutrition?: number;      // food
  effect?: EffectId;       // potion / scroll
  weight: number;          // spawn weight
}

export type EffectId = "heal" | "harm" | "strength" | "teleport" | "map" | "identify" | "enchant" | "cure" | "uncurse";

export const ITEMS: ItemType[] = [
  // ── weapons ── )
  { id: "dagger", kind: "weapon", name: "a debug dagger",      ch: ")", fg: "#cfcf9a", dmg: [2, 4], weight: 5 },
  { id: "sword",  kind: "weapon", name: "a consensus sword",   ch: ")", fg: "#dfe6f0", dmg: [3, 6], weight: 3 },
  { id: "mace",   kind: "weapon", name: "a validator's mace",  ch: ")", fg: "#c0a060", dmg: [4, 9], weight: 2 },
  // ── armor ── [ (seven slots — wear one of each)
  { id: "shirt",  kind: "armor",  name: "a hashguard shirt",   ch: "[", fg: "#a0b0a0", ac: 1, slot: "shirt",  weight: 3 },
  { id: "vest",   kind: "armor",  name: "a firewall vest",     ch: "[", fg: "#9ac0c0", ac: 2, slot: "body",   weight: 5 },
  { id: "plate",  kind: "armor",  name: "validator plate",     ch: "[", fg: "#8aa0d0", ac: 3, slot: "body",   weight: 2 },
  { id: "cloak",  kind: "armor",  name: "a ZK cloak",          ch: "[", fg: "#b09adf", ac: 2, slot: "cloak",  weight: 3 },
  { id: "helm",   kind: "armor",  name: "a consensus helm",    ch: "[", fg: "#c0c090", ac: 1, slot: "helm",   weight: 3 },
  { id: "gloves", kind: "armor",  name: "relay gauntlets",     ch: "[", fg: "#c0a070", ac: 1, slot: "gloves", weight: 2 },
  { id: "boots",  kind: "armor",  name: "sync boots",          ch: "[", fg: "#a08060", ac: 1, slot: "boots",  weight: 2 },
  { id: "shield", kind: "armor",  name: "a firewall shield",   ch: "[", fg: "#90a0c0", ac: 2, slot: "shield", weight: 3 },
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
  { id: "cure",   kind: "scroll", name: "a scroll of cleansing",    ch: "?", fg: "#c0e0e0", effect: "cure",     weight: 3 },
  { id: "uncurse",kind: "scroll", name: "a scroll of formal verification", ch: "?", fg: "#d0f0c0", effect: "uncurse", weight: 3 },
  // ── rings ── = (passive while worn; put on with W)
  { id: "ring_res",   kind: "ring", name: "a ring of resilience",    ch: "=", fg: "#c0a0e0", weight: 2 },
  { id: "ring_regen", kind: "ring", name: "a ring of regeneration",  ch: "=", fg: "#a0e0a0", weight: 2 },
  { id: "ring_priv",  kind: "ring", name: "a ring of privacy",       ch: "=", fg: "#a0c0e0", weight: 2 },
  // ── wands ── / (directional, charged; zap with z)
  { id: "wand_bolt",   kind: "wand", name: "a wand of finality",     ch: "/", fg: "#90d0e0", weight: 2 },
  { id: "wand_banish", kind: "wand", name: "a wand of banishment",   ch: "/", fg: "#d090d0", weight: 2 },
  { id: "wand_slow",   kind: "wand", name: "a wand of slowness",     ch: "/", fg: "#80a0d0", weight: 2 },
  { id: "wand_dig",    kind: "wand", name: "a wand of digging",      ch: "/", fg: "#c0a060", weight: 2 },
];

const POTION_LOOKS = ["a fizzy potion", "a murky potion", "a glowing vial", "a smoking flask", "a bubbling phial"];
const SCROLL_LOOKS = ["a scroll labeled XYZZY", "a scroll labeled ELBERETH", "a scroll labeled HODL", "a scroll labeled WAGMI", "a scroll labeled GM", "a scroll labeled DYOR"];

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

const BY_ID = new Map<string, ItemType>(ITEMS.map((it) => [it.id, it]));
/** Resolve an item id (e.g. an on-chain relic's itemId) back to its type. */
export function itemById(id: string): ItemType | undefined { return BY_ID.get(id); }

/** Gear eligible to become a tradeable NFT relic — equipment, never consumables. */
export const GEAR_KINDS: ReadonlySet<ItemKind> = new Set(["weapon", "armor", "ring", "wand"]);
export function isGear(t: ItemType): boolean { return GEAR_KINDS.has(t.kind); }

export function pickItemType(): ItemType {
  const total = ITEMS.reduce((s, it) => s + it.weight, 0);
  let r = ROT.RNG.getUniform() * total;
  for (const it of ITEMS) { r -= it.weight; if (r <= 0) return it; }
  return ITEMS[0];
}
