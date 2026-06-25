import * as ROT from "rot-js";
import { Level } from "./level";
import { Entity, Player, Monster } from "./entities";
import { Log } from "./log";
import {
  COLORS, TILE_GLYPH, MONSTERS, MonsterDef, DEATHS, GREETINGS,
} from "./data";

const W = 80;
const MAP_H = 30;
const H = MAP_H + 2; // + a blank row + the status line

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export class Game {
  readonly display: ROT.Display;
  readonly log: Log;
  level!: Level;
  player!: Player;
  monsters: Monster[] = [];
  private scheduler = new ROT.Scheduler.Simple<Entity>();
  private engine!: ROT.Engine;
  private over = false;

  constructor(screen: HTMLElement, logEl: HTMLElement) {
    this.display = new ROT.Display({
      width: W, height: H, fontSize: 18,
      fontFamily: '"Courier New", monospace', fg: COLORS.floor, bg: COLORS.bg,
    });
    screen.appendChild(this.display.getContainer()!);
    this.log = new Log(logEl);
    window.addEventListener("keydown", (e) => this.onKey(e));
    this.newGame();
  }

  // ── lifecycle ──────────────────────────────────────────────────────────────
  newGame(): void {
    this.over = false;
    this.scheduler.clear();
    this.monsters = [];
    this.level = new Level(W, MAP_H);
    this.player = new Player(this, this.level.start.x, this.level.start.y);
    this.spawnMonsters();
    this.scheduler.add(this.player, true);
    for (const m of this.monsters) this.scheduler.add(m, true);
    this.level.computeFOV(this.player.x, this.player.y);
    this.log.add(ROT.RNG.getItem(GREETINGS)!, "sys");
    this.draw();
    this.engine = new ROT.Engine(this.scheduler);
    this.engine.start();
  }

  descend(): void {
    this.player.depth++;
    this.level = new Level(W, MAP_H);
    this.player.x = this.level.start.x;
    this.player.y = this.level.start.y;
    this.monsters = [];
    this.scheduler.clear();
    this.scheduler.add(this.player, true);
    this.spawnMonsters();
    for (const m of this.monsters) this.scheduler.add(m, true);
    this.level.computeFOV(this.player.x, this.player.y);
    this.log.add(`You descend to depth ${this.player.depth}. The stack deepens.`, "sys");
    this.draw();
  }

  private gameOver(): void {
    if (this.over) return;
    this.over = true;
    this.player.hp = 0;
    this.log.add(ROT.RNG.getItem(DEATHS)!, "bad");
    this.log.add(`You fell at depth ${this.player.depth}. Press R to try again.`, "sys");
    this.draw();
  }

  // ── combat ─────────────────────────────────────────────────────────────────
  attack(a: Entity, d: Entity): void {
    const [lo, hi] = a.attackDmg;
    const dmg = ROT.RNG.getUniformInt(lo, hi);
    d.hp -= dmg;
    if (a === this.player) this.log.add(`You strike ${d.name} for ${dmg}.`, "good");
    else if (d === this.player) this.log.add(`${cap(a.name)} hits you for ${dmg}.`, "bad");
    if (d.hp <= 0) this.kill(d);
  }

  private kill(d: Entity): void {
    if (d === this.player) { this.gameOver(); return; }
    const m = d as Monster;
    this.monsters = this.monsters.filter((x) => x !== m);
    this.scheduler.remove(m);
    this.log.add(`${cap(m.name)} is destroyed.`, "good");
  }

  // ── spawns ─────────────────────────────────────────────────────────────────
  private spawnMonsters(): void {
    const depth = this.player.depth;
    const count = 4 + Math.floor(depth * 1.5);
    for (let i = 0; i < count; i++) {
      const def = this.pickMonster(depth);
      let pos = this.level.randomFloor();
      let tries = 0;
      while (
        tries < 60 &&
        (this.monsterAt(pos.x, pos.y) ||
          (pos.x === this.player.x && pos.y === this.player.y) ||
          this.level.tileAt(pos.x, pos.y) === "stairsDown")
      ) {
        pos = this.level.randomFloor();
        tries++;
      }
      this.monsters.push(new Monster(this, def, pos.x, pos.y));
    }
  }

  private pickMonster(depth: number): MonsterDef {
    const pool = MONSTERS.filter((m) => m.minDepth <= depth);
    const total = pool.reduce((s, m) => s + m.weight, 0);
    let r = ROT.RNG.getUniform() * total;
    for (const m of pool) { r -= m.weight; if (r <= 0) return m; }
    return pool[0];
  }

  monsterAt(x: number, y: number): Monster | undefined {
    return this.monsters.find((m) => m.alive && m.x === x && m.y === y);
  }

  // ── input + render ───────────────────────────────────────────────────────
  private onKey(e: KeyboardEvent): void {
    if (this.over) {
      if (e.key === "r" || e.key === "R") this.newGame();
      return;
    }
    if (this.player.handleKey(e)) e.preventDefault();
  }

  draw(): void {
    this.display.clear();
    for (let y = 0; y < MAP_H; y++) {
      for (let x = 0; x < W; x++) {
        const t = this.level.tileAt(x, y);
        if (!t) continue;
        const g = TILE_GLYPH[t];
        if (this.level.isVisible(x, y)) this.display.draw(x, y, g.ch, g.fg, COLORS.bg);
        else if (this.level.explored[y][x]) this.display.draw(x, y, g.ch, g.fgDim, COLORS.bg);
      }
    }
    for (const m of this.monsters) {
      if (m.alive && this.level.isVisible(m.x, m.y)) this.display.draw(m.x, m.y, m.ch, m.fg, COLORS.bg);
    }
    this.display.draw(this.player.x, this.player.y, this.player.ch, this.player.fg, COLORS.bg);

    const p = this.player;
    const hpCol = p.hp <= p.maxHp * 0.3 ? COLORS.bad : COLORS.good;
    this.display.drawText(
      1, MAP_H + 1,
      `%c{${COLORS.dim}}HP %c{${hpCol}}${p.hp}%c{${COLORS.dim}}/${p.maxHp}   Depth %c{${COLORS.gold}}${p.depth}%c{${COLORS.dim}}   PAS %c{${COLORS.gold}}${p.pas}%c{${COLORS.dim}}   JAM: not found`,
    );
  }
}
