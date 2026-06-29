import * as ROT from "rot-js";
import type { TileType, ChainDef } from "./data";
import type { ItemType } from "./items";

export type LevelKind = "normal" | "bigroom" | "maze" | "cave" | "labyrinth" | "grid" | "swamp";
export interface Portal { x: number; y: number; chain: ChainDef; quest?: boolean; }

export interface FloorItem { x: number; y: number; type: ItemType; price?: number; enchant?: number; relic?: boolean; mintOnBuy?: boolean; buc?: import("./items").Buc; bucKnown?: boolean; corpse?: { def: import("./data").MonsterDef; born: number }; chest?: { locked: boolean }; } // price = shop ware; relic/enchant/mintOnBuy = NFT gear; buc = sanctity; corpse = edible remains; chest = container
export type TrapKind = "gas" | "reorg" | "slash" | "fork";
export interface Trap { x: number; y: number; kind: TrapKind; revealed: boolean; }
/** A sigil scratched in the dust (the Gray Paper) that wards monsters from the tile; it scuffs away. */
export interface Engraving { x: number; y: number; life: number; }

/** One dungeon level: tiles, fog-of-war, FOV, stairs, items, spawn points. */
export class Level {
  readonly width: number;
  readonly height: number;
  tiles: TileType[][] = [];
  explored: boolean[][] = [];
  items: FloorItem[] = [];
  graves: { x: number; y: number; label: string }[] = []; // bones of fallen heroes
  traps: Trap[] = [];
  engravings: Engraving[] = []; // Gray-Paper wards scratched in the dust
  boulders: { x: number; y: number }[] = []; // pushable blocks (Sokoban-flavor)
  portals: Portal[] = []; // XCM portals to parachain branches
  roomCenters: { x: number; y: number }[] = [];
  start = { x: 1, y: 1 };
  stairs = { x: 1, y: 1 };
  readonly kind: LevelKind;

  private visible = new Set<string>();
  private fov: InstanceType<typeof ROT.FOV.PreciseShadowcasting>;
  private floors: { x: number; y: number }[] = [];

  constructor(width: number, height: number, kind: LevelKind = "normal") {
    this.width = width;
    this.height = height;
    this.kind = kind;
    for (let y = 0; y < height; y++) {
      this.tiles[y] = [];
      this.explored[y] = [];
      for (let x = 0; x < width; x++) {
        this.tiles[y][x] = "wall";
        this.explored[y][x] = false;
      }
    }
    if (kind === "bigroom") this.generateBigRoom();
    else if (kind === "maze") this.generateMaze();
    else if (kind === "cave") this.generateCave();
    else if (kind === "labyrinth") this.generateLabyrinth();
    else if (kind === "grid") this.generateGrid();
    else if (kind === "swamp") this.generateSwamp();
    else this.generate();
    this.fov = new ROT.FOV.PreciseShadowcasting((x, y) => this.lightPasses(x, y));
  }

  /** Wipe a half-built layout and fall back to standard rooms (degenerate-generation guard). */
  private resetAndGenerate(): void {
    for (let y = 0; y < this.height; y++) for (let x = 0; x < this.width; x++) this.tiles[y][x] = "wall";
    this.floors = []; this.roomCenters = [];
    this.generate();
  }

  /** BFS the floors reachable from a point (8-dir, matching player movement). */
  private reachableFrom(s: { x: number; y: number }): Set<string> {
    const seen = new Set<string>([`${s.x},${s.y}`]);
    const q: { x: number; y: number }[] = [s];
    const offs = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]];
    while (q.length) {
      const c = q.shift()!;
      for (const [dx, dy] of offs) {
        const nx = c.x + dx, ny = c.y + dy, k = `${nx},${ny}`;
        if (!seen.has(k) && this.isPassable(nx, ny)) { seen.add(k); q.push({ x: nx, y: ny }); } // water blocks reachability — islands connect only via causeways
      }
    }
    return seen;
  }

  /** Shared finish: pick a start near a corner, the down-stair at the farthest *reachable* cell. */
  private finishLayout(): void {
    if (this.floors.length < 40) { this.resetAndGenerate(); return; } // too cramped — fall back to standard rooms
    this.start = this.floors.reduce((a, b) => (a.x + a.y <= b.x + b.y ? a : b));
    const reach = this.reachableFrom(this.start);
    if (reach.size < 40) { this.resetAndGenerate(); return; }
    let far = this.start, best = -1;
    for (const k of reach) {
      const [x, y] = k.split(",").map(Number);
      const d = Math.abs(x - this.start.x) + Math.abs(y - this.start.y);
      if (d > best) { best = d; far = { x, y }; }
    }
    this.stairs = { ...far };
    this.tiles[this.stairs.y][this.stairs.x] = "stairsDown";
    if (this.roomCenters.length === 0) this.roomCenters = ROT.RNG.shuffle(this.floors.slice()).slice(0, 16);
    this.floors = this.floors.filter((f) => reach.has(`${f.x},${f.y}`)); // only spawn in reachable space
  }

  /** Caves: cellular-automata caverns — organic, open (the Mines). */
  private generateCave(): void {
    const w = this.width, h = this.height;
    let m: boolean[][] = []; // true = wall
    for (let y = 0; y < h; y++) { m[y] = []; for (let x = 0; x < w; x++) m[y][x] = x === 0 || y === 0 || x === w - 1 || y === h - 1 || ROT.RNG.getUniform() < 0.45; }
    for (let it = 0; it < 4; it++) {
      const n: boolean[][] = [];
      for (let y = 0; y < h; y++) {
        n[y] = [];
        for (let x = 0; x < w; x++) {
          if (x === 0 || y === 0 || x === w - 1 || y === h - 1) { n[y][x] = true; continue; }
          let walls = 0;
          for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (!(dx === 0 && dy === 0) && m[y + dy][x + dx]) walls++;
          n[y][x] = walls >= 5;
        }
      }
      m = n;
    }
    // keep only the largest open region (guarantees one connected cavern)
    const region = new Map<string, number>();
    let regions: { x: number; y: number }[][] = [];
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
      if (m[y][x] || region.has(`${x},${y}`)) continue;
      const cells: { x: number; y: number }[] = []; const q = [{ x, y }]; region.set(`${x},${y}`, regions.length);
      while (q.length) {
        const c = q.shift()!; cells.push(c);
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = c.x + dx, ny = c.y + dy, k = `${nx},${ny}`;
          if (!m[ny]?.[nx] && !region.has(k)) { region.set(k, regions.length); q.push({ x: nx, y: ny }); }
        }
      }
      regions.push(cells);
    }
    const big = regions.sort((a, b) => b.length - a.length)[0] ?? [];
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) this.tiles[y][x] = "wall";
    for (const c of big) { this.tiles[c.y][c.x] = "floor"; this.floors.push(c); }
    this.finishLayout();
  }

  /** Labyrinth: a maze with open chambers carved into it (rooms + corridors). */
  private generateLabyrinth(): void {
    const maze = new ROT.Map.EllerMaze(this.width, this.height);
    maze.create((x, y, wall) => { if (!wall && x > 0 && y > 0 && x < this.width - 1 && y < this.height - 1) { this.tiles[y][x] = "floor"; } });
    // carve a handful of rectangular rooms over the maze
    const centers: { x: number; y: number }[] = [];
    for (let i = 0; i < 7; i++) {
      const rw = 4 + Math.floor(ROT.RNG.getUniform() * 5), rh = 3 + Math.floor(ROT.RNG.getUniform() * 3);
      const rx = 2 + Math.floor(ROT.RNG.getUniform() * (this.width - rw - 4)), ry = 2 + Math.floor(ROT.RNG.getUniform() * (this.height - rh - 4));
      for (let y = ry; y < ry + rh; y++) for (let x = rx; x < rx + rw; x++) this.tiles[y][x] = "floor";
      centers.push({ x: rx + (rw >> 1), y: ry + (rh >> 1) });
    }
    for (let y = 1; y < this.height - 1; y++) for (let x = 1; x < this.width - 1; x++) if (this.tiles[y][x] === "floor") this.floors.push({ x, y });
    this.roomCenters = centers;
    this.finishLayout();
  }

  /** Grid / city: rooms in blocks joined by orthogonal streets (a rollup metropolis). */
  private generateGrid(): void {
    const w = this.width, h = this.height, cell = 11;
    const carve = (x: number, y: number) => { if (x > 0 && y > 0 && x < w - 1 && y < h - 1) this.tiles[y][x] = "floor"; };
    // streets: a connected grid of corridors
    for (let x = cell; x < w - 1; x += cell) for (let y = 1; y < h - 1; y++) carve(x, y);
    for (let y = cell; y < h - 1; y += cell) for (let x = 1; x < w - 1; x++) carve(x, y);
    // blocks: a room inset in each cell, with a doorway onto a street
    const centers: { x: number; y: number }[] = [];
    for (let bx = 1; bx < w - cell; bx += cell) for (let by = 1; by < h - cell; by += cell) {
      const rx = bx + 1, ry = by + 1, rw = cell - 3, rh = cell - 3;
      if (rx + rw >= w - 1 || ry + rh >= h - 1) continue;
      for (let y = ry; y < ry + rh; y++) for (let x = rx; x < rx + rw; x++) carve(x, y);
      carve(rx + (rw >> 1), ry + rh); carve(rx + (rw >> 1), ry - 1); // doorways to the streets above/below
      centers.push({ x: rx + (rw >> 1), y: ry + (rh >> 1) });
    }
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) if (this.tiles[y][x] === "floor") this.floors.push({ x, y });
    this.roomCenters = centers;
    this.finishLayout();
  }

  /** Swamp: open water studded with island rooms, joined by narrow causeways (the Liquidity Pools). */
  private generateSwamp(): void {
    const w = this.width, h = this.height;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) this.tiles[y][x] = (x === 0 || y === 0 || x === w - 1 || y === h - 1) ? "wall" : "water";
    const carve = (x: number, y: number) => { if (x > 0 && y > 0 && x < w - 1 && y < h - 1) this.tiles[y][x] = "floor"; };
    // scatter rectangular islands of dry floor
    const centers: { x: number; y: number }[] = [];
    const n = 6 + Math.floor(ROT.RNG.getUniform() * 4);
    for (let i = 0; i < n; i++) {
      const rw = 3 + Math.floor(ROT.RNG.getUniform() * 5), rh = 3 + Math.floor(ROT.RNG.getUniform() * 4);
      const rx = 2 + Math.floor(ROT.RNG.getUniform() * (w - rw - 4)), ry = 2 + Math.floor(ROT.RNG.getUniform() * (h - rh - 4));
      for (let y = ry; y < ry + rh; y++) for (let x = rx; x < rx + rw; x++) carve(x, y);
      centers.push({ x: rx + (rw >> 1), y: ry + (rh >> 1) });
    }
    // chain the islands with L-shaped causeways so every island is reachable on foot
    for (let i = 1; i < centers.length; i++) {
      const a = centers[i - 1], b = centers[i];
      for (let x = Math.min(a.x, b.x); x <= Math.max(a.x, b.x); x++) carve(x, a.y);
      for (let y = Math.min(a.y, b.y); y <= Math.max(a.y, b.y); y++) carve(b.x, y);
    }
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) if (this.tiles[y][x] === "floor") this.floors.push({ x, y });
    this.roomCenters = centers;
    this.finishLayout();
  }

  /** Gehennom: a claustrophobic perfect maze of narrow corridors (NetHack's Hell). */
  private generateMaze(): void {
    const maze = new ROT.Map.EllerMaze(this.width, this.height);
    maze.create((x, y, wall) => {
      if (!wall && x > 0 && y > 0 && x < this.width - 1 && y < this.height - 1) {
        this.tiles[y][x] = "floor";
        this.floors.push({ x, y });
      }
    });
    if (this.floors.length === 0) { this.generate(); return; } // safety net
    // start at one corner-most floor; the down-stair at the farthest reachable floor
    this.start = this.floors.reduce((a, b) => (a.x + a.y <= b.x + b.y ? a : b));
    let far = this.start, best = -1;
    for (const f of this.floors) { const d = Math.abs(f.x - this.start.x) + Math.abs(f.y - this.start.y); if (d > best) { best = d; far = f; } }
    this.stairs = { ...far };
    this.tiles[this.stairs.y][this.stairs.x] = "stairsDown";
    // sample floors as "room centres" so features/monsters scatter through the maze
    this.roomCenters = ROT.RNG.shuffle(this.floors.slice()).slice(0, 16);
  }

  /** The Mempool: one vast open chamber (NetHack's Big Room) — a swarm arena. */
  private generateBigRoom(): void {
    for (let y = 1; y < this.height - 1; y++) {
      for (let x = 1; x < this.width - 1; x++) {
        this.tiles[y][x] = "floor";
        this.floors.push({ x, y });
      }
    }
    // A scattering of "room centres" so features/monsters distribute across the floor.
    for (let i = 0; i < 14; i++) {
      this.roomCenters.push({ x: 3 + ROT.RNG.getUniformInt(0, this.width - 7), y: 2 + ROT.RNG.getUniformInt(0, this.height - 5) });
    }
    this.start = { x: 2, y: 2 };
    this.stairs = { x: this.width - 3, y: this.height - 3 };
    this.tiles[this.stairs.y][this.stairs.x] = "stairsDown";
  }

  private generate() {
    const digger = new ROT.Map.Digger(this.width, this.height, { dugPercentage: 0.3 });
    digger.create((x, y, wall) => {
      if (!wall) {
        this.tiles[y][x] = "floor";
        this.floors.push({ x, y });
      }
    });

    const rooms = digger.getRooms();
    for (const room of rooms) {
      room.getDoors((x, y) => {
        if (this.tiles[y]?.[x] === "floor") {
          const r = ROT.RNG.getUniform(); // some doors start hidden / locked / closed
          this.tiles[y][x] = r < 0.08 ? "doorHidden" : r < 0.18 ? "doorLocked" : r < 0.45 ? "doorClosed" : "door";
        }
      });
    }

    this.roomCenters = rooms.map((r) => { const c = r.getCenter(); return { x: c[0], y: c[1] }; });
    this.start = { ...this.roomCenters[0] };
    this.stairs = { ...this.roomCenters[this.roomCenters.length - 1] };
    this.tiles[this.stairs.y][this.stairs.x] = "stairsDown";
  }

  private lightPasses(x: number, y: number): boolean {
    const t = this.tiles[y]?.[x];
    // sight crosses open water (you see the far shore) but you cannot walk into it
    return t === "floor" || t === "door" || t === "stairsDown" || t === "stairsUp" || t === "altar" || t === "portal" || t === "faucet" || t === "throne" || t === "vibrating" || t === "water";
  }

  isPassable(x: number, y: number): boolean {
    return this.lightPasses(x, y) && this.tiles[y]?.[x] !== "water";
  }

  tileAt(x: number, y: number): TileType | null {
    return this.tiles[y]?.[x] ?? null;
  }

  isVisible(x: number, y: number): boolean {
    return this.visible.has(`${x},${y}`);
  }

  computeFOV(px: number, py: number, radius = 8): void {
    this.visible.clear();
    this.addFOV(px, py, radius);
  }

  /** Add one viewpoint's field of view to the visible set (for multi-player union FOV). */
  addFOV(px: number, py: number, radius = 8): void {
    this.fov.compute(px, py, radius, (x: number, y: number, _r: number, vis: number) => {
      if (vis > 0 && this.tiles[y]?.[x]) {
        this.visible.add(`${x},${y}`);
        this.explored[y][x] = true;
      }
    });
  }

  randomFloor(): { x: number; y: number } {
    return ROT.RNG.getItem(this.floors)!;
  }

  itemAt(x: number, y: number): FloorItem | undefined {
    return this.items.find((i) => i.x === x && i.y === y);
  }

  graveAt(x: number, y: number): { x: number; y: number; label: string } | undefined {
    return this.graves.find((g) => g.x === x && g.y === y);
  }

  trapAt(x: number, y: number): Trap | undefined {
    return this.traps.find((t) => t.x === x && t.y === y);
  }

  portalAt(x: number, y: number): Portal | undefined {
    return this.portals.find((p) => p.x === x && p.y === y);
  }

  engravingAt(x: number, y: number): Engraving | undefined {
    return this.engravings.find((e) => e.x === x && e.y === y && e.life > 0);
  }

  boulderAt(x: number, y: number): { x: number; y: number } | undefined {
    return this.boulders.find((b) => b.x === x && b.y === y);
  }

  revealAll(): void {
    for (let y = 0; y < this.height; y++)
      for (let x = 0; x < this.width; x++)
        if (this.tiles[y][x]) this.explored[y][x] = true;
  }
}
