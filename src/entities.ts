import * as ROT from "rot-js";
import type { Game } from "./game";
import { COLORS, MonsterDef } from "./data";
import { Inventory, Item } from "./inventory";

type Verb = "wield" | "wear" | "quaff" | "read" | "eat" | "drop";
const VERB_PROMPT: Record<Verb, string> = {
  wield: "Wield which weapon?", wear: "Wear which armor?",
  quaff: "Quaff which potion?", read: "Read which scroll?",
  eat: "Eat what?", drop: "Drop which item?",
};

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

  getSpeed(): number {
    return 100;
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
  nutrition = 900;
  ac = 0;
  inventory = new Inventory();
  weapon: Item | null = null;
  armor: Item | null = null;
  ring: Item | null = null;
  stealth = false;     // ring of privacy — monsters can't track you
  regenFast = false;   // ring of regeneration
  private regenTimer = 0;
  hasJam = false;
  maxDepthReached = 1;
  weaponBonus = 0; // from scrolls of enchantment
  prayerCooldown = 0;

  /** Recompute attack damage from the wielded weapon (or fists) + enchant bonus. */
  applyWeapon(): void {
    if (this.weapon) this.attackDmg = [this.weapon.type.dmg![0] + this.weaponBonus, this.weapon.type.dmg![1] + this.weaponBonus];
    else this.attackDmg = [1, 3];
  }

  /** Apply (on=true) or revert a worn ring's passive effect. */
  applyRing(item: Item, on: boolean): void {
    switch (item.type.id) {
      case "ring_res": this.maxHp += on ? 6 : -6; if (on) this.hp += 6; this.hp = Math.min(this.hp, this.maxHp); break;
      case "ring_regen": this.regenFast = on; break;
      case "ring_priv": this.stealth = on; break;
    }
  }
  private pending: Verb | null = null;
  private resolveTurn: (() => void) | null = null;

  constructor(game: Game, x: number, y: number) {
    super(game);
    this.x = x;
    this.y = y;
    this.ch = "@";
    this.fg = COLORS.player;
    this.name = "you";
    this.hp = this.maxHp = 20;
    this.attackDmg = [1, 3]; // bare hands
  }

  act(): Promise<void> {
    this.game.draw(); // start of the player's turn = monsters have moved
    return new Promise((resolve) => { this.resolveTurn = resolve; });
  }

  private endTurn(): boolean {
    this.tickHunger();
    if (this.prayerCooldown > 0) this.prayerCooldown--;
    // Natural regeneration (faster with a ring of regeneration; not while starving).
    if (this.hp < this.maxHp && this.nutrition > 0 && ++this.regenTimer >= (this.regenFast ? 5 : 14)) {
      this.regenTimer = 0; this.hp++;
    }
    const r = this.resolveTurn;
    this.resolveTurn = null;
    if (r) r();
    return true;
  }

  private tickHunger(): void {
    this.nutrition -= 1;
    if (this.nutrition === 150) this.game.log.add("You are getting hungry.", "bad");
    else if (this.nutrition === 50) this.game.log.add("You are weak with hunger.", "bad");
    else if (this.nutrition <= 0) {
      this.nutrition = 0;
      this.hp -= 1;
      this.game.log.add("You are starving!", "bad");
      if (this.hp <= 0) this.game.killPlayer();
    }
  }

  hungerWord(): string {
    if (this.nutrition <= 0) return "Starving";
    if (this.nutrition < 50) return "Weak";
    if (this.nutrition < 150) return "Hungry";
    return "";
  }

  /** Returns true if a turn was consumed (a key the engine should act on). */
  handleKey(e: KeyboardEvent): boolean {
    if (this.pending) return this.resolveSelection(e);
    const mv = MOVES[e.key];
    if (mv) return this.tryMove(mv[0], mv[1]);
    switch (e.key) {
      case ".": case "5": this.game.log.add("You wait.", "dim"); return this.endTurn();
      case ">": return this.tryDescend();
      case "<": return this.tryAscend();
      case "P": return this.tryPray();
      case ",": case "g": return this.game.tryPickup() ? this.endTurn() : false;
      case "p": void this.game.tryBuy(); return false; // shop purchase (async, gasless — no turn)
      case "H": void this.game.showHallOfFame(); return false;
      case "i": this.game.showInventory(); return false;
      case "w": return this.startSelect("wield");
      case "W": return this.startSelect("wear");
      case "q": return this.startSelect("quaff");
      case "r": return this.startSelect("read");
      case "e": return this.startSelect("eat");
      case "d": return this.startSelect("drop");
      case "T": return this.takeOff();
    }
    return false;
  }

  private startSelect(verb: Verb): boolean {
    if (this.inventory.items.length === 0) { this.game.log.add("You have nothing.", "dim"); return false; }
    this.pending = verb;
    const last = this.inventory.letter(this.inventory.items.length - 1);
    this.game.log.add(`${VERB_PROMPT[verb]} (a-${last}, Esc to cancel)`, "sys");
    this.game.showInventory();
    return false;
  }

  private resolveSelection(e: KeyboardEvent): boolean {
    const verb = this.pending!;
    this.pending = null;
    if (e.key === "Escape") { this.game.log.add("Never mind.", "dim"); return false; }
    const item = /^[a-z]$/.test(e.key) ? this.inventory.byLetter(e.key) : undefined;
    if (!item) { this.game.log.add("No such item.", "dim"); return false; }
    return this.doVerb(verb, item);
  }

  private doVerb(verb: Verb, item: Item): boolean {
    const t = item.type;
    const ident = this.game.ident;
    switch (verb) {
      case "wield":
        if (t.kind !== "weapon") { this.game.log.add("That is not a weapon.", "dim"); return false; }
        this.weapon = item; this.applyWeapon();
        this.game.log.add(`You wield ${ident.name(t)}.`, "good"); return this.endTurn();
      case "wear":
        if (t.kind === "armor") {
          this.armor = item; this.ac = t.ac!;
          this.game.log.add(`You don ${ident.name(t)}.`, "good"); return this.endTurn();
        }
        if (t.kind === "ring") {
          if (this.ring) this.applyRing(this.ring, false);
          this.ring = item; this.applyRing(item, true);
          this.game.log.add(`You put on ${ident.name(t)}.`, "good"); return this.endTurn();
        }
        this.game.log.add("You can't wear that.", "dim"); return false;
      case "eat":
        if (t.kind !== "food") { this.game.log.add("That isn't food.", "dim"); return false; }
        this.nutrition += t.nutrition!;
        this.game.log.add(`You eat ${t.name}. Much better.`, "good");
        this.inventory.remove(item); this.unequip(item); return this.endTurn();
      case "quaff":
        if (t.kind !== "potion") { this.game.log.add("You can't drink that.", "dim"); return false; }
        ident.learn(t); this.game.log.add(`You drink ${t.name}.`);
        this.inventory.remove(item); this.unequip(item);
        this.game.applyEffect(t.effect!); return this.endTurn();
      case "read":
        if (t.kind !== "scroll") { this.game.log.add("There is nothing to read.", "dim"); return false; }
        ident.learn(t); this.game.log.add(`You read ${t.name}.`);
        this.inventory.remove(item); this.unequip(item);
        this.game.applyEffect(t.effect!); return this.endTurn();
      case "drop":
        this.inventory.remove(item); this.unequip(item);
        this.game.dropItem(t); this.game.log.add(`You drop ${ident.name(t)}.`); return this.endTurn();
    }
    return false;
  }

  private unequip(item: Item): void {
    if (this.weapon === item) { this.weapon = null; this.applyWeapon(); }
    if (this.armor === item) { this.armor = null; this.ac = 0; }
    if (this.ring === item) { this.applyRing(item, false); this.ring = null; }
  }

  private takeOff(): boolean {
    if (!this.armor) { this.game.log.add("You aren't wearing armor.", "dim"); return false; }
    this.game.log.add(`You take off ${this.game.ident.name(this.armor.type)}.`);
    this.armor = null; this.ac = 0; return this.endTurn();
  }

  private tryMove(dx: number, dy: number): boolean {
    const nx = this.x + dx, ny = this.y + dy;
    const foe = this.game.monsterAt(nx, ny);
    if (foe) { this.game.attack(this, foe); return this.endTurn(); }
    if (!this.game.level.isPassable(nx, ny)) return false; // bumping a wall costs no turn
    this.x = nx; this.y = ny;
    this.game.level.computeFOV(this.x, this.y);
    const here = this.game.level.itemAt(this.x, this.y);
    if (here) {
      const nm = this.game.ident.name(here.type);
      this.game.log.add(here.price ? `${nm} — ${here.price} PAS (press p to buy).` : `You see ${nm} here. (, to pick up)`, "dim");
    }
    const grave = this.game.level.graveAt(this.x, this.y);
    if (grave) this.game.log.add(`☗ ${grave.label}.`, "dim");
    const trap = this.game.level.trapAt(this.x, this.y);
    if (trap) this.game.triggerTrap(trap);
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

  private tryAscend(): boolean {
    if (this.game.level.tileAt(this.x, this.y) !== "stairsUp") {
      this.game.log.add("There are no stairs up here.", "dim");
      return false;
    }
    this.game.ascend();
    return this.endTurn();
  }

  private tryPray(): boolean {
    if (this.game.level.tileAt(this.x, this.y) !== "altar") {
      this.game.log.add("You can only pray at an altar (_).", "dim");
      return false;
    }
    this.game.pray();
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

  getSpeed(): number {
    return this.def.speed ?? 100;
  }

  act(): void {
    const p = this.game.player;
    if (!p.alive || !this.alive) return;

    // The Sybil attack: occasionally a sybil spends its turn replicating.
    if (this.def.splits && ROT.RNG.getUniform() < 0.1 && this.game.spawnSybilNear(this.x, this.y)) return;

    const dist = Math.max(Math.abs(this.x - p.x), Math.abs(this.y - p.y));
    if (dist === 1) { this.game.attack(this, p); return; }

    // Chase only what the player can see — unless they're cloaked (ring of privacy).
    if (this.def.ai === "chase" && !p.stealth && this.game.level.isVisible(this.x, this.y) && dist <= 9) {
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
