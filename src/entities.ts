import * as ROT from "rot-js";
import type { Game } from "./game";
import { COLORS, MonsterDef } from "./data";
import { Inventory, Item } from "./inventory";
import { bucDelta } from "./items";

type Verb = "wield" | "wear" | "quaff" | "read" | "eat" | "drop" | "zap";
const VERB_PROMPT: Record<Verb, string> = {
  wield: "Wield which weapon?", wear: "Wear/put on which item?",
  quaff: "Quaff which potion?", read: "Read which scroll?",
  eat: "Eat what?", drop: "Drop which item?", zap: "Zap which wand?",
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
  poison = 0;          // turns of damage-over-time remaining
  confused = 0;        // turns of staggering movement remaining
  private regenTimer = 0;
  hasJam = false;
  maxDepthReached = 1;
  weaponBonus = 0; // from scrolls of enchantment
  prayerCooldown = 0;

  /** Recompute attack damage from the wielded weapon (or fists) + enchant bonus. */
  applyWeapon(): void {
    if (this.weapon) {
      const b = this.weaponBonus + (this.weapon.enchant ?? 0) + bucDelta(this.weapon.buc); // scroll enchant + relic enchant + sanctity
      this.attackDmg = [this.weapon.type.dmg![0] + b, this.weapon.type.dmg![1] + b];
    } else this.attackDmg = [1, 3];
  }

  /** Apply (on=true) or revert a worn ring's passive effect. A cursed ring betrays you. */
  applyRing(item: Item, on: boolean): void {
    const cursed = item.buc === "cursed";
    switch (item.type.id) {
      case "ring_res": {
        const amt = cursed ? -4 : 6; // cursed resilience saps your max HP instead
        this.maxHp += on ? amt : -amt;
        if (on && amt > 0) this.hp += amt;
        this.hp = Math.max(1, Math.min(this.hp, this.maxHp));
        break;
      }
      case "ring_regen": this.regenFast = on && !cursed; break; // cursed: no regen
      case "ring_priv": this.stealth = on && !cursed; break;    // cursed: cloak fails
    }
  }
  private pending: Verb | null = null;
  private pendingDir: Item | null = null; // a wand awaiting a zap direction
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
    // Poison: damage over time. Confusion: just counts down.
    if (this.poison > 0) {
      this.poison--; this.hp--;
      if (this.poison === 0) this.game.log.add("The poison passes.", "dim");
      if (this.hp <= 0) { this.game.log.add("The poison takes you.", "bad"); this.game.killPlayer(); }
    }
    if (this.confused > 0 && --this.confused === 0) this.game.log.add("Your head clears.", "dim");
    // Natural regeneration (faster with a ring of regeneration; not while starving/poisoned).
    if (this.hp < this.maxHp && this.nutrition > 0 && this.poison === 0 && ++this.regenTimer >= (this.regenFast ? 5 : 14)) {
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
    if (this.pendingDir) return this.resolveZapDir(e);
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
      case "z": return this.startSelect("zap");
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
    if (verb === "zap") {
      if (item.type.kind !== "wand") { this.game.log.add("That is not a wand.", "dim"); return false; }
      this.pendingDir = item;
      this.game.log.add("Zap in which direction? (a move key, Esc to cancel)", "sys");
      return false;
    }
    return this.doVerb(verb, item);
  }

  private resolveZapDir(e: KeyboardEvent): boolean {
    const wand = this.pendingDir!;
    this.pendingDir = null;
    if (e.key === "Escape") { this.game.log.add("Never mind.", "dim"); return false; }
    const mv = MOVES[e.key];
    if (!mv) { this.game.log.add("That is not a direction.", "dim"); return false; }
    this.game.zapWand(wand, mv[0], mv[1]);
    return this.endTurn();
  }

  private doVerb(verb: Verb, item: Item): boolean {
    const t = item.type;
    const ident = this.game.ident;
    switch (verb) {
      case "wield":
        if (t.kind !== "weapon") { this.game.log.add("That is not a weapon.", "dim"); return false; }
        if (item === this.weapon) { this.game.log.add("You're already wielding that.", "dim"); return false; }
        if (this.weapon && this.weapon.buc === "cursed") {
          this.weapon.bucKnown = true;
          this.game.log.add(`You can't release ${ident.name(this.weapon.type)} — it's cursed, welded to your grip!`, "bad");
          return this.endTurn();
        }
        this.weapon = item; this.applyWeapon();
        this.game.log.add(`You wield ${ident.name(t)}.`, "good");
        if (item.buc === "cursed") { item.bucKnown = true; this.game.log.add(`The ${t.name} welds itself to your hand. It's cursed!`, "bad"); }
        return this.endTurn();
      case "wear":
        if (t.kind === "armor") {
          if (item === this.armor) { this.game.log.add("You're already wearing that.", "dim"); return false; }
          if (this.armor && this.armor.buc === "cursed") {
            this.armor.bucKnown = true;
            this.game.log.add(`You'd have to remove ${ident.name(this.armor.type)} first — but it's welded on, cursed!`, "bad");
            return this.endTurn();
          }
          this.armor = item; this.ac = t.ac! + (item.enchant ?? 0) + bucDelta(item.buc);
          this.game.log.add(`You don ${ident.name(t)}.`, "good");
          if (item.buc === "cursed") { item.bucKnown = true; this.game.log.add(`The ${t.name} clamps shut around you. It's cursed!`, "bad"); }
          return this.endTurn();
        }
        if (t.kind === "ring") {
          if (item === this.ring) { this.game.log.add("That ring is already on your hand.", "dim"); return false; }
          if (this.ring && this.ring.buc === "cursed") {
            this.ring.bucKnown = true;
            this.game.log.add(`You can't remove ${ident.name(this.ring.type)} — it's cursed, fused to your finger!`, "bad");
            return this.endTurn();
          }
          if (this.ring) this.applyRing(this.ring, false);
          this.ring = item; this.applyRing(item, true);
          this.game.log.add(`You put on ${ident.name(t)}.`, "good");
          if (item.buc === "cursed") { item.bucKnown = true; this.game.log.add(`The ${t.name} tightens around your finger. It's cursed!`, "bad"); }
          return this.endTurn();
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
        this.game.applyEffect(t.effect!, item.buc); return this.endTurn();
      case "read":
        if (t.kind !== "scroll") { this.game.log.add("There is nothing to read.", "dim"); return false; }
        ident.learn(t); this.game.log.add(`You read ${t.name}.`);
        this.inventory.remove(item); this.unequip(item);
        this.game.applyEffect(t.effect!, item.buc); return this.endTurn();
      case "drop":
        if (this.isWelded(item)) { item.bucKnown = true; this.game.log.add(`You can't let go of ${ident.name(t)} — it's cursed!`, "bad"); return this.endTurn(); }
        this.inventory.remove(item); this.unequip(item);
        this.game.dropItem(item); this.game.log.add(`You drop ${ident.name(t)}.`); return this.endTurn();
    }
    return false;
  }

  private unequip(item: Item): void {
    if (this.weapon === item) { this.weapon = null; this.applyWeapon(); }
    if (this.armor === item) { this.armor = null; this.ac = 0; }
    if (this.ring === item) { this.applyRing(item, false); this.ring = null; }
  }

  /** A cursed item that's currently equipped is welded — it can't be removed or dropped. */
  isWelded(item: Item): boolean {
    return item.buc === "cursed" && (item === this.weapon || item === this.armor || item === this.ring);
  }

  private takeOff(): boolean {
    if (!this.armor) { this.game.log.add("You aren't wearing armor.", "dim"); return false; }
    if (this.armor.buc === "cursed") {
      this.armor.bucKnown = true;
      this.game.log.add(`Your ${this.game.ident.name(this.armor.type)} is welded on — it's cursed. Uncurse it first.`, "bad");
      return this.endTurn();
    }
    this.game.log.add(`You take off ${this.game.ident.name(this.armor.type)}.`);
    this.armor = null; this.ac = 0; return this.endTurn();
  }

  private tryMove(dx: number, dy: number): boolean {
    if (this.confused > 0 && ROT.RNG.getUniform() < 0.6) {
      const d = ROT.RNG.getItem([[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, 1], [-1, 1], [1, -1]] as [number, number][])!;
      dx = d[0]; dy = d[1];
      this.game.log.add("You stagger drunkenly.", "dim");
    }
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
    if (this.game.level.tileAt(this.x, this.y) === "portal") {
      const pr = this.game.level.portalAt(this.x, this.y);
      if (pr) this.game.log.add(`XCM portal → ${pr.chain.name} (difficulty ×${pr.chain.difficulty}, loot ×${pr.chain.loot}). Press > to call.`, "sys");
    }
    this.game.draw();
    return this.endTurn();
  }

  private tryDescend(): boolean {
    const t = this.game.level.tileAt(this.x, this.y);
    if (t === "portal") {
      const pr = this.game.level.portalAt(this.x, this.y);
      if (pr) { this.game.enterChain(pr.chain); return this.endTurn(); }
    }
    if (t !== "stairsDown") {
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
  speedMod = 1; // a wand of slowness halves this
  stolen: Item | null = null; // a thief (rug puller) carries what it snatched; drops it on death
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
    return Math.max(20, Math.round((this.def.speed ?? 100) * this.speedMod));
  }

  act(): void {
    const p = this.game.player;
    if (!p.alive || !this.alive) return;

    // A laden thief wants only to escape — it never turns to fight.
    if (this.stolen) { this.fleeStep(p); return; }

    // The Sybil attack: occasionally a sybil spends its turn replicating.
    if (this.def.splits && ROT.RNG.getUniform() < 0.1 && this.game.spawnSybilNear(this.x, this.y)) return;

    const dist = Math.max(Math.abs(this.x - p.x), Math.abs(this.y - p.y));
    // The rug pull: a thief adjacent to you snatches a pack item and blinks away.
    if (this.def.steals && dist === 1) {
      const loot = this.game.stealItem();
      if (loot) {
        this.stolen = loot;
        const who = this.name.charAt(0).toUpperCase() + this.name.slice(1);
        this.game.log.add(`${who} rugs you — it rips ${this.game.ident.name(loot.type)} from your pack and bolts!`, "bad");
        this.blinkAway(p);
        return;
      }
      // nothing to take — fall through and just attack
    }
    if (dist === 1) { this.game.attack(this, p); return; }

    // If the player's nominator is at our side, swat it.
    const pet = this.game.pet;
    if (pet && pet.alive && Math.max(Math.abs(this.x - pet.x), Math.abs(this.y - pet.y)) === 1) { this.game.attack(this, pet); return; }

    // Ranged foes (oracles) zap the player from a distance with line-of-sight.
    if (this.def.ranged && !p.stealth && dist >= 2 && dist <= 6 && this.game.level.isVisible(this.x, this.y) && this.game.hasLineOfSight(this.x, this.y, p.x, p.y)) {
      this.game.rangedAttack(this);
      return;
    }

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

  /** Step to the neighbouring tile that puts the most distance between us and the player. */
  private fleeStep(p: Player): void {
    let best: [number, number] | null = null, bestD = -1;
    for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1], [1, 1], [-1, -1], [1, -1], [-1, 1]] as [number, number][]) {
      const nx = this.x + dx, ny = this.y + dy;
      if (!this.game.level.isPassable(nx, ny) || this.game.monsterAt(nx, ny) || (nx === p.x && ny === p.y)) continue;
      const d = Math.max(Math.abs(nx - p.x), Math.abs(ny - p.y));
      if (d > bestD) { bestD = d; best = [nx, ny]; }
    }
    if (best) { this.x = best[0]; this.y = best[1]; }
  }

  /** Vanish to a far corner of the level — the thief's getaway. */
  private blinkAway(p: Player): void {
    for (let i = 0; i < 30; i++) {
      const pos = this.game.level.randomFloor();
      const d = Math.max(Math.abs(pos.x - p.x), Math.abs(pos.y - p.y));
      if (d >= 8 && !this.game.monsterAt(pos.x, pos.y) && !(pos.x === p.x && pos.y === p.y)) { this.x = pos.x; this.y = pos.y; return; }
    }
  }
}

/** The player's loyal nominator — follows, and savages adjacent enemies. */
export class Pet extends Entity {
  constructor(game: Game, x: number, y: number) {
    super(game);
    this.x = x; this.y = y;
    this.ch = "d"; this.fg = "#80d080"; this.name = "your nominator";
    this.hp = this.maxHp = 14;
    this.attackDmg = [2, 4];
  }

  getSpeed(): number { return 110; } // keeps pace with you

  act(): void {
    if (!this.alive) return;
    const p = this.game.player;

    const foe = this.game.adjacentEnemy(this.x, this.y);
    if (foe) { this.game.attack(this, foe); return; }

    const dist = Math.max(Math.abs(this.x - p.x), Math.abs(this.y - p.y));
    if (dist > 1) {
      const dij = new ROT.Path.Dijkstra(p.x, p.y, (x, y) => this.game.level.isPassable(x, y), { topology: 8 });
      const path: [number, number][] = [];
      dij.compute(this.x, this.y, (x, y) => path.push([x, y]));
      path.shift();
      if (path.length) {
        const [nx, ny] = path[0];
        if (!(nx === p.x && ny === p.y) && !this.game.monsterAt(nx, ny)) { this.x = nx; this.y = ny; }
      }
    }
  }
}
