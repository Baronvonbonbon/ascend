// Suspend & resume — a single continuable save per run, persisted to IndexedDB, restored on reopen
// and cleared once loaded (and on death). Roguelike-faithful: no reloading to undo a death.
//
// Serialization strategy: reference types resolve by id/name against the shared tables (ItemType →
// id, MonsterDef → name in MONSTERS, ChainDef/BranchDef → id); Sets/Maps get tagged; transient UI
// state (pending prompts, input queue, FOV caches) is skipped and rebuilt. Entities are rebuilt by
// CONSTRUCTING a real instance (so every transient field gets its default) then overwriting the saved
// data — so we never leave a field undefined even if the class grows.

import { ITEMS, itemById, ItemType } from "./items";
import { Item } from "./inventory";
import { MONSTERS, MonsterDef, CHAINS, BRANCHES } from "./data";
import type { Level } from "./level";

export const SAVE_VERSION = 4;

// v4 renames: the last crypto-flavored ids reskinned to NetHack-canonical fantasy.
const ITEM_V4: Record<string, string> = { jam: "amulet_yendor", fork: "scroll_poly" };
const TRAP_V4: Record<string, string> = { reorg: "teleport", fork: "polymorph" };
/** Rewrite serialized item refs ({$item:"jam"}) and trap kinds ({x,y,kind:"reorg"}) anywhere in the tree. */
function deepRemapV4(v: unknown): void {
  if (!v || typeof v !== "object") return;
  if (Array.isArray(v)) { v.forEach(deepRemapV4); return; }
  const o = v as Record<string, unknown>;
  if (typeof o.$item === "string" && ITEM_V4[o.$item]) o.$item = ITEM_V4[o.$item];      // generic ItemType ref
  if (typeof o.type === "string" && ITEM_V4[o.type]) o.type = ITEM_V4[o.type];           // floor item / inventory item id
  if (typeof o.kind === "string" && typeof o.x === "number" && typeof o.y === "number" && TRAP_V4[o.kind]) o.kind = TRAP_V4[o.kind];
  for (const k of Object.keys(o)) deepRemapV4(o[k]);
}
function renameField(fields: unknown, from: string, to: string): void {
  if (fields && typeof fields === "object" && !Array.isArray(fields)) {
    const f = fields as Record<string, unknown>;
    if (from in f) { f[to] = f[from]; delete f[from]; }
  }
}

// v3 id renames (crypto → fantasy). Applied to old saves so a run in progress survives the reskin.
const ID_V3: Record<string, string> = {
  validator: "knight", nominator: "cleric", cypherpunk: "rogue", builder: "wizard",
  maximalist: "barbarian", watcher: "ranger", solostaker: "monk", auditor: "archeologist",
  substrate: "human", evm: "elf", bitcoiner: "dwarf", kusaman: "orc", botnet: "gnome",
};
const CHAIN_V3: Record<string, string> = {
  kusama: "wildlands", moonbeam: "moonkeep", astar: "starvault", phala: "shroudedvale",
  interlay: "coinbridge", bifrost: "bifrostspire", hydration: "drownedmarsh", acala: "haven",
};
/** Remap a floor key like "kusama:5" → "wildlands:5" (the chain prefix only). */
function remapFloorKey(k: string): string {
  const i = k.indexOf(":");
  if (i < 0) return k;
  const pre = k.slice(0, i);
  return (CHAIN_V3[pre] ?? pre) + k.slice(i);
}
/** Recursively rewrite any serialized chain reference ({$chain: "kusama"}) to its new id. */
function deepRemapChain(v: unknown): void {
  if (!v || typeof v !== "object") return;
  if (Array.isArray(v)) { v.forEach(deepRemapChain); return; }
  const o = v as Record<string, unknown>;
  if (typeof o.$chain === "string" && CHAIN_V3[o.$chain]) o.$chain = CHAIN_V3[o.$chain];
  for (const k of Object.keys(o)) deepRemapChain(o[k]);
}

// ── version migrations ───────────────────────────────────────────────────────
// Each entry upgrades a save FROM version N to N+1; they run in sequence so a save from any past
// version is brought current — a schema change never discards a run. Keep them small and data-only
// (mutate the parsed snapshot in place). Structural entity/level drift is handled defensively at
// restore time (entities construct-then-overwrite; Level.fromSnapshot defaults every field), so most
// migrations are just a version bump; register one here only when the SHAPE of the data must change.
const MIGRATIONS: Record<number, (d: Record<string, Json>) => void> = {
  // v1 → v2: room lighting became source-driven (a `lightSources` list per floor). Old floors lack it;
  // Level.fromSnapshot reconstructs the sources from the lit room centers, so there's nothing to
  // rewrite at the top level — advancing the version is enough.
  1: (_d) => { /* self-healed in Level.fromSnapshot */ },
  // v2 → v3: crypto ids reskinned to fantasy (archetype/race/chain). Remap them so an in-progress run
  // keeps its class, race, and its place in the branched dungeon after the rename.
  2: (d) => {
    const meta = d.meta as Record<string, Json> | undefined;
    if (meta) {
      if (typeof meta.archetypeId === "string") meta.archetypeId = ID_V3[meta.archetypeId] ?? meta.archetypeId;
      if (typeof meta.raceId === "string") meta.raceId = ID_V3[meta.raceId] ?? meta.raceId;
      if (typeof meta.currentChain === "string") meta.currentChain = CHAIN_V3[meta.currentChain] ?? meta.currentChain;
      if (typeof meta.activeKey === "string") meta.activeKey = remapFloorKey(meta.activeKey);
    }
    const floors = d.floors as Record<string, Json> | undefined;
    if (floors && typeof floors === "object") {
      for (const k of Object.keys(floors)) { const nk = remapFloorKey(k); if (nk !== k) { floors[nk] = floors[k]; delete floors[k]; } }
    }
    deepRemapChain(d); // rewrite any {$chain:"kusama"} portal/branch reference nested in the floors
  },
  // v3 → v4: last crypto ids → NetHack fantasy — the Amulet item id (jam), the polymorph scroll (fork),
  // the teleport/polymorph traps (reorg/fork), the fountain tile (faucet), and the has-Amulet fields.
  3: (d) => {
    const meta = d.meta as Record<string, Json> | undefined;
    if (meta && "jamStolen" in meta) { meta.amuletStolen = meta.jamStolen; delete meta.jamStolen; }
    renameField((d.player as Record<string, Json> | undefined)?.fields, "hasJam", "hasAmulet");
    renameField((d.coPlayer as Record<string, Json> | undefined)?.fields, "hasJam", "hasAmulet");
    const floors = d.floors as Record<string, { level?: { tiles?: unknown } }> | undefined;
    if (floors) for (const k of Object.keys(floors)) {
      const tiles = floors[k]?.level?.tiles;
      if (Array.isArray(tiles)) for (const row of tiles) if (Array.isArray(row)) for (let i = 0; i < row.length; i++) if (row[i] === "faucet") row[i] = "fountain";
    }
    deepRemapV4(d); // $item ("jam"/"fork") + trap kinds ("reorg"/"fork") wherever they nest
  },
};

/** Bring a parsed save up to the current SAVE_VERSION in place. Returns false only when the save is
 *  from a NEWER build than this one (a future schema we must not guess at) — the caller then leaves
 *  it untouched so the newer build can still load it. A save with no version is treated as v1. */
export function migrateSave(data: Record<string, Json>): boolean {
  let v = typeof data.version === "number" ? (data.version as number) : 1;
  if (v > SAVE_VERSION) return false; // from the future — don't downgrade or corrupt it
  while (v < SAVE_VERSION) {
    MIGRATIONS[v]?.(data);
    data.version = ++v;
  }
  return true;
}

// ── reference-type identity sets (shared, immutable defs) ────────────────────
const itemTypeSet = new Set<object>(ITEMS);
const monSet = new Set<object>(MONSTERS);
const chainSet = new Set<object>([...CHAINS, ...BRANCHES]);

// Transient / derived fields never worth saving (rebuilt on load).
const SKIP = new Set<string>([
  "game", "resolveTurn", "inputQueue", "awaiting", "nameBuf", "castMenu", "signalledThisTurn", "engulfedBy",
  "pending", "pendingDir", "pendingThrow", "pendingApply", "pendingWrite", "pendingWish", "pendingLoot",
  "pendingSpell", "pendingCastDir", "pendingChat", "pendingLook", "pendingWhatIs", "pendingOpen", "pendingClose",
  "pendingKick", "pendingJump", "pendingMonster", "pendingName", "pendingNameMonDir", "pendingNameMon",
  "pendingCharge", "pendingGrease",
]);

type Json = unknown;

/** Generic value serializer: primitives pass through; Sets/Maps/ref-types get tagged; plain objects
 *  are walked (skipping transient keys + functions). Item/def/entity fields are handled explicitly by
 *  the callers, so this only meets primitives, Sets, Maps, def-refs, and nested plain data here. */
function ser(v: Json): Json {
  if (v === null || v === undefined) return null;
  const t = typeof v;
  if (t === "number" || t === "string" || t === "boolean") return v;
  if (t === "function") return undefined;
  if (Array.isArray(v)) return v.map(ser);
  if (v instanceof Set) return { $set: [...v].map(ser) };
  if (v instanceof Map) return { $map: [...v.entries()].map(([k, val]) => [k, ser(val)]) };
  if (itemTypeSet.has(v as object)) return { $item: (v as ItemType).id };
  if (monSet.has(v as object)) return { $mdef: (v as MonsterDef).name };
  if (chainSet.has(v as object)) return { $chain: (v as { id: string }).id };
  const out: Record<string, Json> = {};
  for (const k of Object.keys(v as object)) {
    if (SKIP.has(k)) continue;
    const sv = ser((v as Record<string, Json>)[k]);
    if (sv !== undefined) out[k] = sv;
  }
  return out;
}

function rev(v: Json): Json {
  if (v === null || typeof v !== "object") return v;
  if (Array.isArray(v)) return v.map(rev);
  const o = v as Record<string, Json>;
  if ("$set" in o) return new Set((o.$set as Json[]).map(rev));
  if ("$map" in o) return new Map((o.$map as [string, Json][]).map(([k, val]) => [k, rev(val)]));
  if ("$item" in o) return itemById(o.$item as string) ?? null;
  if ("$mdef" in o) return MONSTERS.find((m) => m.name === o.$mdef) ?? null;
  if ("$mdefv" in o) return o.$mdefv; // a constructed def (boss/feral) — a plain MonsterDef by value
  if ("$chain" in o) return [...CHAINS, ...BRANCHES].find((c) => c.id === o.$chain) ?? null;
  const out: Record<string, Json> = {};
  for (const k of Object.keys(o)) out[k] = rev(o[k]);
  return out;
}

/** A field-bag of everything on an object except the given extra keys (item/equip/def handled apart). */
export function serFields(obj: object, extraSkip: string[] = []): Record<string, Json> {
  const skip = new Set([...SKIP, ...extraSkip]);
  const out: Record<string, Json> = {};
  for (const k of Object.keys(obj)) {
    if (skip.has(k)) continue;
    const sv = ser((obj as Record<string, Json>)[k]);
    if (sv !== undefined) out[k] = sv;
  }
  return out;
}

/** Apply a saved field-bag back onto a (freshly constructed) instance. */
export function restoreFields(target: object, data: Record<string, Json>): void {
  for (const k of Object.keys(data)) (target as Record<string, Json>)[k] = rev(data[k]);
}

// ── items ────────────────────────────────────────────────────────────────────
export function serItem(it: Item): Json {
  return {
    type: it.type.id, charges: it.charges, enchant: it.enchant, relic: it.relic, buc: it.buc, bucKnown: it.bucKnown,
    erosion: it.erosion, erosionKind: it.erosionKind, proofed: it.proofed, label: it.label, lit: it.lit, fuel: it.fuel, unpaid: it.unpaid,
    contents: it.contents ? it.contents.map(serItem) : undefined,
  };
}
export function restoreItem(d: Json): Item | null {
  const o = d as Record<string, Json>;
  const type = itemById(o.type as string);
  if (!type) return null;
  const it: Item = { type };
  for (const k of ["charges", "enchant", "relic", "buc", "bucKnown", "erosion", "erosionKind", "proofed", "label", "lit", "fuel", "unpaid"] as const) {
    if (o[k] !== undefined && o[k] !== null) (it as unknown as Record<string, Json>)[k] = o[k];
  }
  if (o.contents) it.contents = (o.contents as Json[]).map(restoreItem).filter((x): x is Item => !!x);
  return it;
}

// ── floor items (their own shape: type ref + optional corpse def / chest / shop data) ──
export function serFloorItem(fi: Record<string, Json>): Json {
  const o: Record<string, Json> = { x: fi.x, y: fi.y, type: (fi.type as ItemType).id };
  for (const k of ["price", "coins", "enchant", "relic", "buc", "bucKnown", "detected"] as const) {
    if (fi[k] !== undefined) o[k] = fi[k] as Json;
  }
  if (fi.corpse) { const c = fi.corpse as { def: MonsterDef; born: number }; o.corpse = { def: serDef(c.def), born: c.born }; }
  if (fi.chest) o.chest = fi.chest;
  return o;
}
export function restoreFloorItem(d: Json): Record<string, Json> | null {
  const o = d as Record<string, Json>;
  const type = itemById(o.type as string);
  if (!type) return null;
  const fi: Record<string, Json> = { x: o.x, y: o.y, type };
  for (const k of ["price", "coins", "enchant", "relic", "buc", "bucKnown", "detected"] as const) {
    if (o[k] !== undefined) fi[k] = o[k];
  }
  if (o.corpse) { const c = o.corpse as Record<string, Json>; fi.corpse = { def: restoreDef(c.def), born: c.born }; }
  if (o.chest) fi.chest = o.chest;
  return fi;
}

// ── MonsterDef (by name in MONSTERS, else inline by value for constructed defs) ──
export function serDef(def: MonsterDef): Json {
  return monSet.has(def) ? { $mdef: def.name } : { $mdefv: JSON.parse(JSON.stringify(def)) };
}
export function restoreDef(d: Json): MonsterDef {
  const o = d as Record<string, Json>;
  if ("$mdef" in o) return (MONSTERS.find((m) => m.name === o.$mdef) ?? MONSTERS[0]) as MonsterDef;
  return o.$mdefv as MonsterDef;
}

// ── IndexedDB storage (a continuable save + a one-write-behind backup) ───────
const DB = "ascend", STORE = "save", KEY = "run", BAK = "run.bak";
function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  const db = await openDB();
  return new Promise<T>((resolve, reject) => {
    const req = fn(db.transaction(STORE, mode).objectStore(STORE));
    req.onsuccess = () => resolve(req.result as T);
    req.onerror = () => reject(req.error);
  });
}
/** Run several store ops in one transaction, resolving when the whole transaction commits. */
async function txAll(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => void): Promise<void> {
  const db = await openDB();
  return new Promise<void>((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    fn(t.objectStore(STORE));
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}
/** A save is usable only if it round-trips to a shape we recognize (an object with meta + a version). */
function looksValid(d: unknown): d is Record<string, Json> {
  return !!d && typeof d === "object" && !Array.isArray(d)
    && "meta" in (d as object) && !!(d as Record<string, Json>).meta
    && (typeof (d as Record<string, Json>).version === "number" || (d as Record<string, Json>).version === undefined);
}
async function readKey(key: string): Promise<Record<string, Json> | null> {
  try { const d = await tx<Record<string, Json>>("readonly", (s) => s.get(key)); return looksValid(d) ? d : null; }
  catch { return null; }
}

/** Persist the run, rotating the previous good save into a backup first — so a bad or interrupted
 *  primary write is always recoverable to the state one action ago (autosave writes every turn). */
export async function writeSave(data: object): Promise<void> {
  try {
    const prev = await tx<Record<string, Json>>("readonly", (s) => s.get(KEY)).catch(() => null);
    await txAll("readwrite", (s) => { if (looksValid(prev)) s.put(prev, BAK); s.put(data, KEY); });
  } catch { /* storage blocked / quota — skip this write, the last good save stands */ }
}
/** Load the continuable save; if the primary is missing or unreadable, fall back to the backup. */
export async function readSave(): Promise<Record<string, Json> | null> {
  return (await readKey(KEY)) ?? (await readKey(BAK));
}
export async function clearSave(): Promise<void> { try { await txAll("readwrite", (s) => { s.delete(KEY); s.delete(BAK); }); } catch { /* ignore */ } }

// Level type re-export dodge for callers that build $level payloads.
export type { Level };
