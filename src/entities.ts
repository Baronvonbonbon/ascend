import * as ROT from "rot-js";
import type { Game } from "./game";
import { COLORS, MonsterDef, SPELLS, spellById, monName } from "./data";
import { fp } from "./flavor";
import { Inventory, Item } from "./inventory";
import { bucDelta, ITEMS, ItemType, ArmorSlot, Idents } from "./items";

type Verb = "wield" | "wear" | "takeoff" | "quaff" | "read" | "eat" | "drop" | "zap" | "throw" | "forge" | "apply" | "quiver" | "name" | "offhand" | "dip" | "charge" | "grease";
const VERB_PROMPT: Record<Verb, string> = {
  wield: "Wield which weapon?", wear: "Wear/put on which item?",
  quaff: "Quaff which potion?", read: "Read which scroll?",
  eat: "Eat what?", drop: "Drop which item?", zap: "Zap which wand?",
  throw: "Throw which item?", forge: "Forge which piece of gear into an NFT relic?",
  takeoff: "Take off which worn piece?", apply: "Apply which tool?",
  quiver: "Ready which item in your quiver?",
  name: "Name which item?", offhand: "Wield which weapon in your off-hand?",
  dip: "Dip which item into the water?",
  charge: "Charge which wand or tool?",
  grease: "Grease which piece of gear?",
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
  floorKey = "dungeon:1"; // which floor this actor stands on (co-op: players can be on different floors)

  constructor(protected game: Game) {
    this.floorKey = game.activeFloorKey; // an actor is born on whatever floor is live (no stale dungeon:1 for mid-play spawns)
  }

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
  ident!: Idents;     // this adventurer's own identification knowledge (shared world appearances)
  weapon: Item | null = null;
  wornArmor: Item[] = []; // up to one piece per slot
  ring: Item | null = null;
  amulet: Item | null = null; // worn around the neck (life-saving / reflection)
  engulfedBy: Monster | null = null; // swallowed by a trapper — must struggle/cut free before moving
  stealth = false;     // ring of privacy — monsters can't track you
  regenFast = false;   // ring of regeneration
  freeAction = false;  // ring of free action — immune to paralysis
  sustainAbility = false; // ring of sustain ability — attributes can't be drained
  slowDigest = false;  // ring of slow digestion — hunger ticks half as fast
  digestPhase = 0;     // toggles each turn so slow digestion skips deterministically (co-op safe)
  ringAcc = 0;         // ring of increase accuracy — to-hit bonus (cursed: penalty)
  ringDmg = 0;         // ring of increase damage — melee damage bonus (cursed: penalty)
  ringPoisonRes = false; // ring of poison resistance — immune to poison while worn
  warning = false;     // ring of warning — sense nearby foes through walls
  autoSearch = false;  // ring of searching — passively reveals adjacent hidden traps & doors
  poison = 0;          // turns of damage-over-time remaining
  confused = 0;        // turns of staggering movement remaining
  stoning = 0;         // turns until you freeze solid (petrification) — cure fast
  illness = 0;         // turns until food poisoning kills you — cure fast
  blind = 0;           // turns of blindness — FOV shrinks to your fingertips
  paralyzed = 0;       // turns frozen by a gaze (floating eye) — you auto-pass, helpless
  webbed = 0;          // turns caught in a honeypot web — struggle (STR) to tear free before you can move
  silenced = 0;        // turns of magical silence — can't cast extrinsics; in co-op, can't be heard (no chat)
  statDrain: Record<string, number> = {}; // attribute points drained by a mind flayer — restored by prayer
  intrinsics = new Set<string>(); // poisonResist, petrifyResist, fast (from eating corpses)
  skillXp: Record<string, number> = {};   // landed hits per weapon-skill class (#enhance)
  skillRank: Record<string, number> = {};  // 0 Unskilled · 1 Basic · 2 Skilled · 3 Expert
  offhand: Item | null = null;             // a second weapon for #twoweapon (X)
  riding = false;                          // mounted on the steed (#ride / M)
  private regenTimer = 0;
  hasJam = false;
  gold = 0;            // in-game coin — buys standard wares (NFT gear still needs the wallet)
  maxDepthReached = 1;
  weaponBonus = 0; // from scrolls of enchantment
  prayerCooldown = 0;
  // Phase 6 — character sheet
  str = 12; dex = 12; con = 12; int = 12; wis = 12; cha = 12;
  level = 1; xp = 0;
  archetype = "validator";
  race = "substrate";
  luck = 0; // Fortune (−13..+13) from altar offerings — sways every roll
  ethos = "Balance"; // Order / Balance / Chaos
  favor = 0; crowned = false; title = ""; // standing with your Architect; crowning
  conducts = new Set<string>(["pacifist", "illiterate", "atheist", "vegetarian", "bankless"]); // vows kept until broken (Phase 13a)
  // Phase 8 — polymorph self ("fork")
  polyForm: MonsterDef | null = null;
  polyTurns = 0; savedHp = 0; savedMaxHp = 0;
  lycanthrope: MonsterDef | null = null; // infected — involuntarily transforms into this were-beast until cured
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
      case "art_cipher": this.stealth = on && !cursed; break;   // the Null Cipher — perfect privacy
      case "ring_free": this.freeAction = on && !cursed; break;
      case "ring_sustain": this.sustainAbility = on && !cursed; break;
      case "ring_digest": this.slowDigest = on && !cursed; break;
      case "ring_acc": this.ringAcc = on ? (cursed ? -2 : 2) : 0; break;     // cursed accuracy fights you
      case "ring_dmg": this.ringDmg = on ? (cursed ? -2 : 2) : 0; break;     // cursed damage saps your blows
      case "ring_poison": this.ringPoisonRes = on && !cursed; break;
      case "ring_warn": this.warning = on && !cursed; break;
      case "ring_search": this.autoSearch = on && !cursed; break;
    }
  }
  private pending: Verb | null = null;
  private pendingDir: Item | null = null; // a wand awaiting a zap direction
  private pendingThrow: Item | null = null; // an item awaiting a throw direction
  quiver: Item | null = null;               // readied missile for the `f`ire command
  private pendingApply: Item | null = null; // a tool awaiting a direction (excavator / state reader)
  private pendingWrite: Item | null = null; // a contract deployer awaiting a scroll choice
  private pendingWish: Item | null = null;  // a wand of wishing awaiting a wish choice
  private pendingLoot: { vault: Item; mode: "menu" | "in" | "out" } | null = null; // a multisig vault being looted
  private pendingSpell = false;             // choosing a spell to cast
  private pendingCastDir: string | null = null; // a directional spell awaiting a direction
  private pendingChat = false;              // choosing a direction to chat
  private pendingLook = false;              // farlook (;) — choosing a direction to examine
  private pendingWhatIs = false;            // what-is (/) — awaiting a glyph to identify
  private pendingOpen = false;              // open (o) — choosing a direction (door / locked = force)
  private pendingClose = false;             // close (C) — choosing a door direction
  private pendingKick = false;              // kick (K) — choosing a direction
  private pendingJump = false;              // #jump (J) — choosing a direction
  private pendingMonster = false;           // #monster (G) — choosing a direction to breathe
  private pendingName: Item | null = null;  // name (N) — the item being labelled
  private pendingCharge: Item | null = null; // charging scroll (read) — remembers its BUC for the target choice
  private pendingGrease: Item | null = null; // a can of grease awaiting the gear piece to lubricate
  private nameBuf = "";                     // accumulating typed text for #name
  signalledThisTurn = false;                // co-op chat rate limit: one message per your own turn (reset in endTurn)
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
    if (this.riding && !(this.game.pet?.alive)) this.riding = false; // steed lost — you're afoot again
    const ride = this.riding ? 30 : 0;           // a nominator steed quickens your stride
    if (this.polyForm) return Math.max(20, this.polyForm.speed ?? 100) + haste + ride; // move as your fork
    const base = this.intrinsics.has("fast") ? 130 : 100; // intrinsic speed from a fork-daemon corpse
    return base + haste + ride;
  }

  act(): Promise<void> {
    this.game.setActive(this.floorKey); // this player's floor is the live context for its turn
    this.game.draw(); // start of the player's turn = monsters have moved
    // Frozen by a gaze — auto-pass the turn (no input; resolves identically on both lockstep clients).
    if (this.paralyzed > 0) {
      if (--this.paralyzed === 0) this.game.log.add(`${this.name === "you" ? "You can move again" : this.name + " can move again"}.`, "good");
      return new Promise((resolve) => { this.resolveTurn = resolve; this.endTurn(); });
    }
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

  /** Snapshot of queued-but-unexecuted actions (for the queue indicator). */
  queuedKeys(): string[] { return this.inputQueue.filter((k) => k.charCodeAt(0) !== 1); } // hide internal sound markers
  /** LIFO undo — drop the most recently queued real action (skipping internal sound markers). */
  popInput(): boolean {
    for (let i = this.inputQueue.length - 1; i >= 0; i--) {
      if (this.inputQueue[i].charCodeAt(0) !== 1) { this.inputQueue.splice(i, 1); return true; }
    }
    return false;
  }

  private drainQueue(): void {
    this.game.setActive(this.floorKey); // process this player's input against its own floor
    while (this.awaiting && this.inputQueue.length) {
      const key = this.inputQueue.shift()!;
      this.game.onLocalConsume(this, key); // co-op: broadcast my own actions to the peer as they execute
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
    this.signalledThisTurn = false; // a fresh turn restores your voice
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
    if (this.silenced > 0 && --this.silenced === 0) this.game.log.add(`${this.name === "you" ? "Your voice returns" : this.name + "'s voice returns"} — the silence lifts.`, "good");
    if (this.blind > 0 && --this.blind === 0) { this.game.log.add(`${this.name === "you" ? "Your sight returns" : this.name + "'s sight returns"}.`, "good"); this.game.recomputeFOV(); }
    // Petrification & illness are countdowns you must out-race (prayer / a cure).
    if (this.stoning > 0 && --this.stoning === 0) {
      this.game.log.add(`${this.name === "you" ? "You freeze" : this.name + " freezes"} solid — ${fp("turned to stone", "finality denied")}.`, "bad");
      this.game.killPlayer(this);
    }
    if (this.illness > 0 && --this.illness === 0) {
      this.game.log.add(`${this.name === "you" ? "You succumb" : this.name + " succumbs"} to ${fp("the sickness", "the bad block")}.`, "bad");
      this.game.killPlayer(this);
    }
    this.game.turn++;
    this.game.censorHuntTick();
    if (this.polyForm && --this.polyTurns <= 0) this.game.revertPoly(this);
    this.game.tickLycanthropy(this); // infected? a chance to involuntarily shift into the were-beast
    this.game.tickLuck(this);        // Fortune drifts toward the mean unless a HODL stone anchors it
    this.game.checkVault();          // teleported into the Treasury? summon the Council Guard escort
    this.game.checkShopBill(this);   // left the shop carrying unpaid wares? settle the bill (or be named a thief)
    if (this.autoSearch) this.game.autoSearchAround(this); // ring of searching — reveal adjacent hidden things
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
    if (this.slowDigest) { this.digestPhase ^= 1; if (this.digestPhase) return; } // cold storage: skip every other tick
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
    if (e.key.charCodeAt(0) === 1) { this.game.emitSound(this, +e.key.slice(1)); return false; } // a queued shout/noise — alert nearby foes, free action
    if (this.pendingDir) return this.resolveZapDir(e);
    if (this.pendingThrow) return this.resolveThrowDir(e);
    if (this.pendingApply) return this.resolveApplyDir(e);
    if (this.pendingWrite) return this.resolveWrite(e);
    if (this.pendingWish) return this.resolveWish(e);
    if (this.pendingLoot) return this.resolveLoot(e);
    if (this.pendingCastDir) return this.resolveCastDir(e);
    if (this.pendingChat) return this.resolveChatDir(e);
    if (this.pendingLook) return this.resolveLookDir(e);
    if (this.pendingWhatIs) { this.pendingWhatIs = false; if (e.key !== "Escape") this.game.whatIs(e.key); else this.game.log.add("Never mind.", "dim"); return false; }
    if (this.pendingOpen) return this.resolveOpenDir(e);
    if (this.pendingClose) return this.resolveCloseDir(e);
    if (this.pendingKick) return this.resolveKickDir(e);
    if (this.pendingJump) return this.resolveJumpDir(e);
    if (this.pendingMonster) return this.resolveMonsterDir(e);
    if (this.pendingName) return this.resolveName(e);
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
      case "q": {
        const here = this.game.level.tileAt(this.x, this.y);
        if (here === "faucet") return this.game.quaffFaucet(this) ? this.endTurn() : false;
        if (here === "sink") return this.game.quaffSink(this) ? this.endTurn() : false;
        return this.startSelect("quaff");
      }
      case "s": return this.game.level.tileAt(this.x, this.y) === "throne" ? (this.game.sitThrone(this) ? this.endTurn() : false) : (this.game.search(this) ? this.endTurn() : false);
      case "o": // a chest underfoot opens directly; otherwise pick a direction to open a door
        if (this.game.chestUnderfoot(this)) return this.game.openChest(this) ? this.endTurn() : false;
        this.pendingOpen = true; this.game.log.add("Open in which direction? (a move key, Esc to cancel)", "sys"); return false;
      case "C": this.pendingClose = true; this.game.log.add("Close a door in which direction? (a move key, Esc to cancel)", "sys"); return false;
      case "K": this.pendingKick = true; this.game.log.add("Kick in which direction? (a move key, Esc to cancel)", "sys"); return false;
      case "D":
        // On a faucet, dip your weapon (the lawful relic awaits). Otherwise, dip an item into held water.
        if (this.game.level.tileAt(this.x, this.y) === "faucet") return this.game.dipWeapon(this) ? this.endTurn() : false;
        if (this.inventory.items.some((it) => it.type.id === "water")) return this.startSelect("dip");
        this.game.log.add("You've no faucet here and no water to dip into.", "dim"); return false;
      case "N": return this.startSelect("name");
      case "^": this.game.identifyTrap(this); return false;
      case "X": // toggle two-weapon: off → choose an off-hand; on → sheathe it
        if (this.offhand) { this.game.setOffhand(this, null); return false; }
        return this.startSelect("offhand");
      case "M": return this.game.toggleRide(this) ? this.endTurn() : false;
      case "I": return this.game.invoke(this) ? this.endTurn() : false; // #invoke the ritual
      case "A": this.game.showAudit(); return false; // #audit — enlightenment dump (free)
      case "V": this.game.showOverview(); return false; // #overview — visited floors + their features (free)
      case "J": this.pendingJump = true; this.game.log.add("Jump in which direction? (a move key, Esc to cancel)", "sys"); return false;
      case "U": return this.game.turnUndead(this) ? this.endTurn() : false; // #turn undead
      case "&": return this.game.wipeFace(this) ? this.endTurn() : false;   // #wipe your face
      case "G": this.pendingMonster = true; this.game.log.add("Loose your breath in which direction? (a move key, Esc to cancel)", "sys"); return false; // #monster
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
      case "x": this.game.enhanceSkills(this); return false; // #enhance — a free review/advance
      case "\\": this.game.showDiscoveries(); return false;   // discoveries screen
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
    const chargeScroll = this.pendingCharge; this.pendingCharge = null; // consume the remembered charging scroll this resolution
    if (e.key === "Escape") { this.pendingGrease = null; this.game.log.add("Never mind.", "dim"); return false; }
    const item = /^[a-z]$/.test(e.key) ? this.inventory.byLetter(e.key) : undefined;
    if (!item) { this.game.log.add("No such item.", "dim"); return false; }
    if (verb === "charge") return this.game.chargeItem(chargeScroll?.buc ?? "uncursed", item) ? this.endTurn() : false;
    if (verb === "grease") { const can = this.pendingGrease; this.pendingGrease = null; return can && this.game.greaseItem(can, item) ? this.endTurn() : false; }
    if (verb === "zap") {
      if (item.type.kind !== "wand") { this.game.log.add("That is not a wand.", "dim"); return false; }
      if (item.type.id === "wand_wish") { // the wand of wishing prompts a wish instead of a direction
        if (!item.charges || item.charges <= 0) { this.game.log.add("The wand is spent.", "dim"); return false; }
        this.pendingWish = item; this.game.promptWish(); return false;
      }
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
    if (verb === "name") {
      this.pendingName = item;
      this.nameBuf = item.label ?? "";
      this.game.log.add(`Call ${this.game.ident.name(item.type)}: ${this.nameBuf}_  (type a name, Enter to set, Esc to cancel)`, "sys");
      return false;
    }
    if (verb === "dip") return this.game.dipInWater(this, item) ? this.endTurn() : false;
    if (verb === "offhand") {
      if (item.type.kind !== "weapon") { this.game.log.add("Only a weapon can go in your off-hand.", "dim"); return false; }
      if (item === this.weapon) { this.game.log.add("That's your main weapon already.", "dim"); return false; }
      if (this.isWelded(item)) { item.bucKnown = true; this.game.log.add("It's cursed — it won't sit in the off-hand.", "bad"); return false; }
      return this.game.setOffhand(this, item) ? this.endTurn() : false;
    }
    if (verb === "apply") {
      if (item.type.kind !== "tool") { this.game.log.add("That isn't a tool you can apply.", "dim"); return false; }
      const id = item.type.id;
      if (id === "horn") return this.game.applyHorn(this) ? this.endTurn() : false;
      if (id === "trickbag") return this.game.applyTrickbag(this, item) ? this.endTurn() : false;
      if (id === "pickaxe" || id === "scope" || id === "mirror" || id === "camera" || id === "lockpick") {
        this.pendingApply = item;
        const verb = id === "pickaxe" ? "Dig" : id === "scope" ? "Probe" : id === "mirror" ? "Hold up the mirror" : id === "camera" ? "Aim the camera" : "Pick a lock";
        this.game.log.add(`${verb} in which direction? (a move key, Esc to cancel)`, "sys");
        return false;
      }
      if (id === "marker") {
        this.pendingWrite = item;
        this.game.promptWrite();
        return false;
      }
      if (id === "vault") {
        this.pendingLoot = { vault: item, mode: "menu" };
        this.game.lootMenu(item);
        return false;
      }
      if (id === "touchstone") return this.game.appraiseGems(this) ? this.endTurn() : false;
      if (id === "crystal") return this.game.applyCrystalBall(this, item) ? this.endTurn() : false;
      if (id === "tinkit") return this.game.applyTinningKit(this, item) ? this.endTurn() : false;
      if (id === "whistle") return this.game.applyWhistle(this) ? this.endTurn() : false;
      if (id === "leash") return this.game.applyLeash() ? this.endTurn() : false;
      if (id === "grease") {
        if ((item.charges ?? 0) <= 0) { this.game.log.add("The can of lubricant is empty.", "dim"); return false; }
        this.pendingGrease = item; this.pending = "grease";
        this.game.log.add(`${VERB_PROMPT.grease} (a-${this.inventory.letter(this.inventory.items.length - 1)}, Esc to cancel)`, "sys");
        this.game.showInventory();
        return false;
      }
      if (id === "lamp") {
        item.lit = !item.lit;
        this.game.log.add(item.lit ? "You light the block explorer — its glow pushes back the dark." : "You douse the block explorer.", item.lit ? "good" : "dim");
        this.game.recomputeFOV(); this.game.draw();
        return this.endTurn();
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

  private resolveWish(e: KeyboardEvent): boolean {
    const wand = this.pendingWish!;
    this.pendingWish = null;
    if (e.key === "Escape") { this.game.log.add("You forgo the wish.", "dim"); return false; }
    const n = parseInt(e.key, 10);
    if (isNaN(n)) { this.game.log.add("Choose a number from the menu.", "dim"); return false; }
    return this.game.grantWish(wand, n - 1) ? this.endTurn() : false;
  }

  private resolveLoot(e: KeyboardEvent): boolean {
    const st = this.pendingLoot!;
    if (e.key === "Escape") { this.pendingLoot = null; this.game.log.add("You close the vault.", "dim"); return false; }
    if (st.mode === "menu") {
      if (e.key === "i") { st.mode = "in"; this.game.lootStashPrompt(st.vault); return false; }
      if (e.key === "o") { st.mode = "out"; this.game.lootTakePrompt(st.vault); return false; }
      this.game.log.add("Press i to stash, o to withdraw, or Esc.", "dim"); return false;
    }
    this.pendingLoot = null;
    if (st.mode === "in") {
      const item = /^[a-z]$/.test(e.key) ? this.inventory.byLetter(e.key) : undefined;
      if (!item) { this.game.log.add("No such item.", "dim"); return false; }
      return this.game.lootStash(st.vault, item) ? this.endTurn() : false;
    }
    const n = parseInt(e.key, 10);
    if (isNaN(n)) { this.game.log.add("Choose a number from the menu.", "dim"); return false; }
    return this.game.lootTake(st.vault, n - 1) ? this.endTurn() : false;
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

  private resolveOpenDir(e: KeyboardEvent): boolean {
    this.pendingOpen = false;
    if (e.key === "Escape") { this.game.log.add("Never mind.", "dim"); return false; }
    const mv = MOVES[e.key];
    if (!mv) { this.game.log.add("That is not a direction.", "dim"); return false; }
    return this.game.openDir(this, mv[0], mv[1]) ? this.endTurn() : false;
  }

  private resolveCloseDir(e: KeyboardEvent): boolean {
    this.pendingClose = false;
    if (e.key === "Escape") { this.game.log.add("Never mind.", "dim"); return false; }
    const mv = MOVES[e.key];
    if (!mv) { this.game.log.add("That is not a direction.", "dim"); return false; }
    return this.game.closeDoor(this, mv[0], mv[1]) ? this.endTurn() : false;
  }

  private resolveKickDir(e: KeyboardEvent): boolean {
    this.pendingKick = false;
    if (e.key === "Escape") { this.game.log.add("Never mind.", "dim"); return false; }
    const mv = MOVES[e.key];
    if (!mv) { this.game.log.add("That is not a direction.", "dim"); return false; }
    return this.game.kick(this, mv[0], mv[1]) ? this.endTurn() : false;
  }

  private resolveJumpDir(e: KeyboardEvent): boolean {
    this.pendingJump = false;
    if (e.key === "Escape") { this.game.log.add("Never mind.", "dim"); return false; }
    const mv = MOVES[e.key];
    if (!mv) { this.game.log.add("That is not a direction.", "dim"); return false; }
    return this.game.jump(this, mv[0], mv[1]) ? this.endTurn() : false;
  }

  private resolveMonsterDir(e: KeyboardEvent): boolean {
    this.pendingMonster = false;
    if (e.key === "Escape") { this.game.log.add("Never mind.", "dim"); return false; }
    const mv = MOVES[e.key];
    if (!mv) { this.game.log.add("That is not a direction.", "dim"); return false; }
    return this.game.monsterAbility(this, mv[0], mv[1]) ? this.endTurn() : false;
  }

  private resolveName(e: KeyboardEvent): boolean {
    const item = this.pendingName!;
    if (e.key === "Escape") { this.pendingName = null; this.game.log.add("Never mind.", "dim"); return false; }
    if (e.key === "Enter") {
      this.pendingName = null;
      const name = this.nameBuf.trim();
      item.label = name || undefined;
      this.game.log.add(name ? `You name it "${name}".` : "You clear its name.", "dim");
      return false;
    }
    if (e.key === "Backspace") this.nameBuf = this.nameBuf.slice(0, -1);
    else if (e.key.length === 1 && this.nameBuf.length < 24) this.nameBuf += e.key;
    else return false;
    this.game.log.add(`Call ${this.game.ident.name(item.type)}: ${this.nameBuf}_`, "sys");
    return false;
  }

  /** Open the signal composer — a free action (one per turn) to call out to the co-op partner. */
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
        if (t.kind === "amulet" && t.id !== "jam") {
          if (item === this.amulet) { this.game.log.add("That amulet is already around your neck.", "dim"); return false; }
          if (this.amulet && this.amulet.buc === "cursed") {
            this.amulet.bucKnown = true;
            this.game.log.add(`You can't remove ${ident.name(this.amulet.type)} — it's cursed, clasped to your neck!`, "bad");
            return this.endTurn();
          }
          this.amulet = item;
          this.game.log.add(`You hang ${ident.name(t)} around your neck.`, "good");
          if (item.buc === "cursed") { item.bucKnown = true; this.game.log.add(`The ${t.name} clasps shut around your neck. It's cursed!`, "bad"); }
          return this.endTurn();
        }
        this.game.log.add("You can't wear that.", "dim"); return false;
      case "eat":
        if (t.kind !== "food") { this.game.log.add("That isn't food.", "dim"); return false; }
        if (t.id === "tin") return this.game.eatTin(this, item) ? this.endTurn() : false;
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
        this.game.breakConduct(this, "illiterate"); // reading a scroll ends Illiterate
        ident.learn(t); this.game.log.add(`You read ${t.name}.`);
        this.inventory.remove(item); this.unequip(item);
        // A scroll of charging needs a target — pick a wand or a charged tool to top up (the scroll is already spent).
        if (t.effect === "charge") {
          if (!this.inventory.items.some((it) => this.game.canCharge(it))) { this.game.log.add("Its magic finds nothing to charge, and dissipates.", "dim"); return this.endTurn(); }
          this.pendingCharge = item; this.pending = "charge";
          this.game.log.add(`${VERB_PROMPT.charge} (a-${this.inventory.letter(this.inventory.items.length - 1)}, Esc to cancel)`, "sys");
          this.game.showInventory();
          return false;
        }
        this.game.applyEffect(t.effect!, item.buc); return this.endTurn();
      case "drop":
        if (t.id === "hodlstone" && item.buc === "cursed") { item.bucKnown = true; this.game.log.add(`The ${t.name} won't leave your pack — a cursed loadstone!`, "bad"); return this.endTurn(); }
        if (this.isWelded(item)) { item.bucKnown = true; this.game.log.add(`You can't let go of ${ident.name(t)} — it's cursed!`, "bad"); return this.endTurn(); }
        this.inventory.remove(item); this.unequip(item);
        this.game.dropItem(item); this.game.log.add(`You drop ${ident.name(t)}.`); return this.endTurn();
      case "takeoff":
        if (!this.wornArmor.includes(item) && item !== this.ring && item !== this.amulet) { this.game.log.add("You aren't wearing that.", "dim"); return false; }
        if (item.buc === "cursed") { item.bucKnown = true; this.game.log.add(`Your ${ident.name(t)} is welded on — it's cursed. Uncurse it first.`, "bad"); return this.endTurn(); }
        this.unequip(item);
        this.game.log.add(`You take off ${ident.name(t)}.`); return this.endTurn();
      case "forge":
        void this.game.forge(item); return false; // a direct wallet tx — no game turn
    }
    return false;
  }

  private unequip(item: Item): void {
    if (this.weapon === item) { this.weapon = null; this.applyWeapon(); }
    if (this.offhand === item) this.offhand = null;
    if (this.quiver === item) this.quiver = null;
    if (this.wornArmor.includes(item)) { this.wornArmor = this.wornArmor.filter((a) => a !== item); this.recomputeAC(); }
    if (this.ring === item) { this.applyRing(item, false); this.ring = null; }
    if (this.amulet === item) this.amulet = null;
  }

  /** A cursed item that's currently equipped is welded — it can't be removed or dropped. */
  isWelded(item: Item): boolean {
    return item.buc === "cursed" && (item === this.weapon || this.wornArmor.includes(item) || item === this.ring || item === this.amulet);
  }

  private tryMove(dx: number, dy: number): boolean {
    // Swallowed by a trapper: you can't walk — every move is a thrash to break free (handled in game).
    if (this.engulfedBy && this.engulfedBy.alive) return this.game.struggleEngulf(this) ? this.endTurn() : false;
    if (this.engulfedBy) this.engulfedBy = null; // engulfer died between turns — freed
    // Caught in a honeypot web: every move is a heave to tear loose (STR decides), not a step.
    if (this.webbed > 0) {
      if (ROT.RNG.getUniform() < 0.35 + Math.max(0, this.str - 10) * 0.05) {
        this.webbed = 0; this.game.log.add("You tear free of the honeypot web.", "good");
      } else { this.webbed--; this.game.log.add("You struggle against the sticky honeypot web.", "bad"); }
      return this.endTurn();
    }
    if (this.confused > 0 && ROT.RNG.getUniform() < 0.6) {
      const d = ROT.RNG.getItem([[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, 1], [-1, 1], [1, -1]] as [number, number][])!;
      dx = d[0]; dy = d[1];
      this.game.log.add("You stagger drunkenly.", "dim");
    }
    const nx = this.x + dx, ny = this.y + dy;
    const foe = this.game.monsterAt(nx, ny);
    if (foe && !foe.peaceful) { this.game.attack(this, foe); return this.endTurn(); } // only hostiles get hit
    // Your co-op partner is a friendly NPC: you slip past (swap), never auto-attack. To deliberately
    // turn on them, Kick (K) into them; rays/AoE still strike anyone caught in the line of fire.
    const ally = this.game.otherPlayerAt(this, nx, ny);
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
    if (tile === "water") { this.game.log.add("Deep water — too deep to wade. Find a causeway, or jump it (XCM).", "dim"); return false; }
    if (!this.game.level.isPassable(nx, ny)) return false; // bumping a wall costs no turn
    // Push a boulder one tile if the space beyond is clear; otherwise it won't budge.
    const boulder = this.game.level.boulderAt(nx, ny);
    if (boulder) {
      const bx = nx + dx, by = ny + dy;
      if (this.game.level.tileAt(bx, by) === "pit" && !this.game.level.boulderAt(bx, by) && !this.game.monsterAt(bx, by) && !this.game.playerAt(bx, by)) {
        // shove the boulder into the chasm — it fills, the boulder is consumed, and you advance
        this.game.level.boulders = this.game.level.boulders.filter((b) => b !== boulder);
        this.game.level.tiles[by][bx] = "floor";
        this.game.recomputeFOV();
        this.game.log.add("You heave the boulder into the chasm — it fills with a grinding crunch.", "good");
      } else if (this.game.level.isPassable(bx, by) && !this.game.level.boulderAt(bx, by) && !this.game.monsterAt(bx, by) && !this.game.playerAt(bx, by)) {
        boulder.x = bx; boulder.y = by;
        this.game.log.add("You heave the boulder forward.", "dim");
      } else { this.game.log.add("The boulder won't budge — break it (a fire ray) or go around.", "dim"); return false; }
    }
    // Displace — slip past a peaceful NPC (the Marketmaker), your nominator, or your co-op partner.
    if (foe && foe.peaceful) { foe.x = this.x; foe.y = this.y; this.game.log.add(`You slip past ${foe.name}.`, "dim"); }
    if (ally) { ally.x = this.x; ally.y = this.y; this.game.log.add(`You slip past ${ally.name}.`, "dim", this); }
    const pet = this.game.pet;
    if (pet && pet.alive && pet.x === nx && pet.y === ny) { pet.x = this.x; pet.y = this.y; }
    this.x = nx; this.y = ny;
    if (this.riding && pet && pet.alive) { pet.x = this.x; pet.y = this.y; } // the steed carries you along
    this.game.recomputeFOV();
    const here = this.game.level.itemAt(this.x, this.y);
    if (here) {
      if (here.coins != null) this.game.collectGold(this, here); // gold is scooped up on contact
      else if (here.chest) this.game.log.add(`A ${here.chest.locked ? "locked " : ""}chest sits here. (o to open)`, "dim");
      else if (here.corpse) this.game.log.add(`A ${here.corpse.def.name} corpse lies here. (e to eat)`, "dim");
      else {
        const nm = this.game.ident.name(here.type);
        this.game.log.add(here.price ? `${nm} — ${here.price} gold (press p to buy).` : `You see ${nm} here. (, to pick up)`, "dim");
      }
    }
    const grave = this.game.level.graveAt(this.x, this.y);
    if (grave) this.game.log.add(`☗ ${grave.label}.`, "dim");
    this.game.noteTile(this); // Astral altars announce their alignment as you step on
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
      if (pr) { if (pr.quest) this.game.enterQuest(); else this.game.enterChain(pr.chain); return this.endTurn(); }
    }
    if (t === "branchDown") {
      if (this.game.enterBranchAt(this.x, this.y)) return this.endTurn();
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
    this.game.breakConduct(this, "atheist"); // praying ends Self-custodian
    this.game.pray();
    return this.endTurn();
  }
}

export class Monster extends Entity {
  speedMod = 1; // a wand of slowness halves this
  sleepTurns = 0; // a wand of stasis freezes it for a while
  blindTurns = 0; // a thrown potion of obfuscation blinds it — it can't chase
  frightened = 0; // scared by a mirror node (or its own reflection) — it flees while this lasts
  invisible = false; // a wand of cloaking — unseen except by ESP (sense minds / telepathy) or a ring of warning
  cancelled = false; // a wand of nullification strips its special powers
  silenced = 0;   // turns of magical silence — can't summon or fire ranged spells
  museLeft = 0;   // healing draughts it still carries (muse.c) — gulped when badly hurt
  museEscaped = false; // has used its one teleport draught to flee (muse.c)
  worn = 0;       // evasion gained from armor it has donned off the floor (muse.c — wear)
  splitsLeft = 0; // a sybil's remaining replications — bounds the swarm (children inherit one fewer)
  stolen: Item | null = null; // a thief (rug puller) carries what it snatched; drops it on death
  stoleGold = 0;              // an airdrop farmer's snatched gold — disgorged when it's slain
  heardSound: { x: number; y: number; ttl: number } | null = null; // a partner's call it's investigating
  // A shopkeeper stands peaceful until you steal; then it hunts you down.
  peaceful = false;
  isHunter = false; // THE CENSOR resurrected to chase the JAM-bearer (Phase 12d)
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
    this.name = monName(def);
    this.hp = this.maxHp = def.hp;
    this.attackDmg = def.dmg;
    // Phase 18 balance: ordinary monsters scale with depth so the lengthened d1–20 descent keeps
    // biting (the bestiary's minDepth tops out ~10, so deep floors would otherwise be trivial).
    // This also scales the XP reward, since a kill awards the foe's maxHp. Uniques, bosses,
    // keepers and priests (weight 0) keep their hand-tuned stats.
    if (def.weight > 0) {
      // Scaling caps at d30 so the NetHack-scale ~48-floor descent doesn't run away — beyond that the
      // ever-deeper bestiary pool (high-minDepth demons) carries the escalation, not raw multipliers.
      const d = Math.min(30, Math.max(1, game.player?.depth ?? 1));
      const hpF = 1 + 0.06 * (d - 1), dmgF = 1 + 0.04 * (d - 1);
      this.hp = this.maxHp = Math.max(1, Math.round(def.hp * hpF));
      this.attackDmg = [Math.max(1, Math.round(def.dmg[0] * dmgF)), Math.max(1, Math.round(def.dmg[1] * dmgF))];
    }
    if (def.mimic) {
      const look = ROT.RNG.getItem(ITEMS.filter((i) => i.kind !== "amulet"))!;
      this.disguiseCh = look.ch; this.disguiseFg = look.fg; this.disguiseType = look;
    }
    if (def.keeper || def.priest || def.seer) this.peaceful = true; // a keeper minds its stall, a priest its altar, the Oracle its springs — until provoked
    if (def.splits) this.splitsLeft = 2; // a fresh sybil can replicate at most twice
    if (def.muse) this.museLeft = 2;     // it carries a couple of healing draughts
  }

  getSpeed(): number {
    return Math.max(20, Math.round((this.def.speed ?? 100) * this.speedMod));
  }

  act(): void {
    this.game.setActive(this.floorKey); // act in this monster's floor context (co-op: floors run independently)
    if (!this.alive) return;
    if (this.heardSound && --this.heardSound.ttl <= 0) this.heardSound = null; // a heard call fades over time
    if (this.silenced > 0) this.silenced--; // magical silence wears off
    const p = this.game.nearestPlayer(this.x, this.y); // target the closer of the party
    if (!p.alive) return;

    // Frozen in stasis (a wand of stasis) — it loses the turn.
    if (this.sleepTurns > 0) { this.sleepTurns--; return; }
    // Blinded (a thrown potion of obfuscation) — it gropes about, unable to find you.
    if (this.blindTurns > 0) { this.blindTurns--; this.wanderStep(); return; }

    // A dormant honeypot just waits, wearing its loot disguise, until something touches it.
    if (this.def.mimic && !this.revealed) return;

    // A peaceful shopkeeper minds its stall — it neither chases nor attacks.
    if (this.peaceful) return;

    // A trapper that has swallowed an adventurer digests it where it stands — no chase, no to-hit.
    if (this.def.engulfs && this.game.digestEngulfed(this)) return;

    // A watcher eye just floats — it never gives chase or strikes; its danger is the gaze it
    // returns when YOU melee it (handled in attack). Zap it from afar instead.
    if (this.def.paralyzes) { this.wanderStep(); return; }

    // No adventurer shares this floor (co-op split / partner downed) — a free monster just mills
    // about. Checked AFTER the passive states so a sleeper/dormant mimic/shopkeeper still won't move.
    if (this.game.playersHere().length === 0) { this.wanderStep(); return; }

    // A laden thief (items or gold) wants only to escape — it never turns to fight.
    if (this.stolen || this.stoleGold > 0) { this.fleeStep(p); return; }

    // Scared by a mirror node (its own reflection): it turns tail until its nerve returns.
    if (this.frightened > 0) { this.frightened--; this.fleeStep(p); return; }

    // A coward turns tail once badly hurt.
    if (this.def.cowardly && this.hp < this.maxHp * 0.3) { this.fleeStep(p); return; }

    // muse.c (wear): a soldier/golem standing on a piece of armor dons it — harder to hit thereafter.
    if (this.def.wears && this.worn < 6) {
      const it = this.game.level.itemAt(this.x, this.y);
      if (it && it.type.kind === "armor" && !it.corpse && !it.chest && !it.price) {
        this.worn += Math.max(1, (it.type.ac ?? 1) + (it.enchant ?? 0));
        this.game.level.items = this.game.level.items.filter((z) => z !== it);
        this.game.log.add(`${this.name.charAt(0).toUpperCase() + this.name.slice(1)} dons ${this.game.ident.name(it.type)} — better armored now.`, "bad", p);
        return; // donning takes its turn
      }
    }

    // muse.c: a tough foe gulps a healing draught when badly hurt — a limited supply.
    if (!this.cancelled && this.def.muse && this.museLeft > 0 && this.hp < this.maxHp * 0.35 && ROT.RNG.getUniform() < 0.45) {
      this.museLeft--;
      const h = Math.round(this.maxHp * (0.3 + ROT.RNG.getUniform() * 0.25));
      this.hp = Math.min(this.maxHp, this.hp + h);
      this.game.log.add(`${this.name.charAt(0).toUpperCase() + this.name.slice(1)} gulps a draught and steadies — +${h}.`, "bad", p);
      return;
    }
    // muse.c escape: out of draughts and near death, it gulps a teleport draught and blinks across the level.
    if (!this.cancelled && this.def.muse && this.museLeft === 0 && !this.museEscaped && this.hp < this.maxHp * 0.25 && ROT.RNG.getUniform() < 0.4) {
      this.museEscaped = true;
      this.game.museTeleport(this, p);
      return;
    }

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
    // A conjurer summons reinforcements (a verbal casting — magical silence stops it).
    if (!this.cancelled && this.silenced === 0 && this.def.summons && this.game.level.isVisible(this.x, this.y) && ROT.RNG.getUniform() < 0.1 && this.game.summonNear(this)) return;
    // Breeders multiply when a mate of their kind is adjacent.
    if (!this.cancelled && this.def.breeds && ROT.RNG.getUniform() < 0.06) {
      const mate = this.game.monsters.find((o) => o !== this && o.alive && o.def === this.def && Math.max(Math.abs(o.x - this.x), Math.abs(o.y - this.y)) === 1);
      if (mate && this.game.breedNear(this)) return;
    }

    const dist = Math.max(Math.abs(this.x - p.x), Math.abs(this.y - p.y));
    // The resurrected Censor lunges for the JAM itself — a snatch-and-blink.
    if (this.isHunter && !this.cancelled && dist === 1 && p.hasJam && ROT.RNG.getUniform() < 0.18) {
      this.game.censorSteal(this, p);
      return;
    }
    // The rug pull: a thief adjacent to you snatches a pack item and blinks away.
    if (!this.cancelled && this.def.steals && dist === 1) {
      const loot = this.game.stealItem(p);
      if (loot) {
        this.stolen = loot;
        const who = this.name.charAt(0).toUpperCase() + this.name.slice(1);
        this.game.log.add(`${who} rugs you — it rips ${this.game.ident.name(loot.type)} from your pack and bolts!`, "bad", p);
        this.blinkAway(p);
        return;
      }
      // nothing to take — fall through and just attack
    }
    // Seduce: a charmer transfixes you (a lost turn) and slips away with whatever it can lift.
    if (!this.cancelled && this.def.seduces && dist === 1 && ROT.RNG.getUniform() < 0.6) {
      const who = this.name.charAt(0).toUpperCase() + this.name.slice(1);
      if (p.paralyzed === 0 && !p.freeAction) { p.paralyzed = 1; this.game.log.add(`${who} catches your eye — you stand transfixed!`, "bad", p); }
      const loot = this.game.stealItem(p);
      if (loot) { this.stolen = loot; this.game.log.add(`${who} slips ${this.game.ident.name(loot.type)} away as you swoon, and is gone.`, "bad", p); this.blinkAway(p); }
      return;
    }
    // The airdrop farmer: adjacent, it snatches a fistful of gold and blinks away.
    if (!this.cancelled && this.def.stealsGold && dist === 1 && p.gold > 0) {
      const took = this.game.stealGold(p);
      if (took > 0) {
        this.stoleGold += took;
        const who = this.name.charAt(0).toUpperCase() + this.name.slice(1);
        this.game.log.add(`${who} swipes ${took} gold and blinks away!`, "bad", p);
        this.blinkAway(p);
        return;
      }
    }
    if (dist === 1) { this.game.attack(this, p); return; }

    // If the player's nominator is at our side, swat it.
    const pet = this.game.pet;
    if (pet && pet.alive && Math.max(Math.abs(this.x - pet.x), Math.abs(this.y - pet.y)) === 1) { this.game.attack(this, pet); return; }

    // muse.c: a caster zaps a wand-borne debuff at you from range (sleep / blind / confuse) — silence stops it.
    if (!this.cancelled && this.silenced === 0 && this.def.zaps && !p.stealth && dist >= 2 && dist <= 6 &&
        this.game.level.isVisible(this.x, this.y) && this.game.hasLineOfSight(this.x, this.y, p.x, p.y) && ROT.RNG.getUniform() < 0.5) {
      this.game.monsterZap(this, p);
      return;
    }
    // mthrowu.c: a thrower hurls a physical projectile (dart/rock) from range — not magic, so silence/cancel don't stop it.
    if (this.def.throws && !p.stealth && dist >= 2 && dist <= 6 && this.game.level.isVisible(this.x, this.y) && this.game.hasLineOfSight(this.x, this.y, p.x, p.y)) {
      this.game.monsterThrow(this);
      return;
    }
    // Ranged foes (oracles) zap the player from a distance with line-of-sight — a cast, stopped by silence.
    if (!this.cancelled && this.silenced === 0 && this.def.ranged && !p.stealth && dist >= 2 && dist <= 6 && this.game.level.isVisible(this.x, this.y) && this.game.hasLineOfSight(this.x, this.y, p.x, p.y)) {
      this.game.rangedAttack(this);
      return;
    }

    // A dragon breathes a ray when you're roughly in line.
    if (!this.cancelled && this.def.breath && !p.stealth && dist >= 2 && dist <= 5 && this.game.level.isVisible(this.x, this.y) && this.game.hasLineOfSight(this.x, this.y, p.x, p.y)) {
      this.game.breathAttack(this);
      return;
    }

    // Chase only what the player can see — unless they're cloaked (ring of privacy).
    // Chase what the player can see — or what's close enough to sense you in the dark (so darkness isn't a free pass).
    if (this.def.ai === "chase" && !p.stealth && (this.game.level.isVisible(this.x, this.y) || dist <= 5) && dist <= 9) {
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

    // Investigate a partner's call it heard — head toward where the noise came from.
    if (this.heardSound) {
      if (this.x === this.heardSound.x && this.y === this.heardSound.y) this.heardSound = null; // arrived — nothing here
      else { this.stepToward(this.heardSound.x, this.heardSound.y); return; }
    }

    // Wander.
    this.wanderStep();
  }

  /** Take one Dijkstra step toward a target tile (for investigating a heard sound). */
  private stepToward(tx: number, ty: number): void {
    const dij = new ROT.Path.Dijkstra(tx, ty, (x, y) => this.game.level.isPassable(x, y), { topology: 8 });
    const path: [number, number][] = [];
    dij.compute(this.x, this.y, (x, y) => path.push([x, y]));
    path.shift(); // drop current tile
    if (path.length) {
      const [nx, ny] = path[0];
      if (!this.game.monsterAt(nx, ny) && !this.game.playerAt(nx, ny) && !this.game.level.boulderAt(nx, ny)) { this.x = nx; this.y = ny; }
    }
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
  leashed = false; // clipped to a leash — it's pulled to your side if it ever strays too far
  constructor(game: Game, x: number, y: number) {
    super(game);
    this.x = x; this.y = y;
    this.ch = "d"; this.fg = "#80d080"; this.name = fp("your hound", "your nominator");
    this.hp = this.maxHp = 14;
    this.attackDmg = [2, 4];
  }

  getSpeed(): number { return 110; } // keeps pace with you

  act(): void {
    if (!this.alive) return;
    this.game.setActive(this.floorKey); // follow on whatever floor this pet stands
    const p = this.game.player;
    if (p.riding) { this.x = p.x; this.y = p.y; return; } // ridden — it moves only with its rider

    const foe = this.game.adjacentEnemy(this.x, this.y);
    if (foe) { this.game.attack(this, foe); return; }

    let dist = Math.max(Math.abs(this.x - p.x), Math.abs(this.y - p.y));
    // Leashed: if it drifts beyond leash length, the tether yanks it back to your side.
    if (this.leashed && dist > 2 && p.floorKey === this.floorKey) {
      const spot = this.game.adjacentFree(p.x, p.y);
      if (spot) { this.x = spot.x; this.y = spot.y; dist = 1; }
    }
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
