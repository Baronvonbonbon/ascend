// Every Sokoban floor is replayed through the REAL engine push rule (`tryPush` in level.ts),
// not a copy of it. If a template is edited, or the push/chasm semantics change, these fail.
//
// This is the only guard on the hand-built floors: a subtly broken one is otherwise discovered
// by a player losing the branch prize to it.

import { describe, it, expect } from "vitest";
import { Level, tryPush } from "./level";
import { SOKOBAN_SOLO, SOKOBAN_COOP, SokoLevel } from "./soko";

const W = 80, H = 30;
const DIRS: Record<string, [number, number]> = { h: [-1, 0], l: [1, 0], k: [0, -1], j: [0, 1] };

/** Stamp a template onto a real Level, exactly as the game does. */
function stamp(lv: SokoLevel): Level {
  const level = new Level(W, H, "sokoban");
  level.loadSokoban(lv.rows as string[]);
  return level;
}

/** Where a second adventurer stands after arriving at the entry stair. */
function guestStart(level: Level, at: { x: number; y: number }): { x: number; y: number } {
  for (const [dx, dy] of [[-1, 0], [0, 1], [0, -1], [1, 0]] as [number, number][]) {
    const x = at.x + dx, y = at.y + dy;
    if (level.isPassable(x, y) && !level.boulderAt(x, y)) return { x, y };
  }
  throw new Error("no free tile beside the entry stair");
}

/** Circuits currently held down. A boulder never counts — only a body. */
function held(level: Level, bodies: { x: number; y: number }[]): Set<string> {
  const s = new Set<string>();
  for (const b of bodies) { const p = level.plateAt(b.x, b.y); if (p) s.add(p.circuit); }
  return s;
}

/** Settle every gate against who is standing where — the engine's syncGates, in miniature. */
function syncGates(level: Level, bodies: { x: number; y: number }[]): void {
  const open = held(level, bodies);
  for (const g of level.gates) {
    const want = open.has(g.circuit) ? "gateOpen" : "gate";
    if (want === "gate" && bodies.some((b) => b.x === g.x && b.y === g.y)) continue; // never crush anyone
    level.tiles[g.y][g.x] = want;
  }
}

/** Apply one move for `who`, returning false if the engine would have refused it. */
function step(level: Level, bodies: { x: number; y: number }[], who: number, dir: string): boolean {
  const [dx, dy] = DIRS[dir];
  const me = bodies[who];
  const nx = me.x + dx, ny = me.y + dy;
  const other = bodies.find((b, i) => i !== who && b.x === nx && b.y === ny);
  const occupied = (x: number, y: number) => bodies.some((b) => b.x === x && b.y === y);

  if (level.boulderAt(nx, ny)) {
    const r = tryPush(level, nx, ny, dx, dy, occupied);
    if (r !== "moved" && r !== "filled") return false;
  } else if (!level.isPassable(nx, ny)) {
    return false;
  }
  if (other) { other.x = me.x; other.y = me.y; } // walking into your partner swaps you both
  me.x = nx; me.y = ny;
  syncGates(level, bodies);
  return true;
}

/** Can `from` walk to the exit with every gate shut — i.e. with nobody holding a plate? */
function canLeaveUnaided(level: Level, from: { x: number; y: number }): boolean {
  for (const g of level.gates) level.tiles[g.y][g.x] = "gate";
  const seen = new Set([`${from.x},${from.y}`]);
  const q = [from];
  while (q.length) {
    const c = q.pop()!;
    if (c.x === level.stairs.x && c.y === level.stairs.y) return true;
    for (const [dx, dy] of Object.values(DIRS)) {
      const x = c.x + dx, y = c.y + dy, k = `${x},${y}`;
      if (seen.has(k) || !level.isPassable(x, y) || level.boulderAt(x, y)) continue;
      seen.add(k); q.push({ x, y });
    }
  }
  return false;
}

describe("Sokoban templates", () => {
  const all = [...SOKOBAN_SOLO, ...SOKOBAN_COOP];

  it.each(all.map((l) => [l.name, l] as const))("%s is rectangular and well-formed", (_n, lv) => {
    const w = lv.rows[0].length;
    for (const row of lv.rows) expect(row.length).toBe(w);
    const flat = lv.rows.join("");
    expect(flat.split("<").length - 1).toBe(1); // exactly one entry
    expect(flat.split(">").length - 1).toBe(1); // exactly one exit
    // Every gate has a plate to hold it, and every plate has a gate to open.
    const level = stamp(lv);
    for (const g of level.gates) expect(level.plates.some((p) => p.circuit === g.circuit)).toBe(true);
    for (const p of level.plates) expect(level.gates.some((g) => g.circuit === p.circuit)).toBe(true);
  });

  it.each(SOKOBAN_SOLO.map((l) => [l.name, l] as const))("solo: %s is solved by its recorded line", (_n, lv) => {
    const level = stamp(lv);
    const bodies = [{ ...level.start }];
    for (const [i, mv] of lv.solution.split(" ").entries()) {
      expect(DIRS[mv], `move ${i} "${mv}" is not a direction`).toBeDefined();
      expect(step(level, bodies, 0, mv), `move ${i} ("${mv}") was refused`).toBe(true);
    }
    expect(bodies[0]).toEqual({ x: level.stairs.x, y: level.stairs.y });
  });

  it.each(SOKOBAN_COOP.map((l) => [l.name, l] as const))("co-op: %s is solved by its recorded line", (_n, lv) => {
    const level = stamp(lv);
    const bodies = [{ ...level.start }, guestStart(level, level.start)];
    syncGates(level, bodies);
    for (const [i, mv] of lv.solution.split(" ").entries()) {
      const who = Number(mv[0]), dir = mv.slice(1);
      expect(who === 0 || who === 1, `move ${i} "${mv}" names no adventurer`).toBe(true);
      expect(step(level, bodies, who, dir), `move ${i} ("${mv}") was refused`).toBe(true);
    }
    // Both must be able to walk out with no plate held — players take the stairs independently,
    // so a solution that leaves one behind a gate would strand whoever goes last.
    for (const b of bodies) expect(canLeaveUnaided(level, b)).toBe(true);
  });

  it.each(SOKOBAN_COOP.map((l) => [l.name, l] as const))("co-op: %s is gated at all", (_n, lv) => {
    const level = stamp(lv);
    expect(level.gates.length).toBeGreaterThan(0);
    expect(level.plates.length).toBeGreaterThan(0);
  });

  it("a boulder can never be wedged into a gateway", () => {
    // Wedging one there would stop the gate ever dropping, which would let a lone player prop a
    // gate open and walk through it — collapsing every co-op floor into a solo one.
    const level = stamp(SOKOBAN_COOP[0]);
    const g = level.gates[0];
    for (const [dx, dy] of Object.values(DIRS)) {
      const bx = g.x - dx, by = g.y - dy;          // a boulder one step "behind" the gateway
      level.boulders = [{ x: bx, y: by }];
      expect(tryPush(level, bx, by, dx, dy, () => false)).toBe("blocked");
    }
  });

  it("a boulder shoved into a chasm is consumed and leaves floor", () => {
    const level = stamp(SOKOBAN_SOLO[0]);
    const before = level.boulders.length;
    // `tryPush` moves the boulder object in place, so snapshot where it started.
    const from = { ...level.boulders[0] };
    // "the First Chasm" sits its boulder two tiles below the chasm: one shove to close the gap,
    // a second to fill it.
    const pit = { x: from.x, y: from.y - 2 };
    expect(level.tileAt(pit.x, pit.y)).toBe("pit");
    expect(tryPush(level, from.x, from.y, 0, -1, () => false)).toBe("moved");
    expect(level.boulders.length).toBe(before);
    expect(tryPush(level, from.x, from.y - 1, 0, -1, () => false)).toBe("filled");
    expect(level.boulders.length).toBe(before - 1);
    expect(level.tileAt(pit.x, pit.y)).toBe("floor");
  });
});
