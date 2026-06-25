import * as ROT from "rot-js";
import type { Game } from "./game";
import { COLORS, MonsterDef } from "./data";

export abstract class Entity {
  x = 0;
  y = 0;
  ch = "?";
  fg = "#ffffff";
  name = "thing";
  hp = 1;
  maxHp = 1;
  attackDmg: [number, number] = [1, 1];

  constructor(protected game: Game) {}

  get alive(): boolean {
    return this.hp > 0;
  }

  abstract act(): void | Promise<void>;
}

// Chebyshev (8-dir) movement deltas keyed by KeyboardEvent.key.
const MOVES: Record<string, [number, number]> = {
  ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0],
  k: [0, -1], j: [0, 1], h: [-1, 0], l: [1, 0],
  y: [-1, -1], u: [1, -1], b: [-1, 1], n: [1, 1],
  "8": [0, -1], "2": [0, 1], "4": [-1, 0], "6": [1, 0],
  "7": [-1, -1], "9": [1, -1], "1": [-1, 1], "3": [1, 1],
};

export class Player extends Entity {
  depth = 1;
  pas = 0; // PAS balance — wired to chain in Phase 2
  private resolveTurn: (() => void) | null = null;

  constructor(game: Game, x: number, y: number) {
    super(game);
    this.x = x;
    this.y = y;
    this.ch = "@";
    this.fg = COLORS.player;
    this.name = "you";
    this.hp = this.maxHp = 20;
    this.attackDmg = [2, 5];
  }

  act(): Promise<void> {
    this.game.draw(); // start of the player's turn = monsters have moved
    return new Promise((resolve) => { this.resolveTurn = resolve; });
  }

  private endTurn(): boolean {
    const r = this.resolveTurn;
    this.resolveTurn = null;
    if (r) r();
    return true;
  }

  /** Returns true if a turn was consumed (a key the engine should act on). */
  handleKey(e: KeyboardEvent): boolean {
    const mv = MOVES[e.key];
    if (mv) return this.tryMove(mv[0], mv[1]);
    if (e.key === "." || e.key === "5") { this.game.log.add("You wait.", "dim"); return this.endTurn(); }
    if (e.key === ">") return this.tryDescend();
    return false;
  }

  private tryMove(dx: number, dy: number): boolean {
    const nx = this.x + dx, ny = this.y + dy;
    const foe = this.game.monsterAt(nx, ny);
    if (foe) { this.game.attack(this, foe); return this.endTurn(); }
    if (!this.game.level.isPassable(nx, ny)) return false; // bumping a wall costs no turn
    this.x = nx; this.y = ny;
    this.game.level.computeFOV(this.x, this.y);
    this.game.draw();
    return this.endTurn();
  }

  private tryDescend(): boolean {
    if (this.game.level.tileAt(this.x, this.y) !== "stairsDown") {
      this.game.log.add("There are no stairs down here.", "dim");
      return false;
    }
    this.game.descend();
    return this.endTurn();
  }
}

export class Monster extends Entity {
  constructor(game: Game, public def: MonsterDef, x: number, y: number) {
    super(game);
    this.x = x;
    this.y = y;
    this.ch = def.ch;
    this.fg = def.fg;
    this.name = def.name;
    this.hp = this.maxHp = def.hp;
    this.attackDmg = def.dmg;
  }

  act(): void {
    const p = this.game.player;
    if (!p.alive || !this.alive) return;

    const dist = Math.max(Math.abs(this.x - p.x), Math.abs(this.y - p.y));
    if (dist === 1) { this.game.attack(this, p); return; }

    // Chase only what the player can see (symmetric awareness).
    if (this.def.ai === "chase" && this.game.level.isVisible(this.x, this.y) && dist <= 9) {
      const dij = new ROT.Path.Dijkstra(p.x, p.y, (x, y) => this.game.level.isPassable(x, y), { topology: 8 });
      const path: [number, number][] = [];
      dij.compute(this.x, this.y, (x, y) => path.push([x, y]));
      path.shift(); // drop current tile
      if (path.length) {
        const [nx, ny] = path[0];
        if (nx === p.x && ny === p.y) { this.game.attack(this, p); return; }
        if (!this.game.monsterAt(nx, ny)) { this.x = nx; this.y = ny; }
      }
      return;
    }

    // Wander.
    const d = ROT.RNG.getItem([[-1, 0], [1, 0], [0, -1], [0, 1]] as [number, number][])!;
    const nx = this.x + d[0], ny = this.y + d[1];
    if (this.game.level.isPassable(nx, ny) && !this.game.monsterAt(nx, ny) && !(nx === p.x && ny === p.y)) {
      this.x = nx; this.y = ny;
    }
  }
}
