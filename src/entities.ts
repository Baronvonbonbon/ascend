import * as ROT from "rot-js";
import type { Game } from "./game";
import { COLORS, MonsterDef, SPELLS, spellById } from "./data";
import { Inventory, Item } from "./inventory";
import { bucDelta, ITEMS, ItemType, ArmorSlot } from "./items";

type Verb = "wield" | "wear" | "takeoff" | "quaff" | "read" | "eat" | "drop" | "zap" | "throw" | "forge" | "apply" | "quiver";
const VERB_PROMPT: Record<Verb, string> = {
  wield: "Wield which weapon?", wear: "Wear/put on which item?",
  quaff: "Quaff which potion?", read: "Read which scroll?",
  eat: "Eat what?", drop: "Drop which item?", zap: "Zap which wand?",
  throw: "Throw which item?", forge: "Forge which piece of gear into an NFT relic?",
  takeoff: "Take off which worn piece?", apply: "Apply which tool?",
  quiver: "Ready which item in your quiver?",
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
  ac = 0; // total evasion bonus from worn armor (higher = harder to hit)
  inventory = new Inventory();
  weapon: Item | null = null;
  wornArmor: Item[] = []; // up to one piece per slot
  ring: Item | null = null;
  stealth = false;     // ring of privacy — monsters can't track you
  regenFast = false;   // ring of regeneration
  poison = 0;          // turns of damage-over-time remaining
  confused = 0;        // turns of staggering movement remaining
  stoning = 0;         // turns until you freeze solid (petrification) — cure fast
  illness = 0;         // turns until food poisoning kills you — cure fast
  blind = 0;           // turns of blindness — FOV shrinks to your fingertips
  intrinsics = new Set<string>(); // poisonResist, petrifyResist, fast (from eating corpses)
  private regenTimer = 0;
  hasJam = false;
  maxDepthReached = 1;
  weaponBonus = 0; // from scrolls of enchantment
  prayerCooldown = 0;
  // Phase 6 — character sheet
  str = 12; dex = 12; con = 12; int = 12; wis = 12; cha = 12;
  level = 1; xp = 0;
  archetype = "validator";
  luck = 0; // Fortune (−13..+13) from altar offerings — sways every roll
  ethos = "Balance"; // Order / Balance / Chaos
  favor = 0; crowned = false; title = ""; // standing with your Architect; crowning
  // Phase 8 — polymorph self ("fork")
  polyForm: MonsterDef | null = null;
  polyTurns = 0; savedHp = 0; savedMaxHp = 0;
  // Phase 8 — spellcasting
  energy = 5; maxEnergy = 5;
  spells = new Set<string>(); // known spell ids
  senseTurns = 0;             // sense minds — monsters revealed
  hasteTurns = 0;             // overclock — temporary speed
  private energyTimer = 0;

  /** Recompute attack damage from the wielded weapon (or fists) + enchant bonus. */
  applyWeapon(): void {
    if (this.weapon) {
      const b = this.weaponBonus + (this.weapon.enchant ?? 0) + bucDelta(this.weapon.buc); // scroll enchant + relic enchant + sanctity
      this.attackDmg = [this.weapon.type.dmg![0] + b, this.weapon.type.dmg![1] + b];
    } else this.attackDmg = [1, 3];
  }

  /** Effective evasion of one armor piece: base + enchant + sanctity − erosion (min 0). */
  armorValue(it: Item): number {
    return Math.max(0, (it.type.ac ?? 0) + (it.enchant ?? 0) + bucDelta(it.buc) - (it.erosion ?? 0));
  }
  /** Recompute total AC (evasion) from every worn piece. */
  recomputeAC(): void { this.ac = this.wornArmor.reduce((s, it) => s + this.armorValue(it), 0); }
  armorInSlot(slot: ArmorSlot): Item | undefined { return this.wornArmor.find((a) => (a.type.slot ?? "body") === slot); }

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
  private pendingThrow: Item | null = null; // an item awaiting a throw direction
  quiver: Item | null = null;               // readied missile for the `f`ire command
  private pendingApply: Item | null = null; // a tool awaiting a direction (excavator / state reader)
  private pendingWrite: Item | null = null; // a contract deployer awaiting a scroll choice
  private pendingSpell = false;             // choosing a spell to cast
  private pendingCastDir: string | null = null; // a directional spell awaiting a direction
  private pendingChat = false;              // choosing a direction to chat
  private pendingLook = false;              // farlook (;) — choosing a direction to examine
  private pendingWhatIs = false;            // what-is (/) — awaiting a glyph to identify
  private castMenu: string[] = [];          // spell ids in the current cast menu order
  private resolveTurn: (() => void) | null = null;
  // Interleaved co-op turns: keys are queued and consumed only on this player's turn.
  private inputQueue: string[] = [];
  private awaiting = false;

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

  getSpeed(): number {
    const haste = this.hasteTurns > 0 ? 50 : 0; // overclock spell
    if (this.polyForm) return Math.max(20, this.polyForm.speed ?? 100) + haste; // move as your fork
    const base = this.intrinsics.has("fast") ? 130 : 100; // intrinsic speed from a fork-daemon corpse
    return base + haste;
  }

  act(): Promise<void> {
    this.game.draw(); // start of the player's turn = monsters have moved
    return new Promise((resolve) => {
      this.resolveTurn = resolve;
      this.awaiting = true;
      this.drainQueue(); // consume any input already queued for us
    });
  }

  /** Queue a keystroke for this player; process it now if it's our turn. */
  feed(key: string): void {
    this.inputQueue.push(key);
    if (this.inputQueue.length > 16) this.inputQueue.shift();
    if (this.awaiting) this.drainQueue();
  }

  private drainQueue(): void {
    while (this.awaiting && this.inputQueue.length) {
      const key = this.inputQueue.shift()!;
      const consumed = this.handleKey({ key } as KeyboardEvent);
      if (consumed) { this.awaiting = false; break; } // endTurn() already resolved the turn
    }
  }

  /** Release a pending turn without acting — used when a co-op partner drops out. */
  cancelTurn(): void {
    this.inputQueue = [];
    this.awaiting = false;
    const r = this.resolveTurn;
    this.resolveTurn = null;
    if (r) r();
  }

  private endTurn(): boolean {
    this.tickHunger();
    this.game.tickEngravings();
    if (this.prayerCooldown > 0) this.prayerCooldown--;
    // Poison: damage over time. Confusion: just counts down.
    if (this.poison > 0) {
      this.poison--; this.hp--;
      if (this.poison === 0) this.game.log.add("The poison passes.", "dim");
      if (this.hp <= 0) { this.game.log.add(`The poison takes ${this.name}.`, "bad"); this.game.killPlayer(this); }
    }
    if (this.confused > 0 && --this.confused === 0) this.game.log.add("Your head clears.", "dim");
    if (this.blind > 0 && --this.blind === 0) { this.game.log.add(`${this.name === "you" ? "Your sight returns" : this.name + "'s sight returns"}.`, "good"); this.game.recomputeFOV(); }
    // Petrification & illness are countdowns you must out-race (prayer / a cure).
    if (this.stoning > 0 && --this.stoning === 0) {
      this.game.log.add(`${this.name === "you" ? "You freeze" : this.name + " freezes"} solid — finality denied.`, "bad");
      this.game.killPlayer(this);
    }
    if (this.illness > 0 && --this.illness === 0) {
      this.game.log.add(`${this.name === "you" ? "You succumb" : this.name + " succumbs"} to the bad block.`, "bad");
      this.game.killPlayer(this);
    }
    this.game.turn++;
    if (this.polyForm && --this.polyTurns <= 0) this.game.revertPoly(this);
    if (this.senseTurns > 0) this.senseTurns--;
    if (this.hasteTurns > 0 && --this.hasteTurns === 0) this.game.log.add(`${this.name === "you" ? "You slow" : this.name + " slows"} back to normal.`, "dim");
    // Natural regeneration (faster with a ring of regeneration; not while starving/poisoned).
    if (this.hp < this.maxHp && this.nutrition > 0 && this.poison === 0 && ++this.regenTimer >= (this.regenFast ? 5 : 14)) {
      this.regenTimer = 0; this.hp++;
    }
    // Energy (Pw) regenerates steadily.
    if (this.energy < this.maxEnergy && ++this.energyTimer >= 6) { this.energyTimer = 0; this.energy++; }
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
      this.game.log.add(`${this.name === "you" ? "You are" : this.name + " is"} starving!`, "bad");
      if (this.hp <= 0) this.game.killPlayer(this);
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
    this.game.acting = this; // the player whose action this is (co-op: host or guest avatar)
    if (this.pendingDir) return this.resolveZapDir(e);
    if (this.pendingThrow) return this.resolveThrowDir(e);
    if (this.pendingApply) return this.resolveApplyDir(e);
    if (this.pendingWrite) return this.resolveWrite(e);
    if (this.pendingCastDir) return this.resolveCastDir(e);
    if (this.pendingChat) return this.resolveChatDir(e);
    if (this.pendingLook) return this.resolveLookDir(e);
    if (this.pendingWhatIs) { this.pendingWhatIs = false; if (e.key !== "Escape") this.game.whatIs(e.key); else this.game.log.add("Never mind.", "dim"); return false; }
    if (this.pendingSpell) return this.resolveCast(e);
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
      case "@": this.game.showCharSheet(); return false;
      case "w": return this.startSelect("wield");
      case "W": return this.startSelect("wear");
      case "q": return this.game.level.tileAt(this.x, this.y) === "faucet" ? (this.game.quaffFaucet(this) ? this.endTurn() : false) : this.startSelect("quaff");
      case "s": return this.game.level.tileAt(this.x, this.y) === "throne" ? (this.game.sitThrone(this) ? this.endTurn() : false) : (this.game.search(this) ? this.endTurn() : false);
      case "o": return this.game.openChest(this) ? this.endTurn() : false;
      case "r": return this.startSelect("read");
      case "e": return this.game.eatFloorCorpse(this) ? this.endTurn() : this.startSelect("eat");
      case "d": return this.startSelect("drop");
      case "z": return this.startSelect("zap");
      case "t": return this.startSelect("throw");
      case "Q": return this.startSelect("quiver");
      case "f": return this.fireQuiver();
      case "c": this.pendingChat = true; this.game.log.add("Chat in which direction? (a move key, Esc to cancel)", "sys"); return false;
      case ";": this.pendingLook = true; this.game.log.add("Look in which direction? (a move key, Esc to cancel)", "sys"); return false;
      case "/": this.pendingWhatIs = true; this.game.log.add("What is that symbol? (type any glyph, Esc to cancel)", "sys"); return false;
      case "a": return this.startSelect("apply");
      case "Z": return this.startCast();
      case "O": return this.game.offerCorpse(this) ? this.endTurn() : false;
      case "T": return this.startSelect("takeoff");
      case "E": return this.game.engrave() ? this.endTurn() : false;
      case "F": return this.startSelect("forge");
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
    if (verb === "throw") {
      if (item.type.kind !== "weapon" && item.type.kind !== "potion") { this.game.log.add("You can't throw that to any effect.", "dim"); return false; }
      if (this.isWelded(item)) { item.bucKnown = true; this.game.log.add(`You can't release ${this.game.ident.name(item.type)} — it's cursed!`, "bad"); return false; }
      this.pendingThrow = item;
      this.game.log.add("Throw in which direction? (a move key, Esc to cancel)", "sys");
      return false;
    }
    if (verb === "quiver") {
      if (item.type.kind !== "weapon" && item.type.kind !== "potion") { this.game.log.add("That won't fly true — quiver a weapon or potion.", "dim"); return false; }
      if (this.isWelded(item)) { item.bucKnown = true; this.game.log.add(`You can't ready ${this.game.ident.name(item.type)} — it's cursed to your hand!`, "bad"); return false; }
      this.quiver = item;
      this.game.log.add(`You ready ${this.game.ident.name(item.type)} in your quiver. (f to fire)`, "good");
      return false;
    }
    if (verb === "apply") {
      if (item.type.kind !== "tool") { this.game.log.add("That isn't a tool you can apply.", "dim"); return false; }
      const id = item.type.id;
      if (id === "horn") return this.game.applyHorn(this) ? this.endTurn() : false;
      if (id === "pickaxe" || id === "scope") {
        this.pendingApply = item;
        this.game.log.add(`${id === "pickaxe" ? "Dig" : "Probe"} in which direction? (a move key, Esc to cancel)`, "sys");
        return false;
      }
      if (id === "marker") {
        this.pendingWrite = item;
        this.game.promptWrite();
        return false;
      }
      this.game.log.add("Nothing happens.", "dim"); return false;
    }
    return this.doVerb(verb, item);
  }

  private resolveApplyDir(e: KeyboardEvent): boolean {
    const item = this.pendingApply!;
    this.pendingApply = null;
    if (e.key === "Escape") { this.game.log.add("Never mind.", "dim"); return false; }
    const mv = MOVES[e.key];
    if (!mv) { this.game.log.add("That is not a direction.", "dim"); return false; }
    return this.game.applyTool(item, mv[0], mv[1]) ? this.endTurn() : false;
  }

  private resolveWrite(e: KeyboardEvent): boolean {
    const item = this.pendingWrite!;
    this.pendingWrite = null;
    if (e.key === "Escape") { this.game.log.add("Never mind.", "dim"); return false; }
    const n = parseInt(e.key, 10);
    if (isNaN(n)) { this.game.log.add("Choose a number from the menu.", "dim"); return false; }
    return this.game.writeScroll(item, n - 1) ? this.endTurn() : false;
  }

  private startCast(): boolean {
    this.game.acting = this;
    if (this.spells.size === 0) { this.game.log.add("You know no extrinsics. Study a runtime (+) first.", "dim"); return false; }
    this.castMenu = SPELLS.filter((s) => this.spells.has(s.id)).map((s) => s.id);
    const menu = this.castMenu.map((id, i) => { const s = spellById(id)!; return `(${i + 1}) ${s.name} [${s.cost}En]`; }).join("  ");
    this.game.log.add(`Cast which extrinsic? (En ${this.energy}/${this.maxEnergy})  ${menu}  (Esc to cancel)`, "sys");
    this.pendingSpell = true;
    return false;
  }

  private resolveCast(e: KeyboardEvent): boolean {
    this.pendingSpell = false;
    if (e.key === "Escape") { this.game.log.add("Never mind.", "dim"); return false; }
    const n = parseInt(e.key, 10);
    if (isNaN(n) || n < 1 || n > this.castMenu.length) { this.game.log.add("No such spell.", "dim"); return false; }
    const s = spellById(this.castMenu[n - 1])!;
    if (this.energy < s.cost) { this.game.log.add(`Not enough energy — ${s.name} needs ${s.cost}.`, "bad"); return false; }
    if (s.dir) { this.pendingCastDir = s.id; this.game.log.add(`Cast ${s.name} in which direction? (a move key, Esc to cancel)`, "sys"); return false; }
    return this.game.castSpell(s.id, 0, 0) ? this.endTurn() : false;
  }

  private resolveCastDir(e: KeyboardEvent): boolean {
    const id = this.pendingCastDir!;
    this.pendingCastDir = null;
    if (e.key === "Escape") { this.game.log.add("Never mind.", "dim"); return false; }
    const mv = MOVES[e.key];
    if (!mv) { this.game.log.add("That is not a direction.", "dim"); return false; }
    return this.game.castSpell(id, mv[0], mv[1]) ? this.endTurn() : false;
  }

  /** `f` — fire the readied quiver item. */
  private fireQuiver(): boolean {
    this.game.acting = this;
    if (!this.quiver || !this.inventory.items.includes(this.quiver)) {
      // quiver empty or its item is gone — try to auto-load the first throwable
      this.quiver = this.inventory.items.find((it) => it.type.kind === "weapon" || it.type.kind === "potion") ?? null;
      if (!this.quiver) { this.game.log.add("You have nothing readied to fire. (Q to ready a missile)", "dim"); return false; }
      this.game.log.add(`You ready ${this.game.ident.name(this.quiver.type)} in your quiver.`, "dim");
    }
    if (this.isWelded(this.quiver)) { this.quiver.bucKnown = true; this.game.log.add("Your readied missile is cursed to your hand!", "bad"); this.quiver = null; return false; }
    this.pendingThrow = this.quiver;
    this.game.log.add("Fire in which direction? (a move key, Esc to cancel)", "sys");
    return false;
  }

  private resolveChatDir(e: KeyboardEvent): boolean {
    this.pendingChat = false;
    if (e.key === "Escape") { this.game.log.add("Never mind.", "dim"); return false; }
    const mv = MOVES[e.key];
    if (!mv) { this.game.log.add("That is not a direction.", "dim"); return false; }
    const foe = this.game.monsterAt(this.x + mv[0], this.y + mv[1]);
    if (!foe) { this.game.log.add("There's no one there to chat with.", "dim"); return false; }
    this.game.chat(foe); // a free social action — costs no turn
    return false;
  }

  private resolveLookDir(e: KeyboardEvent): boolean {
    this.pendingLook = false;
    if (e.key === "Escape") { this.game.log.add("Never mind.", "dim"); return false; }
    const mv = MOVES[e.key];
    if (!mv) { this.game.log.add("That is not a direction.", "dim"); return false; }
    this.game.lookAt(this.x + mv[0], this.y + mv[1]); // a free survey — costs no turn
    return false;
  }

  private resolveThrowDir(e: KeyboardEvent): boolean {
    const item = this.pendingThrow!;
    this.pendingThrow = null;
    if (e.key === "Escape") { this.game.log.add("Never mind.", "dim"); return false; }
    const mv = MOVES[e.key];
    if (!mv) { this.game.log.add("That is not a direction.", "dim"); return false; }
    this.unequip(item); this.inventory.remove(item);
    this.game.throwItem(item, mv[0], mv[1]);
    // auto-refill the quiver with the next missile of the same type, else clear it
    if (this.quiver === item) this.quiver = this.inventory.items.find((it) => it.type === item.type) ?? null;
    return this.endTurn();
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
          const slot: ArmorSlot = t.slot ?? "body";
          const current = this.armorInSlot(slot);
          if (item === current) { this.game.log.add("You're already wearing that.", "dim"); return false; }
          if (current && current.buc === "cursed") {
            current.bucKnown = true;
            this.game.log.add(`You'd have to remove ${ident.name(current.type)} first — but it's welded on, cursed!`, "bad");
            return this.endTurn();
          }
          if (current) this.wornArmor = this.wornArmor.filter((a) => a !== current); // swap out the slot's old piece
          this.wornArmor.push(item); this.recomputeAC();
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
        if (t.kind === "spellbook") return this.game.studySpellbook(item) ? this.endTurn() : false;
        if (t.kind !== "scroll") { this.game.log.add("There is nothing to read.", "dim"); return false; }
        ident.learn(t); this.game.log.add(`You read ${t.name}.`);
        this.inventory.remove(item); this.unequip(item);
        this.game.applyEffect(t.effect!, item.buc); return this.endTurn();
      case "drop":
        if (t.id === "hodlstone" && item.buc === "cursed") { item.bucKnown = true; this.game.log.add(`The ${t.name} won't leave your pack — a cursed loadstone!`, "bad"); return this.endTurn(); }
        if (this.isWelded(item)) { item.bucKnown = true; this.game.log.add(`You can't let go of ${ident.name(t)} — it's cursed!`, "bad"); return this.endTurn(); }
        this.inventory.remove(item); this.unequip(item);
        this.game.dropItem(item); this.game.log.add(`You drop ${ident.name(t)}.`); return this.endTurn();
      case "takeoff":
        if (t.kind !== "armor" || !this.wornArmor.includes(item)) { this.game.log.add("You aren't wearing that.", "dim"); return false; }
        if (item.buc === "cursed") { item.bucKnown = true; this.game.log.add(`Your ${ident.name(t)} is welded on — it's cursed. Uncurse it first.`, "bad"); return this.endTurn(); }
        this.wornArmor = this.wornArmor.filter((a) => a !== item); this.recomputeAC();
        this.game.log.add(`You take off ${ident.name(t)}.`); return this.endTurn();
      case "forge":
        void this.game.forge(item); return false; // a direct wallet tx — no game turn
    }
    return false;
  }

  private unequip(item: Item): void {
    if (this.weapon === item) { this.weapon = null; this.applyWeapon(); }
    if (this.wornArmor.includes(item)) { this.wornArmor = this.wornArmor.filter((a) => a !== item); this.recomputeAC(); }
    if (this.ring === item) { this.applyRing(item, false); this.ring = null; }
  }

  /** A cursed item that's currently equipped is welded — it can't be removed or dropped. */
  isWelded(item: Item): boolean {
    return item.buc === "cursed" && (item === this.weapon || this.wornArmor.includes(item) || item === this.ring);
  }

  private tryMove(dx: number, dy: number): boolean {
    if (this.confused > 0 && ROT.RNG.getUniform() < 0.6) {
      const d = ROT.RNG.getItem([[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, 1], [-1, 1], [1, -1]] as [number, number][])!;
      dx = d[0]; dy = d[1];
      this.game.log.add("You stagger drunkenly.", "dim");
    }
    const nx = this.x + dx, ny = this.y + dy;
    const foe = this.game.monsterAt(nx, ny);
    if (foe && !foe.peaceful) { this.game.attack(this, foe); return this.endTurn(); } // only hostiles get hit
    // Bumping your co-op partner: blocked in pure co-op, a strike under friendly-fire / race.
    const ally = this.game.otherPlayerAt(this, nx, ny);
    if (ally) {
      if (this.game.coopMode === "coop") return false;
      this.game.attack(this, ally); return this.endTurn();
    }
    // Doors: a closed one you push open (a turn, then walk through); a locked one you kick.
    const tile = this.game.level.tileAt(nx, ny);
    if (tile === "doorClosed") {
      this.game.level.tiles[ny][nx] = "door";
      this.game.recomputeFOV();
      this.game.log.add("You open the door.", "dim");
      this.game.draw();
      return this.endTurn();
    }
    if (tile === "doorLocked") return this.game.kickDoor(this, nx, ny) ? this.endTurn() : false;
    if (!this.game.level.isPassable(nx, ny)) return false; // bumping a wall costs no turn
    // Push a boulder one tile if the space beyond is clear; otherwise it won't budge.
    const boulder = this.game.level.boulderAt(nx, ny);
    if (boulder) {
      const bx = nx + dx, by = ny + dy;
      if (this.game.level.isPassable(bx, by) && !this.game.level.boulderAt(bx, by) && !this.game.monsterAt(bx, by) && !this.game.playerAt(bx, by)) {
        boulder.x = bx; boulder.y = by;
        this.game.log.add("You heave the boulder forward.", "dim");
      } else { this.game.log.add("The boulder won't budge — break it (a fire ray) or go around.", "dim"); return false; }
    }
    // Displace — slip past a peaceful NPC (the Marketmaker) or your nominator; never attack a friend.
    if (foe && foe.peaceful) { foe.x = this.x; foe.y = this.y; this.game.log.add(`You slip past ${foe.name}.`, "dim"); }
    const pet = this.game.pet;
    if (pet && pet.alive && pet.x === nx && pet.y === ny) { pet.x = this.x; pet.y = this.y; }
    this.x = nx; this.y = ny;
    this.game.recomputeFOV();
    const here = this.game.level.itemAt(this.x, this.y);
    if (here) {
      if (here.chest) this.game.log.add(`A ${here.chest.locked ? "locked " : ""}chest sits here. (o to open)`, "dim");
      else if (here.corpse) this.game.log.add(`A ${here.corpse.def.name} corpse lies here. (e to eat)`, "dim");
      else {
        const nm = this.game.ident.name(here.type);
        this.game.log.add(here.price ? `${nm} — ${here.price} PAS (press p to buy).` : `You see ${nm} here. (, to pick up)`, "dim");
      }
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
  sleepTurns = 0; // a wand of stasis freezes it for a while
  blindTurns = 0; // a thrown potion of obfuscation blinds it — it can't chase
  cancelled = false; // a wand of nullification strips its special powers
  splitsLeft = 0; // a sybil's remaining replications — bounds the swarm (children inherit one fewer)
  stolen: Item | null = null; // a thief (rug puller) carries what it snatched; drops it on death
  // A shopkeeper stands peaceful until you steal; then it hunts you down.
  peaceful = false;
  // A mimic (honeypot) wears an item's glyph until it's touched.
  revealed = false;
  disguiseCh = "*";
  disguiseFg = "#ffffff";
  disguiseType: ItemType | null = null;
  constructor(game: Game, public def: MonsterDef, x: number, y: number) {
    super(game);
    this.x = x;
    this.y = y;
    this.ch = def.ch;
    this.fg = def.fg;
    this.name = def.name;
    this.hp = this.maxHp = def.hp;
    this.attackDmg = def.dmg;
    if (def.mimic) {
      const look = ROT.RNG.getItem(ITEMS.filter((i) => i.kind !== "amulet"))!;
      this.disguiseCh = look.ch; this.disguiseFg = look.fg; this.disguiseType = look;
    }
    if (def.keeper) this.peaceful = true; // minds its stall until provoked
    if (def.splits) this.splitsLeft = 2; // a fresh sybil can replicate at most twice
  }

  getSpeed(): number {
    return Math.max(20, Math.round((this.def.speed ?? 100) * this.speedMod));
  }

  act(): void {
    const p = this.game.nearestPlayer(this.x, this.y); // target the closer of the party
    if (!p.alive || !this.alive) return;

    // Frozen in stasis (a wand of stasis) — it loses the turn.
    if (this.sleepTurns > 0) { this.sleepTurns--; return; }
    // Blinded (a thrown potion of obfuscation) — it gropes about, unable to find you.
    if (this.blindTurns > 0) { this.blindTurns--; this.wanderStep(); return; }

    // A dormant honeypot just waits, wearing its loot disguise, until something touches it.
    if (this.def.mimic && !this.revealed) return;

    // A peaceful shopkeeper minds its stall — it neither chases nor attacks.
    if (this.peaceful) return;

    // A laden thief wants only to escape — it never turns to fight.
    if (this.stolen) { this.fleeStep(p); return; }

    // A coward turns tail once badly hurt.
    if (this.def.cowardly && this.hp < this.maxHp * 0.3) { this.fleeStep(p); return; }

    // A medic mends a wounded ally within reach instead of fighting.
    if (!this.cancelled && this.def.heals) {
      const ally = this.game.monsters.find((o) => o !== this && o.alive && o.hp < o.maxHp && Math.max(Math.abs(o.x - this.x), Math.abs(o.y - this.y)) <= 2 && this.game.hasLineOfSight(this.x, this.y, o.x, o.y));
      if (ally) {
        ally.hp = Math.min(ally.maxHp, ally.hp + ROT.RNG.getUniformInt(3, 7));
        const me = this.name.charAt(0).toUpperCase() + this.name.slice(1);
        this.game.log.add(`${me} mends ${ally.name}.`, "dim");
        return;
      }
    }

    // A Gray-Paper ward beneath the player holds ordinary foes at bay — they won't
    // attack or close in. Bosses and the Censor fear no scripture.
    if (!this.def.boss && !this.def.fearless && this.game.level.engravingAt(p.x, p.y)) {
      this.wanderStep();
      return;
    }

    // The Sybil attack: a sybil with budget left occasionally replicates (bounded). Nullified ones can't.
    if (!this.cancelled && this.def.splits && this.splitsLeft > 0 && ROT.RNG.getUniform() < 0.05 && this.game.spawnSybilNear(this)) return;
    // A conjurer summons reinforcements.
    if (!this.cancelled && this.def.summons && this.game.level.isVisible(this.x, this.y) && ROT.RNG.getUniform() < 0.1 && this.game.summonNear(this)) return;
    // Breeders multiply when a mate of their kind is adjacent.
    if (!this.cancelled && this.def.breeds && ROT.RNG.getUniform() < 0.06) {
      const mate = this.game.monsters.find((o) => o !== this && o.alive && o.def === this.def && Math.max(Math.abs(o.x - this.x), Math.abs(o.y - this.y)) === 1);
      if (mate && this.game.breedNear(this)) return;
    }

    const dist = Math.max(Math.abs(this.x - p.x), Math.abs(this.y - p.y));
    // The rug pull: a thief adjacent to you snatches a pack item and blinks away.
    if (!this.cancelled && this.def.steals && dist === 1) {
      const loot = this.game.stealItem(p);
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
    if (!this.cancelled && this.def.ranged && !p.stealth && dist >= 2 && dist <= 6 && this.game.level.isVisible(this.x, this.y) && this.game.hasLineOfSight(this.x, this.y, p.x, p.y)) {
      this.game.rangedAttack(this);
      return;
    }

    // A dragon breathes a ray when you're roughly in line.
    if (!this.cancelled && this.def.breath && !p.stealth && dist >= 2 && dist <= 5 && this.game.level.isVisible(this.x, this.y) && this.game.hasLineOfSight(this.x, this.y, p.x, p.y)) {
      this.game.breathAttack(this);
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
        const tgt = this.game.playerAt(nx, ny);
        if (tgt) { this.game.attack(this, tgt); return; }
        if (!this.game.monsterAt(nx, ny) && !this.game.level.boulderAt(nx, ny)) { this.x = nx; this.y = ny; }
      }
      return;
    }

    // Wander.
    this.wanderStep();
  }

  /** A random shuffle into an open neighbour — never onto a player. */
  private wanderStep(): void {
    const d = ROT.RNG.getItem([[-1, 0], [1, 0], [0, -1], [0, 1]] as [number, number][])!;
    const nx = this.x + d[0], ny = this.y + d[1];
    if (this.game.level.isPassable(nx, ny) && !this.game.monsterAt(nx, ny) && !this.game.playerAt(nx, ny) && !this.game.level.boulderAt(nx, ny)) {
      this.x = nx; this.y = ny;
    }
  }

  /** Step to the neighbouring tile that puts the most distance between us and the player. */
  private fleeStep(p: Player): void {
    let best: [number, number] | null = null, bestD = -1;
    for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1], [1, 1], [-1, -1], [1, -1], [-1, 1]] as [number, number][]) {
      const nx = this.x + dx, ny = this.y + dy;
      if (!this.game.level.isPassable(nx, ny) || this.game.monsterAt(nx, ny) || this.game.playerAt(nx, ny) || this.game.level.boulderAt(nx, ny)) continue;
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
      if (d >= 8 && !this.game.monsterAt(pos.x, pos.y) && !this.game.playerAt(pos.x, pos.y)) { this.x = pos.x; this.y = pos.y; return; }
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
