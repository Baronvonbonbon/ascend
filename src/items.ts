// Items, themed appearances, and the identification system.

import * as ROT from "rot-js";
import { getFlavor, nameOf } from "./flavor";

export type ItemKind = "weapon" | "armor" | "food" | "potion" | "scroll" | "amulet" | "ring" | "wand" | "tool" | "spellbook" | "gem";

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
  value?: number;          // gem — gold value when sold to the Marketmaker (worthless glass ≈ 0)
  weight: number;          // spawn weight
}

export type EffectId = "heal" | "harm" | "strength" | "teleport" | "map" | "identify" | "enchant" | "cure" | "uncurse" | "blind" | "polyself" | "detect_obj" | "detect_trap" | "water" | "charge" | "scare" | "gold" | "clairvoyance";

export const ITEMS: ItemType[] = [
  // ── weapons ── )
  { id: "dagger", kind: "weapon", name: "a debug dagger",      fname: "a dagger",            ch: ")", fg: "#cfcf9a", dmg: [2, 4], skill: "blade", weight: 5 },
  { id: "sword",  kind: "weapon", name: "a consensus sword",   fname: "a long sword",        ch: ")", fg: "#dfe6f0", dmg: [3, 6], skill: "blade", weight: 3 },
  { id: "mace",   kind: "weapon", name: "a validator's mace",  fname: "a war mace",          ch: ")", fg: "#c0a060", dmg: [4, 9], skill: "blunt", weight: 2 },
  { id: "whip",   kind: "weapon", name: "a slashing whip",     fname: "a bullwhip",          ch: ")", fg: "#a08050", dmg: [1, 4], skill: "blade", weight: 2 },
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
  { id: "tin",    kind: "food",   name: "a sealed tin",        fname: "a tin",               ch: "%", fg: "#c0c0b0", nutrition: 500, weight: 1 }, // needs a tin opener; big nutrition + a random meat effect
  // ── potions ── ! (appearance randomised per game)
  { id: "heal",   kind: "potion", name: "a potion of finality", fname: "a potion of healing",     ch: "!", fg: "#76c66a", effect: "heal",     weight: 5 },
  { id: "harm",   kind: "potion", name: "a potion of reorg",    fname: "a potion of harming",     ch: "!", fg: "#c75c5c", effect: "harm",     weight: 3 },
  { id: "boost",  kind: "potion", name: "a potion of staking",  fname: "a potion of gain strength", ch: "!", fg: "#e0b94d", effect: "strength", weight: 3 },
  { id: "blind",  kind: "potion", name: "a potion of obfuscation", fname: "a potion of blindness", ch: "!", fg: "#707070", effect: "blind", weight: 2 },
  { id: "water",  kind: "potion", name: "a vial of testnet water", fname: "a potion of water",     ch: "!", fg: "#8ac0e0", effect: "water", weight: 4 }, // holy (blessed) / unholy (cursed) — consecrate on Gavin's altar; #dip gear to bless/curse it
  // ── scrolls ── ? (appearance randomised per game)
  { id: "tele",   kind: "scroll", name: "a scroll of teleport",     fname: "a scroll of teleportation", ch: "?", fg: "#c0c0e0", effect: "teleport", weight: 4 },
  { id: "map",    kind: "scroll", name: "a scroll of light client", fname: "a scroll of magic mapping", ch: "?", fg: "#9ac0e0", effect: "map",      weight: 4 },
  { id: "ident",  kind: "scroll", name: "a scroll of identify",     fname: "a scroll of identify",      ch: "?", fg: "#c0e0c0", effect: "identify", weight: 4 },
  { id: "ench",   kind: "scroll", name: "a scroll of enchantment",  fname: "a scroll of enchant armor", ch: "?", fg: "#e0d090", effect: "enchant",  weight: 3 },
  { id: "cure",   kind: "scroll", name: "a scroll of cleansing",    fname: "a scroll of cleansing",     ch: "?", fg: "#c0e0e0", effect: "cure",     weight: 3 },
  { id: "uncurse",kind: "scroll", name: "a scroll of formal verification", fname: "a scroll of remove curse", ch: "?", fg: "#d0f0c0", effect: "uncurse", weight: 3 },
  { id: "fork",   kind: "scroll", name: "a scroll of hard fork",      fname: "a scroll of polymorph",   ch: "?", fg: "#e090e0", effect: "polyself", weight: 2 },
  { id: "dobj",   kind: "scroll", name: "a scroll of ledger audit",   fname: "a scroll of treasure detection", ch: "?", fg: "#e8d070", effect: "detect_obj",  weight: 3 },
  { id: "dtrap",  kind: "scroll", name: "a scroll of exploit scan",   fname: "a scroll of trap detection",     ch: "?", fg: "#d09060", effect: "detect_trap", weight: 3 },
  { id: "charge", kind: "scroll", name: "a scroll of gas top-up",     fname: "a scroll of charging",           ch: "?", fg: "#e0c080", effect: "charge",      weight: 3 },
  { id: "scare",  kind: "scroll", name: "a scroll of FUD",            fname: "a scroll of scare monster",      ch: "?", fg: "#d0b0b0", effect: "scare",       weight: 3 },
  { id: "gold",   kind: "scroll", name: "a scroll of balance check",  fname: "a scroll of gold detection",     ch: "?", fg: "#e8d060", effect: "gold",        weight: 2 },
  { id: "clair",  kind: "scroll", name: "a scroll of remote view",    fname: "a scroll of clairvoyance",       ch: "?", fg: "#a0d0e0", effect: "clairvoyance", weight: 2 },
  // ── amulets ── " (passive while worn; put on with W, take off with T)
  { id: "amulet_life",    kind: "amulet", name: "a recovery seed",   fname: "an amulet of life saving", ch: "\"", fg: "#f0d060", weight: 1 }, // crumbles to save you from one lethal blow
  { id: "amulet_reflect", kind: "amulet", name: "a consensus mirror", fname: "an amulet of reflection",  ch: "\"", fg: "#b0e0e0", weight: 1 }, // rebounds rays/breath back at the source
  // ── rings ── = (passive while worn; put on with W)
  { id: "ring_res",   kind: "ring", name: "a ring of resilience",    fname: "a ring of protection",   ch: "=", fg: "#c0a0e0", weight: 2 },
  { id: "ring_regen", kind: "ring", name: "a ring of regeneration",  fname: "a ring of regeneration", ch: "=", fg: "#a0e0a0", weight: 2 },
  { id: "ring_priv",  kind: "ring", name: "a ring of privacy",       fname: "a ring of invisibility", ch: "=", fg: "#a0c0e0", weight: 2 },
  { id: "ring_free",  kind: "ring", name: "a ring of liveness",       fname: "a ring of free action",  ch: "=", fg: "#e0e080", weight: 1 }, // immune to paralysis
  { id: "ring_sustain", kind: "ring", name: "a ring of stable stake", fname: "a ring of sustain ability", ch: "=", fg: "#90c0a0", weight: 1 }, // attributes can't be drained
  { id: "ring_digest", kind: "ring", name: "a ring of cold storage",  fname: "a ring of slow digestion", ch: "=", fg: "#c0d0e0", weight: 1 }, // hunger ticks half as fast
  { id: "ring_acc",   kind: "ring", name: "a ring of low latency",    fname: "a ring of increase accuracy", ch: "=", fg: "#e0c060", weight: 2 }, // +2 to-hit (cursed −2)
  { id: "ring_dmg",   kind: "ring", name: "a ring of high throughput", fname: "a ring of increase damage", ch: "=", fg: "#e08060", weight: 2 }, // +2 damage (cursed −2)
  { id: "ring_poison", kind: "ring", name: "a ring of antivirus",     fname: "a ring of poison resistance", ch: "=", fg: "#90e070", weight: 2 }, // immune to poison
  { id: "ring_warn",  kind: "ring", name: "a ring of alerts",         fname: "a ring of warning",      ch: "=", fg: "#e07070", weight: 2 }, // sense nearby foes through walls
  { id: "ring_search", kind: "ring", name: "a ring of indexing",      fname: "a ring of searching",    ch: "=", fg: "#c0a0e0", weight: 2 }, // auto-finds hidden traps & doors
  { id: "ring_firered",  kind: "ring", name: "a ring of heat sinks",    fname: "a ring of fire resistance",  ch: "=", fg: "#e08040", weight: 2 }, // fire resistance while worn
  { id: "ring_coldred",  kind: "ring", name: "a ring of insulation",    fname: "a ring of cold resistance",  ch: "=", fg: "#80c0f0", weight: 2 }, // cold resistance while worn
  { id: "ring_shockred", kind: "ring", name: "a ring of grounding",     fname: "a ring of shock resistance", ch: "=", fg: "#f0e070", weight: 2 }, // shock resistance while worn
  // ── wands ── / (directional, charged; zap with z)
  { id: "wand_bolt",   kind: "wand", name: "a wand of finality",     fname: "a wand of striking",      ch: "/", fg: "#90d0e0", weight: 2 },
  { id: "wand_banish", kind: "wand", name: "a wand of banishment",   fname: "a wand of banishment",    ch: "/", fg: "#d090d0", weight: 2 },
  { id: "wand_slow",   kind: "wand", name: "a wand of slowness",     fname: "a wand of slow monster",  ch: "/", fg: "#80a0d0", weight: 2 },
  { id: "wand_dig",    kind: "wand", name: "a wand of digging",      fname: "a wand of digging",       ch: "/", fg: "#c0a060", weight: 2 },
  { id: "wand_fire",   kind: "wand", name: "a wand of immolation",   fname: "a wand of fire",          ch: "/", fg: "#e07040", weight: 2 }, // a bouncing fire ray
  { id: "wand_sleep",  kind: "wand", name: "a wand of stasis",       fname: "a wand of sleep",         ch: "/", fg: "#90a0d0", weight: 2 },
  { id: "wand_poly",   kind: "wand", name: "a wand of forking",      fname: "a wand of polymorph",     ch: "/", fg: "#d070d0", weight: 1 },
  { id: "wand_cancel", kind: "wand", name: "a wand of nullification",fname: "a wand of cancellation",  ch: "/", fg: "#a0a0a0", weight: 1 },
  { id: "wand_silence",kind: "wand", name: "a wand of gag order",    fname: "a wand of silence",       ch: "/", fg: "#7a8a90", weight: 2 }, // silences a foe — no casting/summoning
  { id: "wand_probe",  kind: "wand", name: "a wand of state-read",   fname: "a wand of probing",       ch: "/", fg: "#80c0a0", weight: 2 },
  { id: "wand_cold",   kind: "wand", name: "a wand of cryo-slash",   fname: "a wand of cold",          ch: "/", fg: "#90d0f0", weight: 2 }, // a cold ray (may slow)
  { id: "wand_lightning", kind: "wand", name: "a wand of shock",     fname: "a wand of lightning",     ch: "/", fg: "#f0f080", weight: 2 }, // a lightning ray (may blind)
  { id: "wand_missile", kind: "wand", name: "a wand of force",       fname: "a wand of magic missile", ch: "/", fg: "#c0c0f0", weight: 2 }, // a reliable force ray
  { id: "wand_death",  kind: "wand", name: "a wand of annihilation", fname: "a wand of death",         ch: "/", fg: "#ff3030", weight: 1 }, // unwrites a single foe (bosses endure)
  { id: "wand_open",   kind: "wand", name: "a wand of unlock",       fname: "a wand of opening",        ch: "/", fg: "#b0a060", weight: 2 }, // unlocks a door/chest
  { id: "wand_light",  kind: "wand", name: "a wand of floodlight",   fname: "a wand of light",          ch: "/", fg: "#fff0a0", weight: 2 }, // floods the area with light
  { id: "wand_secret", kind: "wand", name: "a wand of deep scan",    fname: "a wand of secret door detection", ch: "/", fg: "#c0a0e0", weight: 1 }, // reveals hidden doors + traps
  { id: "wand_create", kind: "wand", name: "a wand of spawning",     fname: "a wand of create monster", ch: "/", fg: "#d0a070", weight: 2 }, // conjures foes around you (no aim)
  { id: "wand_speed",  kind: "wand", name: "a wand of overclocking", fname: "a wand of speed monster",  ch: "/", fg: "#e0e080", weight: 2 }, // hastes a monster (or your pet)
  { id: "wand_invis",  kind: "wand", name: "a wand of cloaking",     fname: "a wand of make invisible", ch: "/", fg: "#a0c0c0", weight: 1 }, // makes a monster invisible (unseen without ESP)
  { id: "wand_wish",   kind: "wand", name: "a wand of minting",      fname: "a wand of wishing",       ch: "/", fg: "#ffd0ff", weight: 0 }, // the ultimate — wish an item into being; never random-spawns (a rare boss drop)
  // ── tools ── ( (applied with a)
  { id: "pickaxe", kind: "tool", name: "an excavator",        fname: "a pick-axe",          ch: "(", fg: "#c0a060", weight: 3 }, // reusable dig
  { id: "horn",    kind: "tool", name: "an auditor's horn",   fname: "a unicorn horn",      ch: "(", fg: "#e0e0c0", weight: 2 }, // cures afflictions
  { id: "marker",  kind: "tool", name: "a contract deployer", fname: "a magic marker",      ch: "(", fg: "#a0d0e0", weight: 2 }, // writes scrolls (charged)
  { id: "scope",   kind: "tool", name: "a state reader",      fname: "a crystal lens",      ch: "(", fg: "#a0c0a0", weight: 2 }, // probe an adjacent foe
  { id: "mirror",  kind: "tool", name: "a mirror node",       fname: "a mirror",            ch: "(", fg: "#c0d0e0", weight: 2 }, // apply at a foe — scare it; a gazer freezes / a petrifier turns to stone
  { id: "camera",  kind: "tool", name: "a snapshot camera",    fname: "an expensive camera", ch: "(", fg: "#c8c8d8", weight: 3 }, // apply + direction — a flash blinds foes in a line (charged: film)
  { id: "crystal", kind: "tool", name: "an indexer",           fname: "a crystal ball",      ch: "(", fg: "#b090e0", weight: 2 }, // apply to gaze — INT-gated: reveal every mind on the floor, or gaze too long and reel
  { id: "grease",  kind: "tool", name: "a can of lubricant",    fname: "a can of grease",     ch: "(", fg: "#c8c860", weight: 2 }, // apply to a gear piece — grease it rust-proof (charged)
  { id: "tinopener", kind: "tool", name: "a block decoder",     fname: "a tin opener",        ch: "(", fg: "#b0b0b0", weight: 1 }, // held, it lets you open (eat) sealed tins
  { id: "lockpick", kind: "tool", name: "a signing key",        fname: "a lock pick",         ch: "(", fg: "#c0c0a0", weight: 1 }, // apply + direction — DEX-gated, pick a locked door/chest (reusable)
  { id: "tinkit",  kind: "tool", name: "a cold-storage kit",    fname: "a tinning kit",       ch: "(", fg: "#b0c0b0", weight: 2 }, // apply on a corpse underfoot — seal it into a tin (charged)
  { id: "whistle", kind: "tool", name: "a recall beacon",       fname: "a magic whistle",     ch: "(", fg: "#d0d0e0", weight: 1 }, // apply — blink your nominator to your side
  { id: "leash",   kind: "tool", name: "a delegation cord",     fname: "a leash",             ch: "(", fg: "#a08050", weight: 1 }, // apply — tether your nominator so it keeps to your side
  { id: "drum",    kind: "tool", name: "a drum of consensus",   fname: "a drum",              ch: "(", fg: "#c09050", weight: 2 }, // apply — beat it: nearby foes waver and recoil (reusable)
  { id: "towel",   kind: "tool", name: "a microfibre cloth",    fname: "a towel",             ch: "(", fg: "#d0d0c0", weight: 1 }, // apply — wipe your face, or bind it over your eyes (ESP scanning with telepathy)
  { id: "lamp",    kind: "tool", name: "a block explorer",    fname: "an oil lamp",         ch: "(", fg: "#e0d060", weight: 3 }, // apply to light/douse — full sight in the dark
  { id: "vault",   kind: "tool", name: "a multisig vault",    fname: "a bag of holding",    ch: "(", fg: "#d0c060", weight: 2 }, // bag of holding — #loot to stash beyond the pack
  { id: "trickbag", kind: "tool", name: "a faucet bag",        fname: "a bag of tricks",     ch: "(", fg: "#c060c0", weight: 2 }, // bag of tricks — apply to spit out a monster (charged)
  { id: "hodlstone", kind: "tool", name: "a HODL stone",      fname: "a luckstone",         ch: "*", fg: "#e0d040", weight: 2 }, // luckstone (blessed) / loadstone (cursed)
  { id: "touchstone", kind: "tool", name: "an appraiser's loupe", fname: "a touchstone",     ch: "(", fg: "#b0b0c0", weight: 2 }, // apply to appraise (identify) your gems
  // ── gems / tokens ── * (real vs worthless glass — randomised appearance; appraise or sell to learn which) ──
  { id: "gem_diamond",  kind: "gem", name: "a blue-chip token",      fname: "a diamond",   ch: "*", fg: "#e8f0ff", value: 400, weight: 1 },
  { id: "gem_ruby",     kind: "gem", name: "a governance token",     fname: "a ruby",      ch: "*", fg: "#ff5060", value: 250, weight: 1 },
  { id: "gem_emerald",  kind: "gem", name: "a yield token",          fname: "an emerald",  ch: "*", fg: "#40e080", value: 180, weight: 1 },
  { id: "gem_sapphire", kind: "gem", name: "a liquid-staking token", fname: "a sapphire",  ch: "*", fg: "#4080ff", value: 150, weight: 1 },
  { id: "gem_glass1",   kind: "gem", name: "a worthless airdrop",    fname: "a worthless piece of glass", ch: "*", fg: "#c0c0d0", value: 0, weight: 1 },
  { id: "gem_glass2",   kind: "gem", name: "a worthless airdrop",    fname: "a worthless piece of glass", ch: "*", fg: "#c0c0d0", value: 0, weight: 1 },
  { id: "gem_glass3",   kind: "gem", name: "a worthless airdrop",    fname: "a worthless piece of glass", ch: "*", fg: "#c0c0d0", value: 0, weight: 1 },
  { id: "gem_glass4",   kind: "gem", name: "a worthless airdrop",    fname: "a worthless piece of glass", ch: "*", fg: "#c0c0d0", value: 0, weight: 1 },
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
  { id: "book_fire",  kind: "spellbook", name: "a runtime of immolation",    fname: "a spellbook of fireball",       ch: "+", fg: "#e07040", teaches: "fireball", weight: 1 },
  { id: "book_cure",  kind: "spellbook", name: "a runtime of cleanse",       fname: "a spellbook of cure sickness",  ch: "+", fg: "#a0e0e0", teaches: "cure",    weight: 2 },
  { id: "book_detect", kind: "spellbook", name: "a runtime of ledger scan",  fname: "a spellbook of detect treasure", ch: "+", fg: "#e0d070", teaches: "detect", weight: 2 },
  { id: "book_dig",   kind: "spellbook", name: "a runtime of excavate",      fname: "a spellbook of dig",            ch: "+", fg: "#c0a060", teaches: "dig",     weight: 2 },
  { id: "book_slow",  kind: "spellbook", name: "a runtime of throttle",      fname: "a spellbook of slow monster",   ch: "+", fg: "#80a0d0", teaches: "slow",    weight: 2 },
  { id: "book_sleep", kind: "spellbook", name: "a runtime of stasis field",  fname: "a spellbook of sleep",          ch: "+", fg: "#90a0d0", teaches: "sleep",   weight: 2 },
  { id: "book_turn",  kind: "spellbook", name: "a runtime of finality-slashing", fname: "a spellbook of turn undead", ch: "+", fg: "#e0e0c0", teaches: "turn",    weight: 1 },
  { id: "book_uncurse", kind: "spellbook", name: "a runtime of formal verification", fname: "a spellbook of remove curse", ch: "+", fg: "#d0f0c0", teaches: "uncurse", weight: 1 },
  { id: "book_cryo",  kind: "spellbook", name: "a runtime of cryo-lance",     fname: "a spellbook of cone of cold",  ch: "+", fg: "#90d0f0", teaches: "cryo",  weight: 1 },
  { id: "book_charm", kind: "spellbook", name: "a runtime of delegate",       fname: "a spellbook of charm monster", ch: "+", fg: "#e0b0d0", teaches: "charm", weight: 1 },
  { id: "book_clair", kind: "spellbook", name: "a runtime of remote sync",    fname: "a spellbook of clairvoyance",  ch: "+", fg: "#a0d0e0", teaches: "clair", weight: 1 },
];

/** Scrolls a contract deployer (magic marker) can inscribe, in menu order. */
export const WRITABLE_SCROLLS = ["tele", "map", "ident", "ench", "cure", "uncurse", "dobj", "dtrap"];

// Unidentified appearances — fantasy + polkadot, same length so an assigned index maps across both.
const POTION_LOOKS_F = ["a ruby potion", "a murky potion", "a glowing vial", "a smoking flask", "a bubbling phial"];
const POTION_LOOKS_P = ["a fizzy potion", "a murky potion", "a glowing vial", "a smoking flask", "a bubbling phial"];
const SCROLL_LOOKS_F = ["a scroll labeled XYZZY", "a scroll labeled ELBERETH", "a scroll labeled NR 9", "a scroll labeled FOOBAR", "a scroll labeled VENZAR", "a scroll labeled THARR", "a scroll labeled JUYED", "a scroll labeled PRATYAVAYAH", "a scroll labeled DAIYEN FOOELS", "a scroll labeled READ ME", "a scroll labeled GARVEN DEH", "a scroll labeled VERR YED HORRE", "a scroll labeled ANDOVA BEGARIN"];
const SCROLL_LOOKS_P = ["a scroll labeled XYZZY", "a scroll labeled ELBERETH", "a scroll labeled HODL", "a scroll labeled WAGMI", "a scroll labeled GM", "a scroll labeled DYOR", "a scroll labeled REKT", "a scroll labeled SUDO", "a scroll labeled XCM", "a scroll labeled NGMI", "a scroll labeled FUD", "a scroll labeled SER", "a scroll labeled FOMO"];
const GEM_COLORS = ["white", "red", "green", "blue", "yellow", "violet", "orange", "black"];
const GEM_LOOKS_F = GEM_COLORS.map((c) => `a ${c} gem`);
const GEM_LOOKS_P = GEM_COLORS.map((c) => `a ${c} token`);

/** Per-GAME randomised appearances — the world's potions/scrolls look the same to everyone.
 *  Shared by all adventurers; only *knowledge* of what they are is per-character (Idents). */
export class Appearances {
  private apIdx = new Map<string, number>(); // id → index into the look list (resolved to fantasy/polkadot at display time)

  constructor() {
    for (const kind of ["potion", "scroll", "gem"] as const) {
      const list = ITEMS.filter((i) => i.kind === kind);
      ROT.RNG.shuffle(list.map((_, i) => i)).forEach((idx, i) => this.apIdx.set(list[i].id, idx));
    }
  }

  look(t: ItemType): string {
    const idx = this.apIdx.get(t.id) ?? 0;
    const fant = getFlavor() === "fantasy";
    const list = t.kind === "potion" ? (fant ? POTION_LOOKS_F : POTION_LOOKS_P)
      : t.kind === "gem" ? (fant ? GEM_LOOKS_F : GEM_LOOKS_P)
      : (fant ? SCROLL_LOOKS_F : SCROLL_LOOKS_P);
    return list[idx] ?? (t.kind === "potion" ? "a strange potion" : t.kind === "gem" ? "a strange gem" : "a strange scroll");
  }
}

/** One adventurer's identification knowledge — which item *types* they've learned.
 *  Appearances are shared (the world looks the same); knowledge is per-character. */
export class Idents {
  private known = new Set<string>();
  constructor(private appearances: Appearances) {}

  private look(t: ItemType): string { return this.appearances.look(t); }

  isKnown(t: ItemType): boolean {
    return (t.kind !== "potion" && t.kind !== "scroll" && t.kind !== "gem") || this.known.has(t.id);
  }
  learn(t: ItemType): void { this.known.add(t.id); }
  name(t: ItemType): string {
    return this.isKnown(t) ? nameOf(t) : this.look(t);
  }

  /** The discoveries screen (`\`): per-class lists of identified potion/scroll types. */
  discoveries(): { kind: string; entries: { name: string; look: string }[]; unknown: number }[] {
    return (["potion", "scroll", "gem"] as const).map((kind) => {
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
