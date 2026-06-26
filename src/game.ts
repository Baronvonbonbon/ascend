import * as ROT from "rot-js";
import { Level, Trap, TrapKind } from "./level";
import { Entity, Player, Monster, Pet } from "./entities";
import { Item } from "./inventory";
import { Log } from "./log";
import {
  COLORS, TILE_GLYPH, MONSTERS, MonsterDef, DEATHS, GREETINGS,
  MAX_DEPTH, CENSOR, MINIBOSSES, HONEYPOT, SHOPKEEPER, realmName, GRAY_PAPER, ChainDef, CHAINS,
} from "./data";
import { Idents, ITEMS, JAM, pickItemType, ItemType, EffectId, itemById, isGear, Buc, rollBuc, bucDelta } from "./items";
import { connectWallet, Wallet } from "./chain/wallet";
import { bankBalancePas, spendPas, depositPas } from "./chain/bank";
import { recordRun, readRecent, RunEntry } from "./chain/ledger";
import { readGear, mintGear } from "./chain/gear";

const PRICE: Record<string, number> = { weapon: 6, armor: 5, potion: 4, scroll: 4, food: 2 };

const W = 80;
const MAP_H = 30;
const H = MAP_H + 2; // + a blank row + the status line

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export class Game {
  readonly display: ROT.Display;
  readonly log: Log;
  level!: Level;
  player!: Player;
  ident!: Idents;
  monsters: Monster[] = [];
  pet: Pet | null = null;
  private currentChain: ChainDef | null = null; // null = the main relay-chain dungeon
  private defeatedBosses = new Set<number>();    // relay depths whose mini-boss is slain
  private loadedRelics = new Set<number>();      // NFT relic tokenIds already pulled into this run's pack
  wallet: Wallet | null = null;
  onWallet?: (address: string, pas: number) => void;
  recentRuns: RunEntry[] = []; // leaderboard cache + bones pool
  private scheduler = new ROT.Scheduler.Speed<Entity>(); // fast/slow actors act more/less often
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
    this.defeatedBosses.clear();
    this.loadedRelics.clear();
    this.ident = new Idents();
    this.level = new Level(W, MAP_H);
    this.player = new Player(this, this.level.start.x, this.level.start.y);
    this.giveStartingKit();
    this.pet = new Pet(this, this.level.start.x, this.level.start.y);
    this.enterLevel();
    this.log.add(ROT.RNG.getItem(GREETINGS)!, "sys");
    for (const line of GRAY_PAPER) this.log.add(line, "dim");
    this.log.add("Your nominator (d) pads at your heels — it backs you, and bites for you.", "dim");
    this.log.add("Keys: move · , pick up · p buy · P pray · z zap · t throw · E engrave · < up · > down · i/w/W/q/r/e/d items.", "dim");
    this.draw();
    this.engine = new ROT.Engine(this.scheduler);
    this.engine.start();
    void this.fetchLeaderboard();
    if (this.wallet) void this.loadRelics(); // carry owned NFT gear into the new run
  }

  /** Pull the player's owned NFT relics into the pack — persistent, tradeable gear
   *  that survives permadeath and rides into every descent. */
  private async loadRelics(): Promise<void> {
    if (!this.wallet) return;
    const owned = await readGear(this.wallet.address);
    let added = 0;
    for (const g of owned) {
      if (this.loadedRelics.has(g.tokenId)) continue;
      const type = itemById(g.itemId);
      if (!type || !isGear(type)) continue;
      if (this.player.inventory.full) break;
      this.giveItem(type, { enchant: g.enchant, relic: true, buc: "blessed", bucKnown: true });
      this.loadedRelics.add(g.tokenId);
      added++;
    }
    if (added > 0) {
      this.log.add(`✦ ${added} on-chain relic${added > 1 ? "s" : ""} materialise in your pack (yours forever — tradeable).`, "good");
      this.draw();
    }
  }

  private async fetchLeaderboard(): Promise<void> {
    try { this.recentRuns = await readRecent(12); } catch { /* offline is fine */ }
  }

  private giveStartingKit(): void {
    const dagger = ITEMS.find((i) => i.id === "dagger")!;
    const ration = ITEMS.find((i) => i.id === "ration")!;
    const wielded = this.player.inventory.add(dagger);
    wielded.buc = "uncursed"; wielded.bucKnown = true;
    this.player.weapon = wielded;
    this.player.attackDmg = dagger.dmg!;
    const r = this.player.inventory.add(ration); r.buc = "uncursed"; r.bucKnown = true;
  }

  /** Populate the current level and (re)build the turn schedule. */
  private enterLevel(): void {
    this.monsters = [];
    this.scheduler.clear();
    this.scheduler.add(this.player, true);
    this.spawnMonsters();
    this.spawnItems();
    this.spawnShop();
    this.placeAltar();
    this.maybePlaceBones();
    this.spawnTraps();
    this.placePortals();
    this.placeMiniboss();
    this.placeMimics();
    if (!this.currentChain && this.player.depth >= MAX_DEPTH) this.placeJamAndBoss();
    for (const m of this.monsters) this.scheduler.add(m, true);
    if (this.pet && this.pet.alive) {
      const spot = this.adjacentFree(this.player.x, this.player.y);
      if (spot) { this.pet.x = spot.x; this.pet.y = spot.y; }
      this.scheduler.add(this.pet, true);
    }
    this.level.computeFOV(this.player.x, this.player.y);
  }

  adjacentEnemy(x: number, y: number): Monster | undefined {
    return this.monsters.find((m) => m.alive && !m.peaceful && Math.max(Math.abs(m.x - x), Math.abs(m.y - y)) === 1);
  }

  private adjacentFree(x: number, y: number): { x: number; y: number } | null {
    const offs = ROT.RNG.shuffle([[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]] as [number, number][]);
    for (const [dx, dy] of offs) {
      const nx = x + dx, ny = y + dy;
      if (this.level.isPassable(nx, ny) && !this.monsterAt(nx, ny)) return { x: nx, y: ny };
    }
    return null;
  }

  descend(): void {
    this.player.depth++;
    this.player.maxDepthReached = Math.max(this.player.maxDepthReached, this.player.depth);
    this.level = new Level(W, MAP_H);
    this.player.x = this.level.start.x;
    this.player.y = this.level.start.y;
    this.placeUpStair();
    this.enterLevel();
    this.log.add(`You descend to depth ${this.player.depth} — ${realmName(this.player.depth)}.`, this.player.depth >= 7 ? "bad" : "sys");
    if (this.player.depth >= 7 && this.player.depth < MAX_DEPTH) this.log.add("Chaos thickens. Expect Kusama.", "bad");
    if (this.player.depth >= MAX_DEPTH) this.log.add("The air reeks of centralisation. The JAM is here — and so is its keeper.", "bad");
    this.draw();
  }

  // ── XCM: parachain side-branches (each scales difficulty × loot) ────────────
  private placePortals(): void {
    if (this.currentChain || this.player.depth < 2 || this.player.depth > 7) return;
    const n = ROT.RNG.getUniform() < 0.7 ? (ROT.RNG.getUniform() < 0.3 ? 2 : 1) : 0;
    for (let i = 0; i < n; i++) {
      const centers = this.level.roomCenters.filter(
        (c) => this.level.tileAt(c.x, c.y) === "floor" && !(c.x === this.player.x && c.y === this.player.y) && !this.level.portalAt(c.x, c.y),
      );
      if (!centers.length) break;
      const c = ROT.RNG.getItem(centers)!;
      const chain = ROT.RNG.getItem(CHAINS)!;
      this.level.tiles[c.y][c.x] = "portal";
      this.level.portals.push({ x: c.x, y: c.y, chain });
    }
  }

  /** XCM call: hop to a parachain branch (its multipliers shape spawns + loot). */
  enterChain(chain: ChainDef): void {
    this.currentChain = chain;
    this.level = new Level(W, MAP_H);
    this.player.x = this.level.start.x;
    this.player.y = this.level.start.y;
    this.placeUpStair(); // the way back to the relay
    this.enterLevel();
    const goodies = ITEMS.filter((i) => i.kind === "ring" || i.kind === "wand");
    const cacheN = Math.max(0, Math.round(2 * chain.loot));
    for (let i = 0; i < cacheN; i++) {
      const pos = this.level.randomFloor();
      if (this.level.tileAt(pos.x, pos.y) === "floor" && !this.level.itemAt(pos.x, pos.y))
        this.level.items.push({ x: pos.x, y: pos.y, type: ROT.RNG.getItem(goodies)! });
    }
    this.log.add(`XCM → ${chain.name}: difficulty ×${chain.difficulty}, loot ×${chain.loot}. (< to return to the relay)`, chain.difficulty >= 1 ? "bad" : "sys");
    this.draw();
  }

  private exitChain(): void {
    const from = this.currentChain?.name ?? "the branch";
    this.currentChain = null;
    this.level = new Level(W, MAP_H);
    this.player.x = this.level.stairs.x;
    this.player.y = this.level.stairs.y;
    if (this.player.depth > 1) this.placeUpStair();
    this.enterLevel();
    this.log.add(`XCM ← you return from ${from} to the relay at depth ${this.player.depth}.`, "sys");
    this.draw();
  }

  ascend(): void {
    if (this.currentChain) { this.exitChain(); return; }
    const newDepth = this.player.depth - 1;
    if (newDepth < 1) return;
    this.player.depth = newDepth;
    if (newDepth === 1 && this.player.hasJam) { this.win(); return; }
    this.level = new Level(W, MAP_H);
    this.player.x = this.level.stairs.x; // you climb up INTO the down-stairs of the level above
    this.player.y = this.level.stairs.y;
    if (newDepth > 1) this.placeUpStair();
    this.enterLevel();
    this.log.add(`You climb to depth ${newDepth} — ${realmName(newDepth)}.`, "sys");
    this.draw();
  }

  private placeUpStair(): void {
    const s = this.level.start;
    this.level.tiles[s.y][s.x] = "stairsUp";
  }

  private placeJamAndBoss(): void {
    const s = this.level.stairs;
    this.level.tiles[s.y][s.x] = "floor"; // the bottom — no stairs deeper
    this.level.items.push({ x: s.x, y: s.y, type: JAM });
    const offs = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]];
    for (const [dx, dy] of offs) {
      const x = s.x + dx, y = s.y + dy;
      if (this.level.isPassable(x, y) && !this.monsterAt(x, y) && !(x === this.player.x && y === this.player.y)) {
        this.monsters.push(new Monster(this, CENSOR, x, y));
        break;
      }
    }
  }

  private placeMiniboss(): void {
    if (this.currentChain) return;
    const def = MINIBOSSES[this.player.depth];
    if (!def || this.defeatedBosses.has(this.player.depth)) return;
    const centers = this.level.roomCenters.filter(
      (c) => this.level.tileAt(c.x, c.y) === "floor" && !(c.x === this.player.x && c.y === this.player.y) && !this.monsterAt(c.x, c.y),
    );
    if (!centers.length) return;
    const c = ROT.RNG.getItem(centers)!;
    this.monsters.push(new Monster(this, def, c.x, c.y));
    this.log.add(`A mighty presence stirs on this floor — ${def.name}.`, "bad");
  }

  /** Seed the floor with honeypots — mimics that wear an item's glyph and bite when touched. */
  private placeMimics(): void {
    if (this.player.depth < 3) return;
    const n = ROT.RNG.getUniformInt(0, 2);
    for (let i = 0; i < n; i++) {
      let pos = this.level.randomFloor(), tries = 0;
      while (
        tries < 40 &&
        (this.monsterAt(pos.x, pos.y) || this.level.itemAt(pos.x, pos.y) ||
          (pos.x === this.player.x && pos.y === this.player.y) ||
          this.level.tileAt(pos.x, pos.y) === "stairsDown" || this.level.tileAt(pos.x, pos.y) === "stairsUp")
      ) { pos = this.level.randomFloor(); tries++; }
      if (tries < 40) this.monsters.push(new Monster(this, HONEYPOT, pos.x, pos.y));
    }
  }

  private placeAltar(): void {
    if (ROT.RNG.getUniform() > 0.45) return;
    const centers = this.level.roomCenters.filter(
      (c) => this.level.tileAt(c.x, c.y) === "floor" && !(c.x === this.player.x && c.y === this.player.y),
    );
    if (!centers.length) return;
    const c = ROT.RNG.getItem(centers)!;
    this.level.tiles[c.y][c.x] = "altar";
  }

  pray(): void {
    const p = this.player;
    if (p.prayerCooldown > 0) { this.log.add("Gavin is unmoved — pray again later.", "dim"); return; }
    p.prayerCooldown = 130;
    p.hp = p.maxHp;
    p.nutrition = Math.max(p.nutrition, 600);
    p.poison = 0; p.confused = 0;
    this.log.add("Gavin, the Architect, hears you. You are made whole.", "good");
    // Gavin lifts the curses binding your worn gear.
    const bound = [p.weapon, p.armor, p.ring].filter((it): it is Item => !!it && it.buc === "cursed");
    if (bound.length) {
      for (const it of bound) { it.buc = "uncursed"; it.bucKnown = true; }
      p.applyWeapon();
      this.log.add("Welds loosen — the curses on your gear are lifted.", "good");
    }
    if (ROT.RNG.getUniform() < 0.4) {
      for (const it of p.inventory.items) this.ident.learn(it.type);
      this.log.add("Truth is revealed — your pack is identified.", "sys");
    }
    this.draw();
  }

  /** Scratch a warding sigil (a Gray-Paper clause) at your feet; ordinary foes shrink from the tile. */
  engrave(): boolean {
    const p = this.player;
    const t = this.level.tileAt(p.x, p.y);
    if (t !== "floor" && t !== "door") { this.log.add("There's no dust here to scratch a sigil into.", "dim"); return false; }
    const LIFE = 14;
    const e = this.level.engravingAt(p.x, p.y);
    if (e) { e.life = LIFE; this.log.add("You re-scratch the Gray-Paper sigil — its lines sharpen.", "sys"); }
    else {
      this.level.engravings.push({ x: p.x, y: p.y, life: LIFE });
      this.log.add("You scratch a clause of the Gray Paper into the dust: 'less trust, more truth.' Foes shrink from it.", "good");
    }
    return true;
  }

  /** Engravings scuff away over time (and faster when you fight on them). */
  tickEngravings(): void {
    if (this.level.engravings.length === 0) return;
    for (const e of this.level.engravings) e.life--;
    this.level.engravings = this.level.engravings.filter((e) => e.life > 0);
  }

  private win(): void {
    if (this.over) return;
    this.over = true;
    this.log.add("✦ You climb into the light, the JAM blazing in your grasp. ✦", "good");
    this.log.add("ASCENSION! The chain needs no master. You have won, Seeker.", "sys");
    this.log.add("Press R to begin a new descent.", "dim");
    this.draw();
    void this.recordResult(true);
    void this.showHallOfFame();
  }

  private gameOver(): void {
    if (this.over) return;
    this.over = true;
    this.player.hp = 0;
    this.log.add(ROT.RNG.getItem(DEATHS)!, "bad");
    this.log.add(`You fell at depth ${this.player.depth} (deepest ${this.player.maxDepthReached}). Press R to try again.`, "sys");
    this.draw();
    void this.recordResult(false);
    void this.showHallOfFame();
  }

  // ── on-chain persistence (Phase 4) ─────────────────────────────────────────
  private async recordResult(won: boolean): Promise<void> {
    if (!this.wallet) { this.log.add("(connect a wallet to etch this run on-chain)", "dim"); return; }
    const depth = won ? MAX_DEPTH : this.player.maxDepthReached;
    const r = await recordRun(this.wallet.provider, this.wallet.address, depth, won);
    if (r.ok) { this.log.add("Your run is etched into the on-chain Hall of Fame (gasless).", "sys"); void this.fetchLeaderboard(); }
    else this.log.add(`Could not record run: ${r.error}`, "dim");
  }

  async showHallOfFame(): Promise<void> {
    if (this.recentRuns.length === 0) await this.fetchLeaderboard();
    this.log.add("— Hall of Fame (on-chain) —", "sys");
    if (this.recentRuns.length === 0) { this.log.add("  No runs recorded yet — be the first.", "dim"); return; }
    const top = [...this.recentRuns]
      .sort((a, b) => (b.won ? 100 : 0) + b.depth - ((a.won ? 100 : 0) + a.depth))
      .slice(0, 6);
    for (const r of top) {
      const who = `${r.player.slice(0, 6)}…${r.player.slice(-4)}`;
      this.log.add(`  ${who} — ${r.won ? "★ ASCENDED" : "fell at depth " + r.depth}`, r.won ? "good" : "dim");
    }
  }

  private maybePlaceBones(): void {
    if (this.recentRuns.length === 0 || ROT.RNG.getUniform() > 0.3) return;
    const r = ROT.RNG.getItem(this.recentRuns)!;
    const pos = this.level.randomFloor();
    if (this.level.tileAt(pos.x, pos.y) !== "floor" || this.level.graveAt(pos.x, pos.y)) return;
    const who = `${r.player.slice(0, 6)}…${r.player.slice(-4)}`;
    this.level.graves.push({ x: pos.x, y: pos.y, label: r.won ? `${who} ascended from here` : `Here fell ${who}, at depth ${r.depth}` });
  }

  // ── combat ─────────────────────────────────────────────────────────────────
  attack(a: Entity, d: Entity): void {
    // Touching a disguised honeypot springs the trap — it sheds its loot form.
    if (d instanceof Monster && d.def.mimic && !d.revealed) {
      d.revealed = true;
      const lure = d.disguiseType ? this.ident.name(d.disguiseType) : "the loot";
      this.log.add(`${cap(lure)} you reached for lurches alive — it's a honeypot! A mimic.`, "bad");
    }
    // Striking a peaceful shopkeeper provokes it — now it fights to the death.
    if (d instanceof Monster && d.def.keeper && d.peaceful) {
      d.peaceful = false; d.fg = "#ff5030";
      this.log.add("You strike the Marketmaker — it roars \"Bad debt!\" and turns on you.", "bad");
    }
    // Fighting on a warded tile scuffs the sigil away faster.
    if (a === this.player) { const e = this.level.engravingAt(this.player.x, this.player.y); if (e) e.life -= 3; }
    const [lo, hi] = a.attackDmg;
    let dmg = ROT.RNG.getUniformInt(lo, hi);
    if (d === this.player && this.player.ac > 0) dmg = Math.max(1, dmg - this.player.ac); // armor soaks
    d.hp -= dmg;
    if (a === this.player) this.log.add(`You strike ${d.name} for ${dmg}.`, "good");
    else if (d === this.player) {
      this.log.add(`${cap(a.name)} hits you for ${dmg}.`, "bad");
      if (a instanceof Monster && a.def.inflict && d.hp > 0 && ROT.RNG.getUniform() < 0.3) this.applyStatus(a.def.inflict);
    }
    else if (a === this.pet) this.log.add(`Your nominator savages ${d.name} for ${dmg}.`, "good");
    else if (d === this.pet) this.log.add(`${cap(a.name)} mauls your nominator for ${dmg}.`, "bad");
    if (d.hp <= 0) this.kill(d);
  }

  applyStatus(kind: "poison" | "confuse"): void {
    if (kind === "poison") { this.player.poison = Math.max(this.player.poison, 6); this.log.add("You are poisoned!", "bad"); }
    else { this.player.confused = Math.max(this.player.confused, 5); this.log.add("Your head spins — you're confused!", "bad"); }
  }

  /** A ranged foe zaps the player (armor half-soaks; can still inflict status). */
  rangedAttack(a: Monster): void {
    const p = this.player;
    const [lo, hi] = a.attackDmg;
    let dmg = ROT.RNG.getUniformInt(lo, hi);
    if (p.ac > 0) dmg = Math.max(1, dmg - Math.floor(p.ac / 2));
    p.hp -= dmg;
    this.log.add(`${cap(a.name)} zaps you from afar for ${dmg}!`, "bad");
    if (a.def.inflict && p.hp > 0 && ROT.RNG.getUniform() < 0.3) this.applyStatus(a.def.inflict);
    if (p.hp <= 0) this.kill(p);
  }

  /** Bresenham line-of-sight: clear if no wall lies between the two cells. */
  hasLineOfSight(x0: number, y0: number, x1: number, y1: number): boolean {
    const dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let err = dx - dy, x = x0, y = y0;
    for (let guard = 0; guard < 100; guard++) {
      if (x === x1 && y === y1) return true;
      if (!(x === x0 && y === y0) && !this.level.isPassable(x, y)) return false;
      const e2 = 2 * err;
      if (e2 > -dy) { err -= dy; x += sx; }
      if (e2 < dx) { err += dx; y += sy; }
    }
    return false;
  }

  killPlayer(): void {
    this.gameOver();
  }

  // ── items ──────────────────────────────────────────────────────────────────
  private spawnItems(): void {
    const loot = this.currentChain?.loot ?? 1;
    const count = Math.round((3 + this.player.depth * 0.7) * loot);
    for (let i = 0; i < count; i++) {
      const type = pickItemType();
      let pos = this.level.randomFloor();
      let tries = 0;
      while (
        tries < 40 &&
        (this.level.itemAt(pos.x, pos.y) ||
          (pos.x === this.player.x && pos.y === this.player.y) ||
          this.level.tileAt(pos.x, pos.y) === "stairsDown")
      ) { pos = this.level.randomFloor(); tries++; }
      this.level.items.push({ x: pos.x, y: pos.y, type, buc: rollBuc() });
    }
  }

  /** A thief snatches a random pack item (unequipping it if worn/wielded). Returns it, or null if the pack is bare. */
  stealItem(): Item | null {
    const p = this.player;
    if (p.inventory.items.length === 0) return null;
    const it = ROT.RNG.getItem(p.inventory.items)!;
    if (p.weapon === it) { p.weapon = null; p.applyWeapon(); }
    if (p.armor === it) { p.armor = null; p.ac = 0; }
    if (p.ring === it) { p.applyRing(it, false); p.ring = null; }
    p.inventory.remove(it);
    return it;
  }

  /** Add an item to the pack, rolling wand charges. NFT relics carry enchant + a relic mark; every item gets a BUC. */
  giveItem(type: ItemType, opts?: { enchant?: number; relic?: boolean; buc?: Buc; bucKnown?: boolean }): Item {
    const it = this.player.inventory.add(type);
    if (type.kind === "wand") it.charges = ROT.RNG.getUniformInt(3, 6);
    if (opts?.enchant) it.enchant = opts.enchant;
    if (opts?.relic) it.relic = true;
    it.buc = opts?.buc ?? rollBuc();
    it.bucKnown = opts?.bucKnown ?? false;
    return it;
  }

  /** Hurl an item in a direction: a weapon strikes the first foe (and lands, retrievable);
   *  a potion shatters on it. The item has already been removed from the pack. */
  throwItem(item: Item, dx: number, dy: number): void {
    const t = item.type;
    let x = this.player.x, y = this.player.y;
    let lx = x, ly = y; // last open tile the projectile passed over
    let hit: Monster | undefined;
    for (let step = 0; step < 8; step++) {
      x += dx; y += dy;
      if (!this.level.isPassable(x, y)) break; // hit a wall — stops short
      const m = this.monsterAt(x, y);
      if (m) { hit = m; break; }
      lx = x; ly = y;
    }

    if (t.kind === "potion") {
      // A potion shatters on impact. A reorg/harm draught is a grenade; finality wasted on a foe heals it.
      if (hit) {
        this.ident.learn(t);
        if (t.effect === "harm") {
          const d = ROT.RNG.getUniformInt(6, 12); hit.hp -= d;
          this.log.add(`The ${t.name} bursts on ${hit.name} — a reorg tears it for ${d}.`, "good");
          if (hit.hp <= 0) this.kill(hit);
        } else if (t.effect === "heal") {
          hit.hp = Math.min(hit.maxHp, hit.hp + ROT.RNG.getUniformInt(8, 14));
          this.log.add(`The ${t.name} splashes ${hit.name} — you mend it by mistake!`, "bad");
        } else {
          this.log.add(`The ${t.name} shatters against ${hit.name} to no effect.`, "dim");
        }
      } else {
        this.log.add(`The ${t.name} shatters on the ground.`, "dim");
      }
      return; // consumed
    }

    // A weapon (or anything else): deal weapon damage on a hit, then it falls to the floor.
    if (hit) {
      const b = (item.enchant ?? 0) + bucDelta(item.buc);
      const [lo, hi] = t.dmg ?? [1, 2];
      const dmg = Math.max(1, ROT.RNG.getUniformInt(lo, hi) + b);
      hit.hp -= dmg;
      this.log.add(`You hurl ${this.ident.name(t)} — it strikes ${hit.name} for ${dmg}.`, "good");
      if (hit.hp <= 0) this.kill(hit);
      lx = hit.x; ly = hit.y; // the weapon drops where the target stood
    } else {
      this.log.add(`You hurl ${this.ident.name(t)}. It clatters to the ground.`, "dim");
    }
    if (!this.level.itemAt(lx, ly) && this.level.isPassable(lx, ly)) {
      this.level.items.push({ x: lx, y: ly, type: t, enchant: item.enchant, relic: item.relic, buc: item.buc, bucKnown: item.bucKnown });
    }
  }

  /** Fire a wand in a direction. */
  zapWand(item: Item, dx: number, dy: number): void {
    if (!item.charges || item.charges <= 0) { this.log.add("The wand is spent.", "dim"); return; }
    item.charges--;

    if (item.type.id === "wand_dig") {
      let x = this.player.x, y = this.player.y, dug = 0;
      for (let step = 0; step < 8 && dug < 4; step++) {
        x += dx; y += dy;
        if (x < 1 || y < 1 || x >= W - 1 || y >= MAP_H - 1) break; // keep the border intact
        if (this.level.tileAt(x, y) === "wall") { this.level.tiles[y][x] = "floor"; dug++; }
      }
      this.log.add(dug ? `You bore through ${dug} wall${dug > 1 ? "s" : ""}.` : "The wand of digging finds no wall.", dug ? "good" : "dim");
      this.level.computeFOV(this.player.x, this.player.y);
    } else {
      let x = this.player.x, y = this.player.y;
      let hit: Monster | undefined;
      for (let step = 0; step < 10; step++) {
        x += dx; y += dy;
        if (!this.level.isPassable(x, y)) break;
        const m = this.monsterAt(x, y); if (m) { hit = m; break; }
      }
      if (!hit) {
        this.log.add(`The ${item.type.name} fizzles into the dark.`, "dim");
      } else if (item.type.id === "wand_bolt") {
        const d = ROT.RNG.getUniformInt(8, 14); hit.hp -= d;
        this.log.add(`A bolt of finality strikes ${hit.name} for ${d}.`, "good");
        if (hit.hp <= 0) this.kill(hit);
      } else if (item.type.id === "wand_banish") {
        let pos = this.level.randomFloor(), t = 0;
        while (t < 40 && (this.monsterAt(pos.x, pos.y) || (pos.x === this.player.x && pos.y === this.player.y))) { pos = this.level.randomFloor(); t++; }
        hit.x = pos.x; hit.y = pos.y;
        this.log.add(`${cap(hit.name)} is banished across the chain.`, "good");
      } else if (item.type.id === "wand_slow") {
        hit.speedMod = 0.5;
        this.scheduler.remove(hit); this.scheduler.add(hit, true); // re-time at the slower speed
        this.log.add(`${cap(hit.name)} slows to a crawl.`, "good");
      }
    }

    if (item.charges <= 0) { this.player.inventory.remove(item); this.log.add(`The ${item.type.name} crumbles to dust.`, "dim"); }
    this.draw();
  }

  tryPickup(): boolean {
    const fi = this.level.itemAt(this.player.x, this.player.y);
    if (!fi) { this.log.add("There is nothing here to pick up.", "dim"); return false; }
    if (fi.type.id === "jam") {
      this.player.hasJam = true;
      this.level.items = this.level.items.filter((i) => i !== fi);
      this.log.add("You seize the JAM! Finality is yours. Now ASCEND — climb back to the surface (press <).", "good");
      return true;
    }
    if (this.player.inventory.full) { this.log.add("Your pack is full.", "bad"); return false; }
    // Lifting an unpaid ware is shoplifting — the Marketmaker takes it personally.
    if (fi.price) {
      const k = this.shopkeeper();
      if (k && k.peaceful) {
        k.peaceful = false; k.fg = "#ff5030";
        this.log.add("You pocket the unpaid ware — the Marketmaker bellows \"THIEF!\" and lunges for you.", "bad");
      }
    }
    this.giveItem(fi.type, { enchant: fi.enchant, relic: fi.relic, buc: fi.buc, bucKnown: fi.bucKnown });
    this.level.items = this.level.items.filter((i) => i !== fi);
    const tag = fi.relic ? ` +${fi.enchant ?? 0} ✦` : "";
    this.log.add(`You pick up ${this.ident.name(fi.type)}${tag}.`);
    return true;
  }

  /** The bazaar's shopkeeper on this level, if one is still alive. */
  shopkeeper(): Monster | undefined {
    return this.monsters.find((m) => m.alive && m.def.keeper);
  }

  dropItem(item: Item): void {
    const x = this.player.x, y = this.player.y;
    const fi = { x, y, type: item.type, enchant: item.enchant, relic: item.relic, buc: item.buc, bucKnown: item.bucKnown };
    // Gavin's altar reveals an item's sanctity when you set it down upon it.
    if (this.level.tileAt(x, y) === "altar") {
      fi.bucKnown = true;
      const b = item.buc ?? "uncursed";
      const glow = b === "blessed" ? "an amber glow" : b === "cursed" ? "a black flicker" : "no glow at all";
      this.log.add(`The ${this.ident.name(item.type)} rests on the altar — ${glow}. It is ${b}.`, b === "cursed" ? "bad" : "sys");
    }
    this.level.items.push(fi);
  }

  showInventory(): void {
    const inv = this.player.inventory;
    if (inv.items.length === 0) { this.log.add("Your pack is empty.", "dim"); return; }
    this.log.add("— Inventory —", "sys");
    inv.items.forEach((it, i) => {
      const welded = this.player.isWelded(it);
      const eq = welded ? " (welded)" : it === this.player.weapon ? " (wielded)" : it === this.player.armor ? " (worn)" : it === this.player.ring ? " (on hand)" : "";
      const ch = it.charges != null ? ` [${it.charges}]` : "";
      const relic = it.relic ? ` +${it.enchant ?? 0} ✦` : "";
      const buc = it.bucKnown && it.buc ? `${it.buc} ` : "";
      const tone = it.bucKnown && it.buc === "cursed" ? "bad" : it.bucKnown && it.buc === "blessed" ? "good" : it.relic ? "sys" : "dim";
      this.log.add(`  ${inv.letter(i)}) ${buc}${this.ident.name(it.type)}${relic}${ch}${eq}`, tone);
    });
  }

  applyEffect(effect: EffectId, buc: Buc = "uncursed"): void {
    const p = this.player;
    switch (effect) {
      case "heal": {
        // Blessed finality mends more; a cursed draught barely closes the wound.
        const amt = buc === "blessed" ? ROT.RNG.getUniformInt(16, 24) : buc === "cursed" ? ROT.RNG.getUniformInt(4, 8) : ROT.RNG.getUniformInt(10, 16);
        p.hp = Math.min(p.maxHp, p.hp + amt);
        if (p.poison > 0 && buc !== "cursed") { p.poison = 0; this.log.add("The poison is purged.", "good"); }
        this.log.add("Finality washes over you — your wounds seal.", "good"); break;
      }
      case "harm": {
        p.hp -= ROT.RNG.getUniformInt(4, 8);
        this.log.add("A reorg tears through you!", "bad"); break;
      }
      case "strength": {
        p.maxHp += 3; p.hp += 3;
        this.log.add("You feel staked. (max HP increased)", "good"); break;
      }
      case "teleport": {
        let pos = this.level.randomFloor(), t = 0;
        while (t < 40 && (this.monsterAt(pos.x, pos.y) || this.level.tileAt(pos.x, pos.y) === "stairsDown")) { pos = this.level.randomFloor(); t++; }
        p.x = pos.x; p.y = pos.y; this.level.computeFOV(p.x, p.y);
        this.log.add("You blink across the chain.", "sys"); break;
      }
      case "map": {
        this.level.revealAll();
        this.log.add("A light client reveals the whole level.", "sys"); break;
      }
      case "identify": {
        // Identify reveals an item's true name *and* its sanctity (BUC).
        const target = p.inventory.items.find((it) => !this.ident.isKnown(it.type)) ?? p.inventory.items.find((it) => !it.bucKnown);
        if (target) {
          this.ident.learn(target.type); target.bucKnown = true;
          this.log.add(`It is ${target.buc ? target.buc + " " : ""}${target.type.name}.`, "good");
        } else this.log.add("You have nothing to identify.", "dim");
        break;
      }
      case "enchant": {
        // A cursed scroll degrades the blade instead of tempering it.
        if (p.weapon) {
          const d = buc === "blessed" ? 2 : buc === "cursed" ? -1 : 1;
          p.weaponBonus += d; p.applyWeapon();
          if (d > 0) this.log.add(`Your ${p.weapon.type.name} thrums with finality. (+${p.weaponBonus})`, "good");
          else this.log.add(`Your ${p.weapon.type.name} corrodes — a malformed enchantment! (${p.weaponBonus >= 0 ? "+" : ""}${p.weaponBonus})`, "bad");
        } else this.log.add("You have no weapon to enchant.", "dim");
        break;
      }
      case "cure": {
        if (p.poison > 0 || p.confused > 0) { p.poison = 0; p.confused = 0; this.log.add("A cleansing light — your afflictions lift.", "good"); }
        else this.log.add("You feel briefly cleansed.", "dim");
        break;
      }
      case "uncurse": {
        // A formal-verification pass clears every curse you carry and reveals sanctity.
        const wash = buc === "blessed"; // blessed verification also blesses the cleansed items
        let n = 0;
        for (const it of p.inventory.items) {
          if (it.buc === "cursed") { it.buc = wash ? "blessed" : "uncursed"; n++; }
          it.bucKnown = true;
        }
        p.applyWeapon();
        this.log.add(n > 0 ? `Verification passes — ${n} curse${n > 1 ? "s" : ""} lifted; your pack is audited.` : "Verification passes — your gear is clean.", "good");
        break;
      }
    }
    if (p.hp <= 0) this.killPlayer();
    this.draw();
  }

  // ── wallet + shops (Phase 2: gasless PAS economy) ──────────────────────────
  async connect(): Promise<void> {
    try {
      this.wallet = await connectWallet();
      this.player.pas = await bankBalancePas(this.wallet.address);
      const a = this.wallet.address;
      this.log.add(`Wallet connected: ${a.slice(0, 6)}…${a.slice(-4)} — purse ${this.player.pas} PAS.`, "sys");
      this.onWallet?.(a, this.player.pas);
      this.draw();
      void this.loadRelics(); // bring any owned NFT relics into the current pack
    } catch (e) {
      this.log.add(`Wallet: ${e instanceof Error ? e.message : "failed"}`, "bad");
    }
  }

  /** Load PAS into the purse (one on-chain tx); afterward all shopping is gasless. */
  async deposit(pas = 20): Promise<void> {
    if (!this.wallet) { this.log.add("Connect a wallet first.", "bad"); return; }
    try {
      this.log.add(`Loading ${pas} PAS into your purse (sign one tx)…`, "sys"); this.draw();
      await depositPas(this.wallet.provider, pas);
      this.player.pas = await bankBalancePas(this.wallet.address);
      this.onWallet?.(this.wallet.address, this.player.pas);
      this.log.add(`Purse loaded: ${this.player.pas} PAS. Shop gaslessly now.`, "good"); this.draw();
    } catch (e) {
      this.log.add(`Deposit failed: ${e instanceof Error ? e.message : "?"}`, "bad");
    }
  }

  private spawnShop(): void {
    const centers = this.level.roomCenters.slice(1); // not the start room
    if (centers.length === 0) return;
    const c = ROT.RNG.getItem(centers)!;
    const stock = ["ration", "heal", "vest", "sword", "tele", "crumb"]
      .map((id) => ITEMS.find((i) => i.id === id))
      .filter((t): t is ItemType => !!t);
    const offsets = [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1], [2, 0], [-2, 0]];
    let oi = 0;
    for (const t of stock) {
      while (oi < offsets.length) {
        const [dx, dy] = offsets[oi++];
        const x = c.x + dx, y = c.y + dy;
        if (this.level.isPassable(x, y) && !this.level.itemAt(x, y) &&
            this.level.tileAt(x, y) !== "stairsDown" && !(x === this.player.x && y === this.player.y)) {
          this.level.items.push({ x, y, type: t, price: PRICE[t.kind] ?? 4, buc: "uncursed", bucKnown: true });
          break;
        }
      }
    }
    // From the Parachain Reaches on, the bazaar may carry a relic — an NFT ware
    // that mints to you (gasless) on purchase and persists across runs.
    if (this.player.depth >= 4 && ROT.RNG.getUniform() < 0.5) {
      const relicTypes = ITEMS.filter((i) => isGear(i));
      const rt = ROT.RNG.getItem(relicTypes)!;
      const enchant = ROT.RNG.getUniformInt(1, 2);
      while (oi < offsets.length) {
        const [dx, dy] = offsets[oi++];
        const x = c.x + dx, y = c.y + dy;
        if (this.level.isPassable(x, y) && !this.level.itemAt(x, y) &&
            this.level.tileAt(x, y) !== "stairsDown" && !(x === this.player.x && y === this.player.y)) {
          this.level.items.push({ x, y, type: rt, price: 12 + enchant * 4, enchant, relic: true, mintOnBuy: true, buc: "blessed", bucKnown: true });
          this.log.add("A relic vendor is among them — a tradeable NFT, minted to you on purchase.", "dim");
          break;
        }
      }
    }
    // Post a Marketmaker to mind the stall — peaceful while you pay, lethal if you don't.
    const ring = [[2, 1], [1, 2], [-2, -1], [-1, -2], [2, -1], [-2, 1], [1, -2], [-1, 2], [2, 0], [-2, 0], [0, 2], [0, -2]];
    let keeper = false;
    for (const [dx, dy] of ring) {
      const x = c.x + dx, y = c.y + dy;
      if (this.level.isPassable(x, y) && !this.level.itemAt(x, y) && !this.monsterAt(x, y) &&
          this.level.tileAt(x, y) !== "stairsDown" && this.level.tileAt(x, y) !== "stairsUp" &&
          !(x === this.player.x && y === this.player.y)) {
        this.monsters.push(new Monster(this, SHOPKEEPER, x, y));
        keeper = true;
        break;
      }
    }
    this.log.add(
      keeper
        ? "A bazaar glints on this floor — the Marketmaker ($) tends it. Pay with PAS (stand on a ware, press p); shoplift and it turns lethal."
        : "A bazaar glints somewhere on this floor — provisions for PAS (stand on a ware, press p).",
      "dim",
    );
  }

  async tryBuy(): Promise<void> {
    const fi = this.level.itemAt(this.player.x, this.player.y);
    if (!fi || !fi.price) { this.log.add("There is nothing for sale here.", "dim"); return; }
    if (!this.wallet) { this.log.add("Connect a wallet (button above) to buy.", "bad"); return; }
    if (this.player.pas < fi.price) { this.log.add(`Not enough PAS — need ${fi.price}, purse has ${this.player.pas}.`, "bad"); return; }
    this.log.add(`Paying ${fi.price} PAS (sign — gasless)…`, "sys"); this.draw();
    const r = await spendPas(this.wallet.provider, this.wallet.address, fi.price);
    if (!r.ok) { this.log.add(`Purchase failed: ${r.error}`, "bad"); return; }
    this.giveItem(fi.type, { enchant: fi.enchant, relic: fi.relic, buc: fi.buc, bucKnown: fi.bucKnown });
    this.level.items = this.level.items.filter((i) => i !== fi);
    this.player.pas = await bankBalancePas(this.wallet.address);
    this.onWallet?.(this.wallet.address, this.player.pas);
    const tag = fi.relic ? ` +${fi.enchant ?? 0} ✦` : "";
    this.log.add(`Bought ${this.ident.name(fi.type)}${tag} for ${fi.price} PAS (gasless). Purse: ${this.player.pas}.`, "good");
    // A relic ware mints an NFT to you (the floor item is the same relic for this run).
    if (fi.relic && fi.mintOnBuy) {
      this.log.add("Minting your relic on-chain (sign — gasless)…", "sys"); this.draw();
      const g = await mintGear(this.wallet.provider, this.wallet.address, fi.type.id, fi.enchant ?? 0);
      if (g.ok) this.log.add("✦ Relic minted — an NFT you own and can trade on any marketplace. It returns in future runs.", "good");
      else this.log.add(`(relic mint skipped: ${g.error})`, "dim");
    }
    this.draw();
  }

  private kill(d: Entity): void {
    if (d === this.player) { this.gameOver(); return; }
    if (d === this.pet) { this.log.add("Your nominator falls. You descend alone.", "bad"); this.scheduler.remove(this.pet); return; }
    const m = d as Monster;
    this.monsters = this.monsters.filter((x) => x !== m);
    this.scheduler.remove(m);
    // A slain thief disgorges whatever it stole — reclaim it where it fell.
    if (m.stolen && !this.level.itemAt(m.x, m.y)) {
      this.level.items.push({ x: m.x, y: m.y, type: m.stolen.type, enchant: m.stolen.enchant, relic: m.stolen.relic, buc: m.stolen.buc, bucKnown: m.stolen.bucKnown });
      this.log.add(`${cap(m.name)} drops ${this.ident.name(m.stolen.type)} as it dies.`, "good");
      m.stolen = null;
    }
    if (m.def.boss) {
      this.defeatedBosses.add(this.player.depth);
      // A boss drops a relic-grade prize: an enchanted piece of equipment.
      const goodies = ITEMS.filter((i) => isGear(i));
      const prize = ROT.RNG.getItem(goodies)!;
      const enchant = ROT.RNG.getUniformInt(1, 3);
      if (!this.level.itemAt(m.x, m.y)) this.level.items.push({ x: m.x, y: m.y, type: prize, enchant, relic: true, buc: "blessed", bucKnown: true });
      this.log.add(`${cap(m.name)} falls! It leaves a relic — ${prize.name} +${enchant}.`, "good");
      // Etch it on-chain as a tradeable NFT (gasless: you sign, the relay mints).
      if (this.wallet) {
        this.log.add("Minting it as an on-chain relic (sign — gasless)…", "sys");
        void mintGear(this.wallet.provider, this.wallet.address, prize.id, enchant).then((r) => {
          if (r.ok) this.log.add("✦ Relic minted — it's an NFT now, tradeable on any marketplace. It returns in future runs.", "good");
          else this.log.add(`(relic mint skipped: ${r.error})`, "dim");
        });
      }
    } else {
      this.log.add(`${cap(m.name)} is destroyed.`, "good");
    }
  }

  // ── spawns ─────────────────────────────────────────────────────────────────
  private spawnMonsters(): void {
    const diff = this.currentChain?.difficulty ?? 1;
    // A chain's difficulty shifts the monster pool deeper/shallower and scales the count.
    const poolDepth = Math.max(1, this.player.depth + Math.round((diff - 1) * 4));
    const count = Math.round((4 + this.player.depth * 1.5) * diff) + (this.player.depth >= 7 ? 4 : 0);
    for (let i = 0; i < count; i++) {
      const def = this.pickMonster(poolDepth);
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

  /** A sybil replicates into an adjacent free cell (capped). */
  spawnSybilNear(x: number, y: number): boolean {
    if (this.monsters.length >= 40) return false;
    const offs = ROT.RNG.shuffle([[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]] as [number, number][]);
    for (const [dx, dy] of offs) {
      const nx = x + dx, ny = y + dy;
      if (this.level.isPassable(nx, ny) && !this.monsterAt(nx, ny) && !(nx === this.player.x && ny === this.player.y)) {
        const m = new Monster(this, MONSTERS[0], nx, ny);
        this.monsters.push(m);
        this.scheduler.add(m, true);
        return true;
      }
    }
    return false;
  }

  private spawnTraps(): void {
    const count = 2 + Math.floor(this.player.depth * 0.8);
    const kinds: TrapKind[] = ["gas", "slash", "reorg"];
    for (let i = 0; i < count; i++) {
      let pos = this.level.randomFloor();
      let tries = 0;
      while (tries < 40 && (this.level.tileAt(pos.x, pos.y) !== "floor" || this.level.trapAt(pos.x, pos.y) ||
             this.level.itemAt(pos.x, pos.y) || (pos.x === this.player.x && pos.y === this.player.y))) {
        pos = this.level.randomFloor(); tries++;
      }
      if (this.level.tileAt(pos.x, pos.y) === "floor")
        this.level.traps.push({ x: pos.x, y: pos.y, kind: ROT.RNG.getItem(kinds)!, revealed: false });
    }
  }

  triggerTrap(trap: Trap): void {
    trap.revealed = true;
    const p = this.player;
    switch (trap.kind) {
      case "gas": { const d = ROT.RNG.getUniformInt(3, 7); p.hp -= d; this.log.add(`A gas-fee trap drains ${d} from you!`, "bad"); break; }
      case "slash": { const d = ROT.RNG.getUniformInt(6, 12); p.hp -= d; this.log.add(`A slashing trap bites for ${d}!`, "bad"); break; }
      case "reorg": {
        let pos = this.level.randomFloor(), t = 0;
        while (t < 40 && (this.monsterAt(pos.x, pos.y) || this.level.tileAt(pos.x, pos.y) === "stairsDown")) { pos = this.level.randomFloor(); t++; }
        p.x = pos.x; p.y = pos.y; this.level.computeFOV(p.x, p.y);
        this.log.add("A reorg trap flings you across the level!", "bad"); break;
      }
    }
    if (p.hp <= 0) this.killPlayer();
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
    for (const g of this.level.graves) {
      if (this.level.isVisible(g.x, g.y)) this.display.draw(g.x, g.y, "‡", "#b0a890", COLORS.bg);
    }
    for (const t of this.level.traps) {
      if (t.revealed && this.level.isVisible(t.x, t.y)) this.display.draw(t.x, t.y, "^", "#d06060", COLORS.bg);
    }
    for (const pr of this.level.portals) {
      if (this.level.isVisible(pr.x, pr.y)) this.display.draw(pr.x, pr.y, "Ω", pr.chain.color, COLORS.bg);
    }
    for (const e of this.level.engravings) {
      if (this.level.isVisible(e.x, e.y)) this.display.draw(e.x, e.y, "§", "#b0a060", COLORS.bg); // later layers (items/actors) cover it
    }
    for (const fi of this.level.items) {
      if (this.level.isVisible(fi.x, fi.y)) this.display.draw(fi.x, fi.y, fi.type.ch, fi.type.fg, fi.price ? "#2a2208" : COLORS.bg);
    }
    for (const m of this.monsters) {
      if (!m.alive || !this.level.isVisible(m.x, m.y)) continue;
      const dormant = m.def.mimic && !m.revealed; // a honeypot shows as loot until sprung
      this.display.draw(m.x, m.y, dormant ? m.disguiseCh : m.ch, dormant ? m.disguiseFg : m.fg, COLORS.bg);
    }
    if (this.pet && this.pet.alive && this.level.isVisible(this.pet.x, this.pet.y)) {
      this.display.draw(this.pet.x, this.pet.y, this.pet.ch, this.pet.fg, COLORS.bg);
    }
    this.display.draw(this.player.x, this.player.y, this.player.ch, this.player.fg, COLORS.bg);

    const p = this.player;
    const hpCol = p.hp <= p.maxHp * 0.3 ? COLORS.bad : COLORS.good;
    const hunger = p.hungerWord();
    this.display.drawText(
      1, MAP_H + 1,
      `%c{${COLORS.dim}}HP %c{${hpCol}}${p.hp}%c{${COLORS.dim}}/${p.maxHp}  Depth %c{${COLORS.gold}}${p.depth}` +
      (this.currentChain ? `%c{${COLORS.dim}} @%c{${this.currentChain.color}}${this.currentChain.name}` : `%c{${COLORS.dim}} @%c{${COLORS.dim}}Relay`) +
      `%c{${COLORS.dim}}  AC %c{${COLORS.good}}${p.ac}` +
      `%c{${COLORS.dim}}  PAS %c{${COLORS.gold}}${p.pas}` +
      (hunger ? `%c{${COLORS.dim}}  %c{${COLORS.bad}}${hunger}` : "") +
      (p.poison > 0 ? `%c{${COLORS.dim}}  %c{${COLORS.bad}}Psn` : "") +
      (p.confused > 0 ? `%c{${COLORS.dim}}  %c{${COLORS.bad}}Cfz` : "") +
      (p.hasJam ? `%c{${COLORS.dim}}  %c{${COLORS.gold}}✦JAM — ASCEND (<)` : `%c{${COLORS.dim}}  JAM: depth ${MAX_DEPTH}`),
    );
  }
}
