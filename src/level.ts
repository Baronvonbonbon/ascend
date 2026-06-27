import * as ROT from "rot-js";
import type { TileType, ChainDef } from "./data";
import type { ItemType } from "./items";

export interface Portal { x: number; y: number; chain: ChainDef; }

export interface FloorItem { x: number; y: number; type: ItemType; price?: number; enchant?: number; relic?: boolean; mintOnBuy?: boolean; buc?: import("./items").Buc; bucKnown?: boolean; corpse?: { def: import("./data").MonsterDef; born: number }; } // price = shop ware; relic/enchant/mintOnBuy = NFT gear; buc = sanctity; corpse = edible remains
export type TrapKind = "gas" | "reorg" | "slash";
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
  portals: Portal[] = []; // XCM portals to parachain branches
  roomCenters: { x: number; y: number }[] = [];
  start = { x: 1, y: 1 };
  stairs = { x: 1, y: 1 };

  private visible = new Set<string>();
  private fov: InstanceType<typeof ROT.FOV.PreciseShadowcasting>;
  private floors: { x: number; y: number }[] = [];

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    for (let y = 0; y < height; y++) {
      this.tiles[y] = [];
      this.explored[y] = [];
      for (let x = 0; x < width; x++) {
        this.tiles[y][x] = "wall";
        this.explored[y][x] = false;
      }
    }
    this.generate();
    this.fov = new ROT.FOV.PreciseShadowcasting((x, y) => this.lightPasses(x, y));
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
        if (this.tiles[y]?.[x] === "floor") this.tiles[y][x] = "door";
      });
    }

    this.roomCenters = rooms.map((r) => { const c = r.getCenter(); return { x: c[0], y: c[1] }; });
    this.start = { ...this.roomCenters[0] };
    this.stairs = { ...this.roomCenters[this.roomCenters.length - 1] };
    this.tiles[this.stairs.y][this.stairs.x] = "stairsDown";
  }

  private lightPasses(x: number, y: number): boolean {
    const t = this.tiles[y]?.[x];
    return t === "floor" || t === "door" || t === "stairsDown" || t === "stairsUp" || t === "altar" || t === "portal";
  }

  isPassable(x: number, y: number): boolean {
    return this.lightPasses(x, y);
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

  revealAll(): void {
    for (let y = 0; y < this.height; y++)
      for (let x = 0; x < this.width; x++)
        if (this.tiles[y][x]) this.explored[y][x] = true;
  }
}
