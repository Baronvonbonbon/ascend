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

export const SAVE_VERSION = 1;

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
    erosion: it.erosion, proofed: it.proofed, label: it.label, lit: it.lit, unpaid: it.unpaid,
    contents: it.contents ? it.contents.map(serItem) : undefined,
  };
}
export function restoreItem(d: Json): Item | null {
  const o = d as Record<string, Json>;
  const type = itemById(o.type as string);
  if (!type) return null;
  const it: Item = { type };
  for (const k of ["charges", "enchant", "relic", "buc", "bucKnown", "erosion", "proofed", "label", "lit", "unpaid"] as const) {
    if (o[k] !== undefined && o[k] !== null) (it as unknown as Record<string, Json>)[k] = o[k];
  }
  if (o.contents) it.contents = (o.contents as Json[]).map(restoreItem).filter((x): x is Item => !!x);
  return it;
}

// ── floor items (their own shape: type ref + optional corpse def / chest / shop data) ──
export function serFloorItem(fi: Record<string, Json>): Json {
  const o: Record<string, Json> = { x: fi.x, y: fi.y, type: (fi.type as ItemType).id };
  for (const k of ["price", "nft", "coins", "enchant", "relic", "mintOnBuy", "buc", "bucKnown", "detected"] as const) {
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
  for (const k of ["price", "nft", "coins", "enchant", "relic", "mintOnBuy", "buc", "bucKnown", "detected"] as const) {
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

// ── IndexedDB storage (one continuable save at a fixed key) ──────────────────
const DB = "ascend", STORE = "save", KEY = "run";
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
export async function writeSave(data: object): Promise<void> { try { await tx("readwrite", (s) => s.put(data, KEY)); } catch { /* storage blocked — skip */ } }
export async function readSave(): Promise<Record<string, Json> | null> { try { return (await tx<Record<string, Json>>("readonly", (s) => s.get(KEY))) ?? null; } catch { return null; } }
export async function clearSave(): Promise<void> { try { await tx("readwrite", (s) => s.delete(KEY)); } catch { /* ignore */ } }

// Level type re-export dodge for callers that build $level payloads.
export type { Level };
