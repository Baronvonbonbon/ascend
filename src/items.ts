// Items, themed appearances, and the identification system.

import * as ROT from "rot-js";
import { getFlavor, nameOf } from "./flavor";

export type ItemKind = "weapon" | "armor" | "food" | "potion" | "scroll" | "amulet" | "ring" | "wand" | "tool" | "spellbook";

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
export const JAM: ItemType = { id: "jam", kind: "amulet", name: "the JAM", fname: "the Amulet of Yendor", ch: "*", fg: "#f4e89a", weight: 0 };

/** Generic corpse glyph; the real identity rides on FloorItem.corpse (eat for effects). */
export const CORPSE: ItemType = { id: "corpse", kind: "food", name: "a corpse", ch: "%", fg: "#b06a5a", nutrition: 0, weight: 0 };

/** A chest — a floor container you open (o) for loot; the real state rides on FloorItem.chest. */
export const CHEST: ItemType = { id: "chest", kind: "tool", name: "a chest", ch: "(", fg: "#b08040", weight: 0 };

/** A pile of gold — the in-game coin. Auto-collected on step; the amount rides on FloorItem.coins. */
export const GOLD: ItemType = { id: "gold", kind: "tool", name: "gold", ch: "$", fg: "#e0b94d", weight: 0 };

export interface ItemType {
  id: string;
  kind: ItemKind;
  name: string;            // identified name (polkadot flavor)
  fname?: string;          // identified name (fantasy flavor — the default skin)
  ch: string;
  fg: string;
  dmg?: [number, number];  // weapon
  ac?: number;             // armor — contributes to evasion (harder to hit)
  slot?: ArmorSlot;        // which body slot this armor fills
  nutrition?: number;      // food
  effect?: EffectId;       // potion / scroll
  teaches?: string;        // spellbook — the spell id it studies into
  skill?: string;          // weapon skill class (#enhance) — "blade" / "blunt"
  weight: number;          // spawn weight
}

export type EffectId = "heal" | "harm" | "strength" | "teleport" | "map" | "identify" | "enchant" | "cure" | "uncurse" | "blind" | "polyself";

export const ITEMS: ItemType[] = [
  // ── weapons ── )
  { id: "dagger", kind: "weapon", name: "a debug dagger",      fname: "a dagger",            ch: ")", fg: "#cfcf9a", dmg: [2, 4], skill: "blade", weight: 5 },
  { id: "sword",  kind: "weapon", name: "a consensus sword",   fname: "a long sword",        ch: ")", fg: "#dfe6f0", dmg: [3, 6], skill: "blade", weight: 3 },
  { id: "mace",   kind: "weapon", name: "a validator's mace",  fname: "a war mace",          ch: ")", fg: "#c0a060", dmg: [4, 9], skill: "blunt", weight: 2 },
  // ── armor ── [ (seven slots — wear one of each)
  { id: "shirt",  kind: "armor",  name: "a hashguard shirt",   fname: "a mail shirt",        ch: "[", fg: "#a0b0a0", ac: 1, slot: "shirt",  weight: 3 },
  { id: "vest",   kind: "armor",  name: "a firewall vest",     fname: "a leather cuirass",   ch: "[", fg: "#9ac0c0", ac: 2, slot: "body",   weight: 5 },
  { id: "plate",  kind: "armor",  name: "validator plate",     fname: "plate mail",          ch: "[", fg: "#8aa0d0", ac: 3, slot: "body",   weight: 2 },
  { id: "cloak",  kind: "armor",  name: "a ZK cloak",          fname: "an elven cloak",      ch: "[", fg: "#b09adf", ac: 2, slot: "cloak",  weight: 3 },
  { id: "helm",   kind: "armor",  name: "a consensus helm",    fname: "an iron helm",        ch: "[", fg: "#c0c090", ac: 1, slot: "helm",   weight: 3 },
  { id: "gloves", kind: "armor",  name: "relay gauntlets",     fname: "leather gauntlets",   ch: "[", fg: "#c0a070", ac: 1, slot: "gloves", weight: 2 },
  { id: "boots",  kind: "armor",  name: "sync boots",          fname: "leather boots",       ch: "[", fg: "#a08060", ac: 1, slot: "boots",  weight: 2 },
  { id: "shield", kind: "armor",  name: "a firewall shield",   fname: "a kite shield",       ch: "[", fg: "#90a0c0", ac: 2, slot: "shield", weight: 3 },
  // ── food ── %
  { id: "ration", kind: "food",   name: "a ration of cycles",  fname: "a food ration",       ch: "%", fg: "#c0a050", nutrition: 600, weight: 5 },
  { id: "crumb",  kind: "food",   name: "a stale block",       fname: "a stale crust",       ch: "%", fg: "#8a7a40", nutrition: 220, weight: 4 },
  // ── potions ── ! (appearance randomised per game)
  { id: "heal",   kind: "potion", name: "a potion of finality", fname: "a potion of healing",     ch: "!", fg: "#76c66a", effect: "heal",     weight: 5 },
  { id: "harm",   kind: "potion", name: "a potion of reorg",    fname: "a potion of harming",     ch: "!", fg: "#c75c5c", effect: "harm",     weight: 3 },
  { id: "boost",  kind: "potion", name: "a potion of staking",  fname: "a potion of gain strength", ch: "!", fg: "#e0b94d", effect: "strength", weight: 3 },
  { id: "blind",  kind: "potion", name: "a potion of obfuscation", fname: "a potion of blindness", ch: "!", fg: "#707070", effect: "blind", weight: 2 },
  // ── scrolls ── ? (appearance randomised per game)
  { id: "tele",   kind: "scroll", name: "a scroll of teleport",     fname: "a scroll of teleportation", ch: "?", fg: "#c0c0e0", effect: "teleport", weight: 4 },
  { id: "map",    kind: "scroll", name: "a scroll of light client", fname: "a scroll of magic mapping", ch: "?", fg: "#9ac0e0", effect: "map",      weight: 4 },
  { id: "ident",  kind: "scroll", name: "a scroll of identify",     fname: "a scroll of identify",      ch: "?", fg: "#c0e0c0", effect: "identify", weight: 4 },
  { id: "ench",   kind: "scroll", name: "a scroll of enchantment",  fname: "a scroll of enchant armor", ch: "?", fg: "#e0d090", effect: "enchant",  weight: 3 },
  { id: "cure",   kind: "scroll", name: "a scroll of cleansing",    fname: "a scroll of cleansing",     ch: "?", fg: "#c0e0e0", effect: "cure",     weight: 3 },
  { id: "uncurse",kind: "scroll", name: "a scroll of formal verification", fname: "a scroll of remove curse", ch: "?", fg: "#d0f0c0", effect: "uncurse", weight: 3 },
  { id: "fork",   kind: "scroll", name: "a scroll of hard fork",      fname: "a scroll of polymorph",   ch: "?", fg: "#e090e0", effect: "polyself", weight: 2 },
  // ── rings ── = (passive while worn; put on with W)
  { id: "ring_res",   kind: "ring", name: "a ring of resilience",    fname: "a ring of protection",   ch: "=", fg: "#c0a0e0", weight: 2 },
  { id: "ring_regen", kind: "ring", name: "a ring of regeneration",  fname: "a ring of regeneration", ch: "=", fg: "#a0e0a0", weight: 2 },
  { id: "ring_priv",  kind: "ring", name: "a ring of privacy",       fname: "a ring of invisibility", ch: "=", fg: "#a0c0e0", weight: 2 },
  // ── wands ── / (directional, charged; zap with z)
  { id: "wand_bolt",   kind: "wand", name: "a wand of finality",     fname: "a wand of striking",      ch: "/", fg: "#90d0e0", weight: 2 },
  { id: "wand_banish", kind: "wand", name: "a wand of banishment",   fname: "a wand of banishment",    ch: "/", fg: "#d090d0", weight: 2 },
  { id: "wand_slow",   kind: "wand", name: "a wand of slowness",     fname: "a wand of slow monster",  ch: "/", fg: "#80a0d0", weight: 2 },
  { id: "wand_dig",    kind: "wand", name: "a wand of digging",      fname: "a wand of digging",       ch: "/", fg: "#c0a060", weight: 2 },
  { id: "wand_fire",   kind: "wand", name: "a wand of immolation",   fname: "a wand of fire",          ch: "/", fg: "#e07040", weight: 2 }, // a bouncing fire ray
  { id: "wand_sleep",  kind: "wand", name: "a wand of stasis",       fname: "a wand of sleep",         ch: "/", fg: "#90a0d0", weight: 2 },
  { id: "wand_poly",   kind: "wand", name: "a wand of forking",      fname: "a wand of polymorph",     ch: "/", fg: "#d070d0", weight: 1 },
  { id: "wand_cancel", kind: "wand", name: "a wand of nullification",fname: "a wand of cancellation",  ch: "/", fg: "#a0a0a0", weight: 1 },
  { id: "wand_probe",  kind: "wand", name: "a wand of state-read",   fname: "a wand of probing",       ch: "/", fg: "#80c0a0", weight: 2 },
  // ── tools ── ( (applied with a)
  { id: "pickaxe", kind: "tool", name: "an excavator",        fname: "a pick-axe",          ch: "(", fg: "#c0a060", weight: 3 }, // reusable dig
  { id: "horn",    kind: "tool", name: "an auditor's horn",   fname: "a unicorn horn",      ch: "(", fg: "#e0e0c0", weight: 2 }, // cures afflictions
  { id: "marker",  kind: "tool", name: "a contract deployer", fname: "a magic marker",      ch: "(", fg: "#a0d0e0", weight: 2 }, // writes scrolls (charged)
  { id: "scope",   kind: "tool", name: "a state reader",      fname: "a crystal lens",      ch: "(", fg: "#a0c0a0", weight: 2 }, // probe an adjacent foe
  { id: "vault",   kind: "tool", name: "a multisig vault",    fname: "a bag of holding",    ch: "(", fg: "#d0c060", weight: 2 }, // bag of holding — #loot to stash beyond the pack
  { id: "hodlstone", kind: "tool", name: "a HODL stone",      fname: "a luckstone",         ch: "*", fg: "#e0d040", weight: 2 }, // luckstone (blessed) / loadstone (cursed)
  // ── quest artifacts ── (Phase 13c — one per archetype, won from your nemesis; never random-spawn)
  { id: "art_sceptre",  kind: "weapon", name: "the Block Sceptre",    fname: "the Sceptre of Might",   ch: ")", fg: "#ffd040", dmg: [6, 12], skill: "blunt", weight: 0 },
  { id: "art_aegis",    kind: "armor",  name: "the Bonded Aegis",     fname: "the Mirror Aegis",       ch: "[", fg: "#80c0e0", ac: 4, slot: "shield", weight: 0 },
  { id: "art_cipher",   kind: "ring",   name: "the Null Cipher",      fname: "the Ring of Shadows",    ch: "=", fg: "#a0e0ff", weight: 0 },
  { id: "art_compiler", kind: "wand",   name: "the Genesis Compiler", fname: "the Staff of Creation",  ch: "/", fg: "#a0ffd0", weight: 0 },
  // ── invocation relics ── (Phase 12 — the three keys to the ritual; never random-spawn)
  { id: "bell",        kind: "tool",     name: "the Bell of Finality",     fname: "the Bell of Opening",        ch: "(", fg: "#ffe070", weight: 0 },
  { id: "candelabrum", kind: "tool",     name: "the Genesis Candelabrum",  fname: "the Candelabrum of Invocation", ch: "(", fg: "#ffd0a0", weight: 0 },
  { id: "graybook",    kind: "spellbook", name: "the Gray Paper",          fname: "the Book of the Dead",       ch: "+", fg: "#d8d8e8", weight: 0 },
  // ── spellbooks ── + (study with r; cast with Z)
  { id: "book_bolt",  kind: "spellbook", name: "a runtime of finality bolt", fname: "a spellbook of force bolt",     ch: "+", fg: "#c0d0f0", teaches: "bolt",  weight: 2 },
  { id: "book_heal",  kind: "spellbook", name: "a runtime of self-mend",     fname: "a spellbook of healing",        ch: "+", fg: "#a0e0a0", teaches: "heal",  weight: 2 },
  { id: "book_map",   kind: "spellbook", name: "a runtime of light client",  fname: "a spellbook of magic mapping",  ch: "+", fg: "#a0c0e0", teaches: "map",   weight: 2 },
  { id: "book_sense", kind: "spellbook", name: "a runtime of sense minds",   fname: "a spellbook of detect monsters", ch: "+", fg: "#d0c0e0", teaches: "sense", weight: 2 },
  { id: "book_tele",  kind: "spellbook", name: "a runtime of XCM jump",      fname: "a spellbook of teleport",       ch: "+", fg: "#c0c0e0", teaches: "tele",  weight: 1 },
  { id: "book_haste", kind: "spellbook", name: "a runtime of overclock",     fname: "a spellbook of haste self",     ch: "+", fg: "#e0d0a0", teaches: "haste", weight: 1 },
];

/** Scrolls a contract deployer (magic marker) can inscribe, in menu order. */
export const WRITABLE_SCROLLS = ["tele", "map", "ident", "ench", "cure", "uncurse"];

// Unidentified appearances — fantasy + polkadot, same length so an assigned index maps across both.
const POTION_LOOKS_F = ["a ruby potion", "a murky potion", "a glowing vial", "a smoking flask", "a bubbling phial"];
const POTION_LOOKS_P = ["a fizzy potion", "a murky potion", "a glowing vial", "a smoking flask", "a bubbling phial"];
const SCROLL_LOOKS_F = ["a scroll labeled XYZZY", "a scroll labeled ELBERETH", "a scroll labeled NR 9", "a scroll labeled FOOBAR", "a scroll labeled VENZAR", "a scroll labeled THARR", "a scroll labeled JUYED"];
const SCROLL_LOOKS_P = ["a scroll labeled XYZZY", "a scroll labeled ELBERETH", "a scroll labeled HODL", "a scroll labeled WAGMI", "a scroll labeled GM", "a scroll labeled DYOR", "a scroll labeled REKT"];

/** Per-GAME randomised appearances — the world's potions/scrolls look the same to everyone.
 *  Shared by all adventurers; only *knowledge* of what they are is per-character (Idents). */
export class Appearances {
  private apIdx = new Map<string, number>(); // id → index into the look list (resolved to fantasy/polkadot at display time)

  constructor() {
    const potions = ITEMS.filter((i) => i.kind === "potion");
    const scrolls = ITEMS.filter((i) => i.kind === "scroll");
    ROT.RNG.shuffle(potions.map((_, i) => i)).forEach((idx, i) => this.apIdx.set(potions[i].id, idx));
    ROT.RNG.shuffle(scrolls.map((_, i) => i)).forEach((idx, i) => this.apIdx.set(scrolls[i].id, idx));
  }

  look(t: ItemType): string {
    const idx = this.apIdx.get(t.id) ?? 0;
    const fant = getFlavor() === "fantasy";
    const list = t.kind === "potion" ? (fant ? POTION_LOOKS_F : POTION_LOOKS_P) : (fant ? SCROLL_LOOKS_F : SCROLL_LOOKS_P);
    return list[idx] ?? (t.kind === "potion" ? "a strange potion" : "a strange scroll");
  }
}

/** One adventurer's identification knowledge — which item *types* they've learned.
 *  Appearances are shared (the world looks the same); knowledge is per-character. */
export class Idents {
  private known = new Set<string>();
  constructor(private appearances: Appearances) {}

  private look(t: ItemType): string { return this.appearances.look(t); }

  isKnown(t: ItemType): boolean {
    return (t.kind !== "potion" && t.kind !== "scroll") || this.known.has(t.id);
  }
  learn(t: ItemType): void { this.known.add(t.id); }
  name(t: ItemType): string {
    return this.isKnown(t) ? nameOf(t) : this.look(t);
  }

  /** The discoveries screen (`\`): per-class lists of identified potion/scroll types. */
  discoveries(): { kind: string; entries: { name: string; look: string }[]; unknown: number }[] {
    return (["potion", "scroll"] as const).map((kind) => {
      const all = ITEMS.filter((i) => i.kind === kind);
      const entries = all.filter((t) => this.known.has(t.id)).map((t) => ({ name: nameOf(t), look: this.look(t) }));
      return { kind, entries, unknown: all.length - entries.length };
    });
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
