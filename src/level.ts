import * as ROT from "rot-js";
import type { TileType } from "./data";
import type { ItemType } from "./items";

export interface FloorItem { x: number; y: number; type: ItemType; }

/** One dungeon level: tiles, fog-of-war, FOV, stairs, items, spawn points. */
export class Level {
  readonly width: number;
  readonly height: number;
  tiles: TileType[][] = [];
  explored: boolean[][] = [];
  items: FloorItem[] = [];
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

    const sc = rooms[0].getCenter();
    this.start = { x: sc[0], y: sc[1] };
    const ec = rooms[rooms.length - 1].getCenter();
    this.stairs = { x: ec[0], y: ec[1] };
    this.tiles[this.stairs.y][this.stairs.x] = "stairsDown";
  }

  private lightPasses(x: number, y: number): boolean {
    const t = this.tiles[y]?.[x];
    return t === "floor" || t === "door" || t === "stairsDown";
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

  revealAll(): void {
    for (let y = 0; y < this.height; y++)
      for (let x = 0; x < this.width; x++)
        if (this.tiles[y][x]) this.explored[y][x] = true;
  }
}
