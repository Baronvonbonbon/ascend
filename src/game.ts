import * as ROT from "rot-js";
import { Level, Trap, TrapKind } from "./level";
import { Entity, Player, Monster } from "./entities";
import { Log } from "./log";
import {
  COLORS, TILE_GLYPH, MONSTERS, MonsterDef, DEATHS, GREETINGS,
  MAX_DEPTH, CENSOR, realmName, GRAY_PAPER,
} from "./data";
import { Idents, ITEMS, JAM, pickItemType, ItemType, EffectId } from "./items";
import { connectWallet, Wallet } from "./chain/wallet";
import { bankBalancePas, spendPas, depositPas } from "./chain/bank";
import { recordRun, readRecent, RunEntry } from "./chain/ledger";

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
    this.ident = new Idents();
    this.level = new Level(W, MAP_H);
    this.player = new Player(this, this.level.start.x, this.level.start.y);
    this.giveStartingKit();
    this.enterLevel();
    this.log.add(ROT.RNG.getItem(GREETINGS)!, "sys");
    for (const line of GRAY_PAPER) this.log.add(line, "dim");
    this.log.add("Keys: move · , pick up · p buy · P pray · < up · > down · i/w/W/q/r/e/d items.", "dim");
    this.draw();
    this.engine = new ROT.Engine(this.scheduler);
    this.engine.start();
    void this.fetchLeaderboard();
  }

  private async fetchLeaderboard(): Promise<void> {
    try { this.recentRuns = await readRecent(12); } catch { /* offline is fine */ }
  }

  private giveStartingKit(): void {
    const dagger = ITEMS.find((i) => i.id === "dagger")!;
    const ration = ITEMS.find((i) => i.id === "ration")!;
    const wielded = this.player.inventory.add(dagger);
    this.player.weapon = wielded;
    this.player.attackDmg = dagger.dmg!;
    this.player.inventory.add(ration);
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
    if (this.player.depth >= MAX_DEPTH) this.placeJamAndBoss();
    for (const m of this.monsters) this.scheduler.add(m, true);
    this.level.computeFOV(this.player.x, this.player.y);
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

  ascend(): void {
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
    this.log.add("Gavin, the Architect, hears you. You are made whole.", "good");
    if (ROT.RNG.getUniform() < 0.4) {
      for (const it of p.inventory.items) this.ident.learn(it.type);
      this.log.add("Truth is revealed — your pack is identified.", "sys");
    }
    this.draw();
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
    const [lo, hi] = a.attackDmg;
    let dmg = ROT.RNG.getUniformInt(lo, hi);
    if (d === this.player && this.player.ac > 0) dmg = Math.max(1, dmg - this.player.ac); // armor soaks
    d.hp -= dmg;
    if (a === this.player) this.log.add(`You strike ${d.name} for ${dmg}.`, "good");
    else if (d === this.player) this.log.add(`${cap(a.name)} hits you for ${dmg}.`, "bad");
    if (d.hp <= 0) this.kill(d);
  }

  killPlayer(): void {
    this.gameOver();
  }

  // ── items ──────────────────────────────────────────────────────────────────
  private spawnItems(): void {
    const count = 3 + Math.floor(this.player.depth * 0.7);
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
      this.level.items.push({ x: pos.x, y: pos.y, type });
    }
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
    this.player.inventory.add(fi.type);
    this.level.items = this.level.items.filter((i) => i !== fi);
    this.log.add(`You pick up ${this.ident.name(fi.type)}.`);
    return true;
  }

  dropItem(type: ItemType): void {
    this.level.items.push({ x: this.player.x, y: this.player.y, type });
  }

  showInventory(): void {
    const inv = this.player.inventory;
    if (inv.items.length === 0) { this.log.add("Your pack is empty.", "dim"); return; }
    this.log.add("— Inventory —", "sys");
    inv.items.forEach((it, i) => {
      const eq = it === this.player.weapon ? " (wielded)" : it === this.player.armor ? " (worn)" : it === this.player.ring ? " (on hand)" : "";
      this.log.add(`  ${inv.letter(i)}) ${this.ident.name(it.type)}${eq}`, "dim");
    });
  }

  applyEffect(effect: EffectId): void {
    const p = this.player;
    switch (effect) {
      case "heal": {
        p.hp = Math.min(p.maxHp, p.hp + ROT.RNG.getUniformInt(10, 16));
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
        const unk = p.inventory.items.find((it) => !this.ident.isKnown(it.type));
        if (unk) { this.ident.learn(unk.type); this.log.add(`It is ${unk.type.name}.`, "good"); }
        else this.log.add("You have nothing to identify.", "dim");
        break;
      }
      case "enchant": {
        if (p.weapon) { p.weaponBonus++; p.applyWeapon(); this.log.add(`Your ${p.weapon.type.name} thrums with finality. (+${p.weaponBonus})`, "good"); }
        else this.log.add("You have no weapon to enchant.", "dim");
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
          this.level.items.push({ x, y, type: t, price: PRICE[t.kind] ?? 4 });
          break;
        }
      }
    }
    this.log.add("A bazaar glints somewhere on this floor — provisions for PAS (stand on a ware, press p).", "dim");
  }

  async tryBuy(): Promise<void> {
    const fi = this.level.itemAt(this.player.x, this.player.y);
    if (!fi || !fi.price) { this.log.add("There is nothing for sale here.", "dim"); return; }
    if (!this.wallet) { this.log.add("Connect a wallet (button above) to buy.", "bad"); return; }
    if (this.player.pas < fi.price) { this.log.add(`Not enough PAS — need ${fi.price}, purse has ${this.player.pas}.`, "bad"); return; }
    this.log.add(`Paying ${fi.price} PAS (sign — gasless)…`, "sys"); this.draw();
    const r = await spendPas(this.wallet.provider, this.wallet.address, fi.price);
    if (!r.ok) { this.log.add(`Purchase failed: ${r.error}`, "bad"); return; }
    this.player.inventory.add(fi.type);
    this.level.items = this.level.items.filter((i) => i !== fi);
    this.player.pas = await bankBalancePas(this.wallet.address);
    this.onWallet?.(this.wallet.address, this.player.pas);
    this.log.add(`Bought ${this.ident.name(fi.type)} for ${fi.price} PAS (gasless). Purse: ${this.player.pas}.`, "good");
    this.draw();
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
    const count = 4 + Math.floor(depth * 1.5) + (depth >= 7 ? 4 : 0); // the Kusama Deeps swarm
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
    for (const fi of this.level.items) {
      if (this.level.isVisible(fi.x, fi.y)) this.display.draw(fi.x, fi.y, fi.type.ch, fi.type.fg, fi.price ? "#2a2208" : COLORS.bg);
    }
    for (const m of this.monsters) {
      if (m.alive && this.level.isVisible(m.x, m.y)) this.display.draw(m.x, m.y, m.ch, m.fg, COLORS.bg);
    }
    this.display.draw(this.player.x, this.player.y, this.player.ch, this.player.fg, COLORS.bg);

    const p = this.player;
    const hpCol = p.hp <= p.maxHp * 0.3 ? COLORS.bad : COLORS.good;
    const hunger = p.hungerWord();
    this.display.drawText(
      1, MAP_H + 1,
      `%c{${COLORS.dim}}HP %c{${hpCol}}${p.hp}%c{${COLORS.dim}}/${p.maxHp}  Depth %c{${COLORS.gold}}${p.depth}` +
      `%c{${COLORS.dim}}  AC %c{${COLORS.good}}${p.ac}` +
      `%c{${COLORS.dim}}  PAS %c{${COLORS.gold}}${p.pas}` +
      (hunger ? `%c{${COLORS.dim}}  %c{${COLORS.bad}}${hunger}` : "") +
      (p.hasJam ? `%c{${COLORS.dim}}  %c{${COLORS.gold}}✦JAM — ASCEND (<)` : `%c{${COLORS.dim}}  JAM: depth ${MAX_DEPTH}`),
    );
  }
}
