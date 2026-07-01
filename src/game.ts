import * as ROT from "rot-js";
import { Level, Trap, TrapKind, LevelKind, FloorItem } from "./level";
import { Entity, Player, Monster, Pet } from "./entities";
import { Item } from "./inventory";
import { Log } from "./log";
import type { LogWho } from "./log";
import {
  COLORS, TILE_GLYPH, TileType, MONSTERS, MonsterDef, deaths, greetings,
  MAX_DEPTH, CENSOR, MOLOCH, MINIBOSSES, HONEYPOT, SHOPKEEPER, PRIEST, COUNCIL_GUARD, ORACLE, ORACLE_HINTS, ORACLE_RUMORS, realmName, grayPaper, ChainDef, CHAINS, BranchDef, BRANCHES, branchById, questFor,
  abilityMod, archetypeById, raceById, raceName, ATTRS, ATTR_LABEL, attrFlavor, spellById, Ethos,
  monName, questHomeland, archetypeName, ethosName, spellName, chainName, branchEnd, branchEntryFlavor,
} from "./data";
import { fp, skin, toggleFlavor } from "./flavor";
import { Idents, Appearances, ITEMS, JAM, CORPSE, CHEST, GOLD, WRITABLE_SCROLLS, pickItemType, ItemType, EffectId, itemById, isGear, Buc, rollBuc, bucDelta } from "./items";
import { connectWallet, Wallet } from "./chain/wallet";
import { walletBalancePas, buyDirect } from "./chain/bank";
import { recordRun, readRecent, RunEntry } from "./chain/ledger";
import { readGear, forgeGear, forgePrice } from "./chain/gear";
import { claimDeed, readDeed, deedConfigured } from "./chain/deed";
import { RARITY } from "./chain/config";
import type { Peer } from "./net/peer";
import { MusicEngine, MusicContext } from "./audio/music";
import type { CoopMode, Cell, NetMsg } from "./net/protocol";

const PARTNER_FG = "#5fd0d0"; // the co-op partner's @ renders teal

// Compact glyphs for the queued-action badge — movement keys → arrows, else the bare key.
const QUEUE_MOVE_GLYPH: Record<string, string> = {
  h: "←", l: "→", k: "↑", j: "↓", y: "↖", u: "↗", b: "↙", n: "↘",
  ArrowLeft: "←", ArrowRight: "→", ArrowUp: "↑", ArrowDown: "↓",
  "4": "←", "6": "→", "8": "↑", "2": "↓", "7": "↖", "9": "↗", "1": "↙", "3": "↘",
};
function keyGlyph(k: string): string { return QUEUE_MOVE_GLYPH[k] ?? (k.length === 1 ? k : "•"); }

// Gold prices for standard (non-NFT) shop wares, by item kind. NFT gear is priced separately, in PAS.
const PRICE_GOLD: Record<string, number> = { weapon: 60, armor: 55, potion: 35, scroll: 35, food: 8, ring: 90, wand: 80, tool: 50, spellbook: 70, amulet: 120 };
const STARTING_GOLD = 25;     // a small purse so the first shop isn't out of reach
// What a wand of wishing can grant — a curated menu of wish-worthy items (each blessed; gear enchanted).
const WISHES: { id: string; enchant?: number }[] = [
  { id: "plate", enchant: 3 }, { id: "sword", enchant: 3 }, { id: "amulet_life" }, { id: "amulet_reflect" },
  { id: "ring_free" }, { id: "vault" }, { id: "wand_death" }, { id: "wand_cold" },
];
const RELIC_IMPORT_CAP = 3;   // up to this many owned NFT relics carried into a run

const W = 80;
const MAP_H = 30;
const H = MAP_H + 2; // + a blank row + the status line
const MEMPOOL_DEPTH = 13; // the Big Room special level — "the Mempool"
const GEHENNOM_BOTTOM = 48; // after the Invocation the dungeon opens to here — Moloch + the JAM (Gehennom spans MAX_DEPTH+1 .. here)
const PLANES = [ // the ascent above the surface — climb them with the JAM to the Genesis altar
  { name: "the Plane of Consensus", flavor: "The ground itself votes; agreement hums beneath your feet." },
  { name: "the Plane of Finality", flavor: "Nothing here can be undone — every step is irreversible." },
  { name: "the Plane of Light Clients", flavor: "Proofs drift like motes of dust; the whole sky is one header." },
  { name: "the Genesis Plane", flavor: "The first block hangs frozen above an altar of pure intent. Offer the JAM (O)." },
];
const RELIC_DEPTH: Record<number, string> = { 14: "bell", 18: "candelabrum", 22: "graybook" }; // the three Invocation relics, spread across the back half of the relay descent (all before MAX_DEPTH)
// Per-Plane layouts for the ascent (Phase 17): each Plane reads as its own place, the Genesis a ringed sanctum.
const PLANE_KINDS: LevelKind[] = ["bigroom", "cave", "labyrinth", "concentric"];
// Conducts (Phase 13a) — self-imposed vows, kept until an action breaks them.
const CONDUCTS: { id: string; label: string; note: string }[] = [
  { id: "pacifist",   label: "Pacifist",       note: "shed no blood by your own hand" },
  { id: "illiterate", label: "Illiterate",     note: "read no scroll, studied no runtime, engraved no word" },
  { id: "atheist",    label: "Self-custodian", note: "knelt to no altar, sat no throne, made no offering" },
  { id: "vegetarian", label: "Vegetarian",     note: "ate no corpse" },
  { id: "bankless",   label: "Bankless",       note: "bought nothing, forged nothing — touched no market" },
];
const VAULT_CAP = 12; // a multisig vault holds up to this many stashed items
// Hand-built Consensus Vault (Sokoban) floors. A 1-wide tunnel of alternating boulders (O) and
// chasms (_): you can only push forward, so each boulder fills the next pit — unbrickable by design.
// `<` start/exit · `>` goal (the prize) · `#` wall · `.` floor · `O` boulder · `_` pit.
const SOKOBAN_FLOORS: string[][] = [
  [
    "###################",
    "#<.O._.O._.O._...>#",
    "###################",
  ],
];
const SKILL_RANKS = ["Unskilled", "Basic", "Skilled", "Expert"]; // weapon-skill ranks (#enhance)
const SKILL_NEED = [0, 20, 60, 140]; // landed hits to reach each rank
const SKILL_LABEL: Record<string, string> = { blade: "blades", blunt: "bludgeons", martial: "martial arts" };

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

// ═══════════════════════════════════════════════════════════════════════════
// DEBUG / GOD MODE — developer testing only. To remove for release: set DEBUG
// to false (disables all of it), or delete this flag + every block fenced with
// a "DEBUG" comment (onKey hook, the debug methods, the downPlayer guard).
// ═══════════════════════════════════════════════════════════════════════════
const DEBUG = true;

export class Game {
  readonly display: ROT.Display;
  readonly log: Log;
  level!: Level;
  player!: Player;
  appearances!: Appearances;        // the world's shared potion/scroll looks
  /** Identification is per-character: this resolves to whichever player is currently acting. */
  get ident(): Idents { return this.acting.ident; }
  monsters: Monster[] = [];
  pet: Pet | null = null;
  // Phase 15 — persistence: each visited level is generated once and stored, so revisiting
  // returns the *same* layout with its dropped items, bones, traps, and monsters' state.
  // Keyed by branch+depth ("dungeon:7", "kusama:1", "quest"). Planes are excluded — the ascent
  // only ever climbs up, so a plane is never revisited.
  private slots = new Map<string, { level: Level; monsters: Monster[] }>();
  private activeKey = "dungeon:1"; // the key of the level currently in this.level
  /** The floor key whose level+monsters are currently live in `this.level` — newly spawned actors stand here. */
  get activeFloorKey(): string { return this.activeKey; }
  private currentChain: ChainDef | null = null; // null = the main relay-chain dungeon; a BranchDef when in a sub-dungeon (the Mines)
  private branchFloor = 0;        // 1-based floor within the current branch (0 = not in a branch)
  private defeatedBosses = new Set<number>();    // relay depths whose mini-boss is slain
  private gehennomOpen = false;                  // the Invocation has been performed — the Dark Forest lies below
  private plane = 0;                              // 0 = the dungeon; 1..PLANES.length = the ascent above the surface
  private genesisAltars: { x: number; y: number; ethos: Ethos }[] = []; // the three Astral altars — only your aligned one ascends
  private jamStolen = false;                     // THE CENSOR has snatched the JAM — slay the hunter to reclaim it
  private vaultGuard: Monster | null = null;     // the Council Guard, while it tends the Treasury vault escort
  private censorTimer = 0;                        // turns until the next resurrection rises
  private inQuest = false;                        // currently in your archetype's Quest homeland
  private questDone = false;                      // your nemesis is slain and the artifact claimed
  private loadedRelics = new Set<number>();      // NFT relic tokenIds already pulled into this run's pack
  wallet: Wallet | null = null;
  readonly music = new MusicEngine(); // procedural area soundtracks + danger tension layer
  onWallet?: (address: string, pas: number) => void;
  recentRuns: RunEntry[] = []; // leaderboard cache + bones pool
  private scheduler = new ROT.Scheduler.Speed<Entity>(); // fast/slow actors act more/less often
  private engine!: ROT.Engine;
  private over = false;
  private busy = false; // a wallet transaction is in flight — input is frozen
  private debugPending = false; // DEBUG: a backtick was pressed; the next key is a debug command
  private godMode = false;      // DEBUG: negate player death
  private konami: string[] = []; // recent keys, watched for the Konami code (flavor toggle)

  // ── co-op (host-authoritative over WebRTC) ──
  acting!: Player;              // the player whose input is currently being processed
  coPlayer: Player | null = null; // host-side: the guest's avatar (null in solo)
  netRole: "solo" | "host" | "guest" = "solo";
  coopMode: CoopMode = "coop-ff";
  private coop = false;        // this game session has two players
  private peer: Peer | null = null;
  private downed = new Set<Player>(); // players who have fallen this run
  archetypeId = "validator";   // the local player's chosen archetype (applied on newGame)
  raceId = "substrate";        // the local player's chosen ecosystem/race (stat tweak + intrinsic)
  turn = 0;                    // global turn clock (drives corpse rot)

  private screen!: HTMLElement;                 // the map's container — overlays (chat banner, queue badge) attach here
  private chatBannerEl: HTMLElement | null = null;
  private chatBannerTimer: number | null = null;
  private queueEl: HTMLElement | null = null;   // the local player's queued-action badge

  constructor(screen: HTMLElement, logEl: HTMLElement) {
    this.screen = screen;
    this.screen.style.position = this.screen.style.position || "relative"; // positioning context for overlays
    this.display = new ROT.Display({
      width: W, height: H, fontSize: 18,
      fontFamily: '"Courier New", monospace', fg: COLORS.floor, bg: COLORS.bg,
    });
    screen.appendChild(this.display.getContainer()!);
    this.log = new Log(logEl);
    window.addEventListener("keydown", (e) => this.onKey(e));
    this.newGame();
    if (DEBUG) this.installMobileDebug(); // ── DEBUG (remove for release) ──
  }

  // ── lifecycle ──────────────────────────────────────────────────────────────
  /** Start a run. In co-op both peers pass the SAME seed so they generate an identical
   *  shared world deterministically (lockstep); omitted = a fresh random run (solo). */
  newGame(seed?: number): void {
    if (seed !== undefined) ROT.RNG.setSeed(seed); // shared seed → identical dungeon, loot, appearances on both clients
    this.over = false;
    this.defeatedBosses.clear();
    this.gehennomOpen = false;
    this.plane = 0;
    this.jamStolen = false;
    this.censorTimer = 0;
    this.inQuest = false;
    this.questDone = false;
    this.loadedRelics.clear();
    this.downed.clear();
    this.turn = 0;
    this.currentChain = null;
    this.branchFloor = 0;
    this.slots.clear();
    this.activeKey = "dungeon:1";
    this.appearances = new Appearances();
    this.level = new Level(W, MAP_H);
    this.player = new Player(this, this.level.start.x, this.level.start.y);
    this.player.ident = new Idents(this.appearances);
    this.acting = this.player;
    this.giveStartingKit(this.player);
    this.applyArchetype(this.player, this.archetypeId);
    this.applyRace(this.player, this.raceId);
    if (this.coop) {
      // Two adventurers descend together; perspective-neutral names for the shared log.
      this.player.name = "Host";
      const spot = this.adjacentFree(this.level.start.x, this.level.start.y) ?? this.level.start;
      this.coPlayer = new Player(this, spot.x, spot.y);
      this.coPlayer.name = "Guest";
      this.coPlayer.ident = new Idents(this.appearances); // shared world looks, separate knowledge
      this.giveStartingKit(this.coPlayer);
      this.applyArchetype(this.coPlayer, "nominator"); // the partner runs as a Nominator in co-op v1
      this.applyRace(this.coPlayer, "substrate");
      this.pet = null; // no nominators in co-op v1
    } else {
      this.coPlayer = null;
      this.pet = new Pet(this, this.level.start.x, this.level.start.y);
    }
    this.enterLevel();
    this.saveActive(); // register depth 1 in the level store
    this.log.add(ROT.RNG.getItem(greetings())!, "sys", "both"); // the shared intro reaches both adventurers
    for (const line of grayPaper()) this.log.add(line, "dim", "both");
    if (this.coop) this.log.add("Co-op — Host and Guest share this dungeon. Slip past each other; Kick (K) to fight; mind your line of fire. Find the JAM together.", "sys", "both");
    else this.log.add("Your nominator (d) pads at your heels — it backs you, and bites for you.", "dim");
    this.log.add(`Keys: move · , pick up · o open chest · @ sheet · p buy · F forge · P pray · O offer · q faucet · s search/sit · z zap · Z cast · t throw · a apply · E engrave${this.coop ? ' · " chat (or the box below)' : ""} · < > stairs · i/w/W/q/r/e/d items.`, "dim", "both");
    this.draw();
    this.engine = new ROT.Engine(this.scheduler);
    this.engine.start();
    void this.fetchLeaderboard();
    if (this.wallet && !this.coop) void this.loadRelics(); // carry owned NFT gear into the new run (solo only — per-wallet gear would desync a shared co-op world)
  }

  /** Pull the player's owned NFT relics into the pack — persistent, tradeable gear
   *  that survives permadeath and rides into every descent. */
  private async loadRelics(): Promise<void> {
    if (!this.wallet) return;
    const owned = await readGear(this.wallet.address);
    let added = 0;
    for (const g of owned) {
      if (added >= RELIC_IMPORT_CAP) break; // only a limited kit may ride into a run
      if (this.loadedRelics.has(g.tokenId)) continue;
      const type = itemById(g.itemId);
      if (!type || !isGear(type)) continue;
      if (this.player.inventory.full) break;
      this.giveItem(type, { enchant: g.enchant, relic: true, buc: "blessed", bucKnown: true });
      this.loadedRelics.add(g.tokenId);
      added++;
    }
    if (added > 0) {
      this.log.add(`✦ ${added} on-chain relic${added > 1 ? "s" : ""} materialise in your pack (up to ${RELIC_IMPORT_CAP} per run — yours forever, tradeable).`, "good");
      this.draw();
    }
    const deed = await readDeed(this.wallet.address);
    if (deed) this.log.add(`✦ This wallet bears a soulbound Deed of Ascension (#${deed.tokenId}, depth ${deed.depth}) — you have ascended before.`, "good");
  }

  /** Forge a held piece of gear into a tradeable NFT relic — a direct wallet tx.
   *  The contract rolls rarity on-chain (Common→Legendary), which lifts the enchant. */
  async forge(item: Item): Promise<void> {
    if (this.busy) return;
    if (this.coop) { this.log.add("Shops & forging are solo-only in co-op for now.", "dim"); return; }
    if (!this.wallet) { this.log.add("The forge lies dormant — relic-forging returns in a later update.", "dim"); return; }
    if (!isGear(item.type)) { this.log.add("Only equipment — weapons, armor, rings, wands — can be forged.", "dim"); return; }
    if (item.relic) { this.log.add(`${cap(this.ident.name(item.type))} is already an on-chain relic.`, "dim"); return; }
    const base = Math.min(item.enchant ?? 0, 3); // the forge accepts at most +3 of base enchant
    this.busy = true;
    let priceWei: bigint;
    try { priceWei = await forgePrice(base); }
    catch { this.busy = false; this.log.add("The forge is cold — couldn't read its price.", "bad"); return; }
    const pricePas = Number(priceWei) / 1e18;
    if (this.player.pas < pricePas) { this.busy = false; this.log.add(`Not enough PAS to forge — needs ${pricePas}, your wallet holds ${this.player.pas.toFixed(1)}.`, "bad"); return; }

    this.log.add(`You lay ${this.ident.name(item.type)} on the forge. Confirm ${pricePas} PAS in your wallet — the chain rolls its rarity…`, "sys"); this.draw();
    const r = await forgeGear(this.wallet.provider, item.type.id, base, priceWei, (hash) => {
      this.log.add(`Forge lit (${hash.slice(0, 10)}…). The chain decides its fate — hold fast…`, "dim"); this.draw();
    });
    if (!r.ok) { this.busy = false; this.log.add(`The forge fails — ${r.error}.`, "bad"); this.draw(); return; }

    this.breakConduct(this.player, "bankless"); // forging on-chain ends Bankless
    // The held item *becomes* the forged relic (rarity bonus baked into its enchant).
    item.relic = true; item.enchant = r.enchant ?? base; item.buc = "blessed"; item.bucKnown = true;
    if (item === this.player.weapon) this.player.applyWeapon();
    else if (this.player.wornArmor.includes(item)) this.player.recomputeAC();
    const tier = RARITY[r.rarity ?? 0] ?? "common";
    this.log.add(`✦ You forge a ${tier.toUpperCase()} ${this.ident.name(item.type)} +${item.enchant} — minted as a tradeable NFT you own. It returns in future runs.`, (r.rarity ?? 0) >= 2 ? "good" : "sys");
    // Re-sync owned token ids so loadRelics won't double-add this run.
    for (const g of await readGear(this.wallet.address)) this.loadedRelics.add(g.tokenId);
    this.player.pas = await walletBalancePas(this.wallet.address);
    this.onWallet?.(this.wallet.address, this.player.pas);
    this.busy = false;
    this.draw();
  }

  private async fetchLeaderboard(): Promise<void> {
    try { this.recentRuns = await readRecent(12); } catch { /* offline is fine */ }
  }

  private giveStartingKit(who: Player): void {
    who.gold = STARTING_GOLD;
    const dagger = ITEMS.find((i) => i.id === "dagger")!;
    const ration = ITEMS.find((i) => i.id === "ration")!;
    const wielded = who.inventory.add(dagger);
    wielded.buc = "uncursed"; wielded.bucKnown = true;
    who.weapon = wielded;
    who.attackDmg = dagger.dmg!;
    const r = who.inventory.add(ration); r.buc = "uncursed"; r.bucKnown = true;
  }

  /** Set a player's attributes, HP, and archetype starting gear. */
  private applyArchetype(p: Player, id: string): void {
    const a = archetypeById(id);
    p.archetype = a.id;
    p.str = a.stats.str; p.dex = a.stats.dex; p.con = a.stats.con;
    p.int = a.stats.int; p.wis = a.stats.wis; p.cha = a.stats.cha;
    p.maxHp = a.hp; p.hp = a.hp;
    p.level = 1; p.xp = 0;
    p.ethos = a.ethos; p.favor = 0; p.crowned = false; p.title = "";
    p.spells = new Set(a.spell ? [a.spell] : []);
    this.recomputeEnergy(p); p.energy = p.maxEnergy;
    for (const itemId of a.start) {
      const t = itemById(itemId);
      if (!t || p.inventory.full) continue;
      const it = p.inventory.add(t);
      it.buc = "uncursed"; it.bucKnown = true;
      if (t.kind === "wand") it.charges = ROT.RNG.getUniformInt(3, 6);
    }
  }

  /** Layer an ecosystem/race onto the chosen archetype: a stat tweak (clamped 3–18) + starting intrinsics. */
  private applyRace(p: Player, id: string): void {
    const r = raceById(id);
    p.race = r.id;
    for (const a of ATTRS) { const m = r.statMod[a]; if (m) p[a] = Math.max(3, Math.min(18, p[a] + m)); }
    for (const intr of r.intrinsics) p.intrinsics.add(intr);
    this.recomputeEnergy(p); p.energy = p.maxEnergy; // INT tweaks shift the energy pool
    p.maxHp = Math.max(1, p.maxHp + (r.statMod.con ?? 0)); p.hp = p.maxHp; // a hardier/frailer body
  }

  /** XP needed to reach a given epoch (level): L2=20, L3=60, L4=120, L5=200… */
  private xpForLevel(L: number): number { return 10 * L * (L - 1); }

  /** Award XP to a player and level them up ("reach an epoch"), gaining max HP. */
  /** Remove a vow from a player's kept set (silently — revealed only at the end). */
  breakConduct(p: Player, id: string): void { p.conducts.delete(id); }

  gainXp(p: Player, amount: number, fromKill = true): void {
    if (fromKill) this.breakConduct(p, "pacifist"); // a kill by your own hand ends Pacifist
    if (!p.alive || amount <= 0) return;
    p.xp += amount;
    while (p.level < 30 && p.xp >= this.xpForLevel(p.level + 1)) { // Phase 18: cap raised 20→30 so HP keeps pace over the d1–20 descent
      p.level++;
      const gain = Math.max(2, ROT.RNG.getUniformInt(3, 8) + abilityMod(p.con));
      p.maxHp += gain; p.hp += gain;
      this.recomputeEnergy(p); p.energy = p.maxEnergy;
      this.log.add(`${this.sub(p)} ${this.verbS(p, "reach")} epoch ${p.level}! Max HP ${p.maxHp}, En ${p.maxEnergy}.`, "good");
    }
  }

  /** A barrow-wight's touch saps an epoch (NetHack drain-life). Eating its corpse regains one. */
  drainLevel(p: Player, byName: string): void {
    if (!p.alive) return;
    if (p.level <= 1) { // can't slip below epoch 1 — sap raw vitality instead
      const loss = ROT.RNG.getUniformInt(2, 5);
      p.maxHp = Math.max(1, p.maxHp - loss); p.hp = Math.min(p.hp, p.maxHp);
      this.log.add(`${cap(byName)} drains your vitality — max HP down ${loss}.`, "bad", p);
      if (p.hp <= 0) this.killPlayer(p);
      return;
    }
    p.level--;
    const loss = ROT.RNG.getUniformInt(3, 8) + Math.max(0, abilityMod(p.con));
    p.maxHp = Math.max(p.level, p.maxHp - loss); p.hp = Math.min(p.hp, p.maxHp);
    p.xp = this.xpForLevel(p.level); // drop to the floor of the now-lower epoch
    this.recomputeEnergy(p); p.energy = Math.min(p.energy, p.maxEnergy);
    this.log.add(`${cap(byName)} drains an epoch — you slip to epoch ${p.level}! (max HP ${p.maxHp})`, "bad", p);
    if (p.hp <= 0) this.killPlayer(p);
  }

  /** A mind flayer saps a random attribute (min 3). Tracked so prayer can restore exactly what was lost. */
  drainStat(p: Player, byName: string): void {
    if (!p.alive) return;
    if (p.sustainAbility) { this.log.add(`${cap(byName)} reaches for your faculties — but they hold firm.`, "dim", p); return; }
    const drainable = ATTRS.filter((a) => p[a] > 3);
    if (drainable.length === 0) return;
    const a = ROT.RNG.getItem(drainable)!;
    p[a]--; p.statDrain[a] = (p.statDrain[a] ?? 0) + 1;
    if (a === "int") { this.recomputeEnergy(p); p.energy = Math.min(p.energy, p.maxEnergy); }
    this.log.add(`${cap(byName)} drains your ${attrFlavor(a)} — ${ATTR_LABEL[a]} down to ${p[a]}!`, "bad", p);
  }

  showCharSheet(): void {
    const p = this.acting;
    this.log.add(`— ${p.name === "you" ? "You" : p.name}, ${p.title ? p.title + " " : ""}${raceName(raceById(p.race))} ${archetypeName(archetypeById(p.archetype))} · ${ethosName(p.ethos)} · epoch ${p.level} —`, "sys");
    this.log.add(`  ${ATTRS.map((a) => `${ATTR_LABEL[a]} ${p[a]}`).join("  ")}`, "dim");
    this.log.add(`  HP ${p.hp}/${p.maxHp}  AC ${p.ac}  Fortune ${this.luckOf(p) >= 0 ? "+" : ""}${this.luckOf(p)}  XP ${p.xp}/${this.xpForLevel(p.level + 1)}`, "dim");
    const intr = [...p.intrinsics].map((i) => ({ poisonResist: "poison resist", petrifyResist: "petrify resist", drainResist: "drain resist", fast: "fast", telepathy: "telepathy" } as Record<string, string>)[i] ?? i);
    if (intr.length) this.log.add(`  Intrinsics: ${intr.join(", ")}.`, "good");
    if (p.spells.size) this.log.add(`  Energy ${p.energy}/${p.maxEnergy}. ${fp("Spells", "Extrinsics")}: ${[...p.spells].map((id) => { const s = spellById(id); return s ? spellName(s) : id; }).join(", ")}. (Z to cast)`, "sys");
    this.log.add(`  ${fp("Alignment", "Ethos")}: ${ethosName(p.ethos)}, favor ${p.favor}${p.crowned ? ` — ${fp("Knighted", "Technical Fellowship")} ${p.title}` : ""}.`, "dim");
    const kept = CONDUCTS.filter((c) => p.conducts.has(c.id));
    if (kept.length) this.log.add(`  Vows kept: ${kept.map((c) => c.label).join(", ")}.`, "good");
    else this.log.add("  Vows kept: none — you walk no narrow path.", "dim");
  }

  /** `#audit` (A) — a full enlightenment dump: everything the character sheet has, and more. A free read. */
  showAudit(): void {
    const p = this.acting;
    this.log.add(`— ${fp("Character record", "Audit report")}: ${p.name === "you" ? "you" : p.name}, ${p.title ? p.title + " " : ""}${raceName(raceById(p.race))} ${archetypeName(archetypeById(p.archetype))} —`, "sys");
    this.log.add(`  ${ethosName(p.ethos)} · epoch ${p.level} · XP ${p.xp}/${this.xpForLevel(p.level + 1)}${p.crowned ? ` · ${fp("Knighted", "Technical Fellowship")} ${p.title}` : ""}.`, "dim");
    this.log.add(`  ${ATTRS.map((a) => `${ATTR_LABEL[a]} ${p[a]}`).join("  ")}`, "dim");
    this.log.add(`  HP ${p.hp}/${p.maxHp}  AC ${p.ac}  En ${p.energy}/${p.maxEnergy}  Speed ${p.getSpeed()}  Fortune ${this.luckOf(p) >= 0 ? "+" : ""}${this.luckOf(p)}.`, "dim");
    // weapon skills
    const skills = Object.keys(p.skillXp);
    if (skills.length) this.log.add(`  Skills: ${skills.map((c) => `${SKILL_LABEL[c] ?? c} ${SKILL_RANKS[p.skillRank[c] ?? 0]}`).join(", ")}.`, "dim");
    // intrinsics + spells
    const intr = [...p.intrinsics].map((i) => ({ poisonResist: "poison resist", petrifyResist: "petrify resist", drainResist: "drain resist", fast: "fast", telepathy: "telepathy" } as Record<string, string>)[i] ?? i);
    if (intr.length) this.log.add(`  Intrinsics: ${intr.join(", ")}.`, "good");
    if (p.spells.size) this.log.add(`  Extrinsics: ${[...p.spells].map((id) => spellById(id)?.name ?? id).join(", ")}.`, "dim");
    // active afflictions / timeouts
    const fx: string[] = [];
    if (p.poison > 0) fx.push(`poisoned ${p.poison}`);
    if (p.confused > 0) fx.push(`confused ${p.confused}`);
    if (p.blind > 0) fx.push(`blind ${p.blind}`);
    if (p.silenced > 0) fx.push(`silenced ${p.silenced}`);
    if (p.webbed > 0) fx.push(`webbed ${p.webbed}`);
    { const dr = ATTRS.filter((a) => (p.statDrain[a] ?? 0) > 0); if (dr.length) fx.push(`drained ${dr.map((a) => ATTR_LABEL[a]).join("/")} (pray to restore)`); }
    if (p.stoning > 0) fx.push(`STONING ${p.stoning}`);
    if (p.illness > 0) fx.push(`ill ${p.illness}`);
    if (p.hasteTurns > 0) fx.push(`hasted ${p.hasteTurns}`);
    if (p.senseTurns > 0) fx.push(`mind-sense ${p.senseTurns}`);
    if (p.lycanthrope) fx.push(`lycanthropic — ${monName(p.lycanthrope).replace(/^an? /, "")} (pray to cure)`);
    if (p.polyForm) fx.push(`forked → ${p.polyForm.name.replace(/^an? /, "")} ${p.polyTurns}`);
    this.log.add(`  Status: ${fx.length ? fx.join(", ") : "clear"}.`, fx.some((s) => /STONING|ill|poison/.test(s)) ? "bad" : "dim");
    // progress + the endgame
    const relics = ["bell", "candelabrum", "graybook"].filter((id) => p.inventory.items.some((it) => it.type.id === id)).map((id) => itemById(id)!.name);
    this.log.add(`  Depth ${p.depth} (deepest ${p.maxDepthReached})${this.gehennomOpen ? " · Gehennom open" : ""}${p.hasJam ? " · BEARS THE JAM" : this.jamStolen ? " · JAM stolen" : ""}.`, "dim");
    this.log.add(`  Invocation relics held: ${relics.length ? relics.join(", ") : "none"}.`, relics.length === 3 ? "good" : "dim");
    // conducts
    const kept = CONDUCTS.filter((c) => p.conducts.has(c.id));
    this.log.add(`  Vows kept: ${kept.length ? kept.map((c) => c.label).join(", ") : "none"}.`, kept.length ? "good" : "dim");
    // on-chain wallet/PAS readout is deferred — to be reintroduced in a later update.
  }

  /** A line summarising the vows a player still holds (for the death/ascension screen). */
  private conductReport(p: Player): void {
    const kept = CONDUCTS.filter((c) => p.conducts.has(c.id));
    if (!kept.length) return;
    this.log.add("— Vows kept this run —", "sys");
    for (const c of kept) this.log.add(`  ${c.label}: ${c.note}.`, "good");
  }

  /** The active sub-dungeon branch (the Mines), or null in the main dungeon / a parachain. */
  private get branch(): BranchDef | null {
    return this.currentChain && (this.currentChain as BranchDef).branch ? (this.currentChain as BranchDef) : null;
  }

  // ── Phase 15: the level store ──────────────────────────────────────────────
  /** Branch+depth key for the level currently described by (plane/quest/branch/chain/depth) state. */
  private levelKey(): string {
    if (this.plane > 0) return `plane:${this.plane}`; // never stored (no path back down a plane)
    if (this.inQuest) return "quest";
    if (this.branch) return `${this.branch.id}:${this.branchFloor}`; // branch floors are keyed by floor, not depth
    if (this.currentChain) return `${this.currentChain.id}:${this.acting.depth}`;
    return `dungeon:${this.acting.depth}`;
  }

  /** Persist the active level + its monsters under the active key (idempotent — same refs). */
  private saveActive(): void {
    if (this.plane > 0) return; // planes aren't persisted
    this.slots.set(this.activeKey, { level: this.level, monsters: this.monsters });
  }

  /** Switch to the level for `key`. Returns true if it already exists (restore) — the caller
   *  then skips fresh generation/population. Saves the level being left first. */
  private beginLevel(key: string, kind: LevelKind): boolean {
    this.saveActive();
    this.activeKey = key;
    const slot = this.slots.get(key);
    if (slot) { this.level = slot.level; this.monsters = slot.monsters; return true; }
    this.level = new Level(W, MAP_H, kind);
    this.monsters = [];
    return false;
  }

  // ── Co-op independent floors (staged): each actor stands on its own floorKey, and
  //    setActive loads that floor's context before the actor takes its turn. While the party
  //    still shares a floor this is a no-op; it's the substrate for players splitting up. ──
  /** Make `key`'s floor the live context (level + monsters + chain/branch/plane flags), saving
   *  whatever was active. Safe no-op when that floor is already loaded. */
  setActive(key: string): void {
    if (key === this.activeKey) return;
    if (this.slots.has(this.activeKey)) this.slots.set(this.activeKey, { level: this.level, monsters: this.monsters });
    const slot = this.slots.get(key);
    if (!slot) return; // not generated yet — a transition is mid-build and owns the context
    this.activeKey = key;
    this.level = slot.level;
    this.monsters = slot.monsters;
    this.applyKeyContext(key);
  }

  /** Derive the location flags (chain / branch / plane / quest) implied by a floor key. */
  private applyKeyContext(key: string): void {
    const c = this.contextOf(key);
    this.plane = c.plane; this.currentChain = c.chain; this.inQuest = c.inQuest; this.branchFloor = c.branchFloor;
  }

  /** Pure: the location flags a floor key implies, without mutating game state (for per-player HUDs). */
  private contextOf(key: string): { plane: number; chain: ChainDef | null; inQuest: boolean; branchFloor: number } {
    if (key === "quest") return { plane: 0, chain: null, inQuest: true, branchFloor: 0 };
    const [id, numStr] = key.split(":");
    const num = Number(numStr) || 0;
    if (id === "plane") return { plane: num, chain: null, inQuest: false, branchFloor: 0 };
    if (id === "dungeon") return { plane: 0, chain: null, inQuest: false, branchFloor: 0 };
    const b = branchById(id);
    if (b) return { plane: 0, chain: b, inQuest: false, branchFloor: num };
    return { plane: 0, chain: CHAINS.find((x) => x.id === id) ?? null, inQuest: false, branchFloor: 0 };
  }

  /** Re-enter an already-generated level: re-place the party beside the arriving player and
   *  rebuild the schedule from the stored (frozen) actors. No respawn, no new loot. */
  private restoreEnter(): void {
    this.vaultGuard = null; // a fresh visit re-derives the vault escort on demand
    const lead = this.acting; // the arriving adventurer (co-op: only this one travels)
    // a monster may have frozen on the very stair we arrive at — step the player to a free neighbour
    if (this.monsterAt(lead.x, lead.y)) {
      const spot = this.adjacentFree(lead.x, lead.y);
      if (spot) { lead.x = spot.x; lead.y = spot.y; }
    }
    this.placeParty();
    this.rebuildSchedule();
  }

  /** Populate a freshly generated level, then place the party and build the schedule. */
  private enterLevel(): void {
    for (const p of this.allPlayers()) { p.engulfedBy = null; p.webbed = 0; } // a fresh floor's monsters/webs are rebuilt — nothing holds you over
    this.vaultGuard = null; // the Council Guard belongs to the floor we just left
    this.monsters = [];
    if (this.plane > 0) {
      this.setupPlane();
    } else {
      const cozy = this.level.kind !== "maze"; // Gehennom's mazes have no shops, faucets, thrones, or chests
      this.spawnMonsters();
      this.spawnItems();
      this.placeGold();
      if (cozy) {
        this.spawnShop();
        this.placeAltar();
        this.placeFeature("faucet", 0.3);
        this.placeFeature("throne", 0.16);
        this.placeFeature("sink", 0.18);
        this.placeChest(0.35);
        this.placeBoulders();
        this.placeSpecialRoom();
        this.placeVault();
      }
      this.maybePlaceBones();
      this.spawnTraps();
      this.placePortals();
      this.placeBranchEntrance();
      this.placeQuestPortal();
      this.placeMiniboss();
      this.placeMimics();
      if (!this.currentChain) {
        this.placeRelics();
        if (this.player.depth === MAX_DEPTH && !this.gehennomOpen) this.placeVibratingSquare();
        else if (this.player.depth >= GEHENNOM_BOTTOM) this.placeJamAndBoss();
      }
    }
    // Lit vs dark rooms (NetHack): the dread depths (Foot of the Relay + Gehennom + Sanctum) are wholly
    // dark; elsewhere ~half the rooms are lit. Caves/mazes have few room centers, so they read dark too.
    const litChance = this.plane > 0 ? 0.5 : this.acting.depth >= MAX_DEPTH ? 0 : 0.55;
    this.level.markLighting(litChance);
    this.placeParty();
    this.rebuildSchedule();
  }

  /** Place the pet beside the arriving (acting) player. Co-op: the partner does NOT travel — it stays put. */
  private placeParty(): void {
    const lead = this.acting;
    if (this.pet && this.pet.alive) {
      const spot = this.adjacentFree(lead.x, lead.y);
      if (spot) { this.pet.x = spot.x; this.pet.y = spot.y; }
      this.pet.floorKey = lead.floorKey; // the hound follows its owner to the new floor
    }
  }

  /** Rebuild the scheduler: both players, plus the alive monsters of every floor a player stands on. */
  private rebuildSchedule(): void {
    this.scheduler.clear();
    this.acting.floorKey = this.activeKey; // the arriving player now stands on this floor
    if (this.pet && this.pet.alive) this.pet.floorKey = this.acting.floorKey;
    this.scheduler.add(this.player, true);
    if (this.coPlayer && this.coPlayer.alive) this.scheduler.add(this.coPlayer, true);
    // every floor that currently has a living player is simulated (dedupe when both share one)
    const added = new Set<Monster>();
    for (const key of new Set(this.livingPlayers().map((p) => p.floorKey))) {
      const mons = key === this.activeKey ? this.monsters : this.slots.get(key)?.monsters;
      if (!mons) continue;
      for (const m of mons) if (m.alive && !added.has(m)) { added.add(m); this.scheduler.add(m, true); }
    }
    if (this.pet && this.pet.alive) this.scheduler.add(this.pet, true);
    this.recomputeFOV();
    if (this.acting === this.localPlayer) this.music.setArea(this.currentAreaId()); // my speakers follow my own floor
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

  // ── co-op party helpers ──────────────────────────────────────────────────────
  allPlayers(): Player[] { return this.coPlayer ? [this.player, this.coPlayer] : [this.player]; }
  /** The adventurer THIS client drives (host → Host/this.player, guest → Guest/this.coPlayer). */
  get localPlayer(): Player { return this.netRole === "guest" ? (this.coPlayer ?? this.player) : this.player; }
  /** The partner's avatar, driven by the peer's broadcast keystrokes (null when solo / disconnected). */
  get remotePlayer(): Player | null { return this.netRole === "guest" ? this.player : this.coPlayer; }
  /** Render viewer index for the local player (0 = this.player, 1 = the companion). */
  get localViewer(): 0 | 1 { return this.netRole === "guest" ? 1 : 0; }

  /** Voice ranges (Chebyshev tiles) — sound carries far past sight (FOV ≈ 8); reverberation, not
   *  distance, is the main degrader. */
  private static CHAT_RANGE = { whisper: 18, say: 40, shout: 90 } as const;
  /** The fully-legible inner radius for each volume; past it, distance starts to erode the call. */
  private static CHAT_CLEAR = { whisper: 5, say: 14, shout: 55 } as const;

  /** Send a chat message to the partner — OUT OF BAND: the displayed text never enters the lockstep
   *  turn stream and never touches the sim RNG, so it can't desync. The SOUND (which alerts enemies)
   *  is emitted separately + deterministically via emitOwnSound(). One message per your own turn. */
  submitChat(text: string, power: "whisper" | "say" | "shout" = "say"): void {
    const msg = text.trim().slice(0, 60);
    if (!msg || !this.coop || this.netRole === "solo" || this.over || !this.localPlayer.alive) return;
    if (this.localPlayer.silenced > 0) { this.showChatBanner("(silenced — you can't make a sound)", true); return; }
    if (this.localPlayer.signalledThisTurn) { this.showChatBanner("(one message per turn — make a move first)", true); return; }
    this.localPlayer.signalledThisTurn = true;
    this.showChatBanner(`You: ${msg}`, true); // banner only — chat never enters the event log
    this.peer?.send({ t: "chat", text: msg, power });
    this.emitOwnSound(power); // queue a deterministic "noise" so enemies can investigate (lockstep-safe)
  }

  /** Receive the partner's chat. Degraded HERE (recipient-side) by distance + reverberation (walls the
   *  sound must bounce around). Display-only: Math.random for the mask, our own view of both avatars —
   *  sim-neutral. If nearly everything is lost, it fades into the dungeon and nothing is shown. */
  private receiveChat(text: string, power: "whisper" | "say" | "shout"): void {
    const from = this.remotePlayer, to = this.localPlayer;
    if (!from || !to) return;
    if (from.floorKey !== to.floorKey) return; // sound doesn't carry between dungeon floors — lost
    const dist = Math.max(Math.abs(from.x - to.x), Math.abs(from.y - to.y));
    const R = Game.CHAT_RANGE[power];
    if (dist > R) return; // beyond earshot — lost to the dark
    const resume = this.activeKey; this.setActive(to.floorKey); // wallsBetween reads this.level
    const walls = this.wallsBetween(from.x, from.y, to.x, to.y);
    if (this.activeKey !== resume) this.setActive(resume);
    let keep: number;
    if (walls === 0) {
      keep = 1; // clear line of sight within range — always heard, plainly
    } else {
      // No LOS: only reverberation carries the call. A "clear core" stays legible within it; past it,
      // distance erodes it. The louder the call, the bigger the core and the better it penetrates.
      const core = Game.CHAT_CLEAR[power];
      keep = dist <= core ? 1 : Math.max(0, 1 - (dist - core) / Math.max(1, R - core));
      // Reverberation saturates — sound diffracts around a few corners rather than dying linearly per
      // wall (and the straight line overcounts walls cutting through a corner's solid block, so cap it).
      // Volume drives penetration: a shout carries around corners; a whisper barely survives one.
      const perWall = power === "shout" ? 0.93 : power === "whisper" ? 0.72 : 0.85;
      keep *= Math.pow(perWall, Math.min(walls, 4));
      keep = Math.max(0, Math.min(1, keep));
    }
    let total = 0, survived = 0;
    const degraded = [...text].map((ch) => {
      if (ch === " ") return " ";
      total++;
      if (Math.random() < keep) { survived++; return ch; }
      return ".";
    }).join("");
    if (total === 0 || survived / total < 0.12) return; // nearly all lost — fades into dungeon sounds; show nothing
    this.showChatBanner(`${power === "shout" ? "Partner!" : "Partner"}: ${degraded}`, false); // banner only — not logged
  }

  /** Count the sound-blocking cells (walls / shut doors) on the straight line between two points — a
   *  proxy for how much the call has to reverberate around obstacles. */
  private wallsBetween(x0: number, y0: number, x1: number, y1: number): number {
    let walls = 0;
    let dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let err = dx - dy, x = x0, y = y0;
    while (x !== x1 || y !== y1) {
      const e2 = 2 * err;
      if (e2 > -dy) { err -= dy; x += sx; }
      if (e2 < dx) { err += dx; y += sy; }
      if (x === x1 && y === y1) break;
      const t = this.level.tileAt(x, y);
      if (t === "wall" || t === "doorClosed" || t === "doorLocked" || t === "doorHidden") walls++;
    }
    return walls;
  }

  /** Queue a deterministic "noise" into the lockstep stream so enemies can react. The synthetic key
   *  (control-char prefix + power index) is broadcast-on-consume, so emitSound runs on the shouter's
   *  turn on BOTH clients identically. */
  private emitOwnSound(power: "whisper" | "say" | "shout"): void {
    const idx = power === "shout" ? 2 : power === "whisper" ? 0 : 1;
    this.localPlayer.feed("" + idx);
  }

  /** Apply a heard-sound alert: non-peaceful foes within earshot of the shouter turn to investigate
   *  where the noise came from. Deterministic (positions only, no RNG) — safe in lockstep. */
  emitSound(shouter: Player, powerIdx: number): void {
    const radius = powerIdx === 2 ? 30 : powerIdx === 0 ? 4 : 12; // shout wakes the floor; a whisper barely carries
    if (radius <= 0) return;
    for (const m of this.monsters) {
      if (!m.alive || m.peaceful || (m.def.mimic && !m.revealed)) continue;
      if (Math.max(Math.abs(m.x - shouter.x), Math.abs(m.y - shouter.y)) <= radius) {
        m.heardSound = { x: shouter.x, y: shouter.y, ttl: 6 + powerIdx * 2 };
      }
    }
  }

  /** Flash a chat signal as a banner over the top of the map, then fade it. Clean opacity fade in/out. */
  private showChatBanner(text: string, mine: boolean): void {
    if (!this.screen) return;
    if (!this.chatBannerEl) {
      const b = document.createElement("div");
      b.style.cssText = "position:absolute;top:8px;left:50%;transform:translateX(-50%);max-width:92%;padding:6px 14px;border-radius:8px;font:600 16px/1.35 'Courier New',monospace;text-align:center;pointer-events:none;opacity:0;transition:opacity .4s ease;z-index:20;white-space:pre-wrap;box-shadow:0 2px 10px #000a;";
      this.screen.appendChild(b);
      this.chatBannerEl = b;
    }
    const b = this.chatBannerEl;
    b.textContent = text;
    b.style.background = mine ? "#13243acc" : "#3a220fcc";
    b.style.color = mine ? "#8fd0ff" : "#ffcf8a";
    b.style.border = `1px solid ${mine ? "#3a6fa0" : "#c07a30"}`;
    b.style.opacity = "0";
    requestAnimationFrame(() => { if (this.chatBannerEl) this.chatBannerEl.style.opacity = "1"; }); // fade in
    if (this.chatBannerTimer != null) clearTimeout(this.chatBannerTimer);
    this.chatBannerTimer = window.setTimeout(() => { if (this.chatBannerEl) this.chatBannerEl.style.opacity = "0"; }, 4200); // fade out
  }

  /** Reveal/hide the co-op chat bar (the DOM input below the log). */
  private showChatBar(on: boolean): void {
    const bar = document.getElementById("chatbar");
    if (bar) (bar as HTMLElement).hidden = !on;
  }

  /** Focus the chat input (the `"` key shortcut on PC; the Send button / tapping it works on mobile). */
  private focusChat(): void {
    const inp = document.getElementById("chat-input") as HTMLInputElement | null;
    if (inp) inp.focus();
  }

  /** Live badge of the local player's queued-but-unexecuted actions (count + glyph row). ⌫ pops LIFO. */
  private renderQueue(): void {
    if (!this.screen || !this.player) return;
    if (!this.queueEl) {
      const q = document.createElement("div");
      q.style.cssText = "position:absolute;top:8px;left:8px;padding:4px 9px;border-radius:6px;font:600 14px/1.4 'Courier New',monospace;background:#0c0c10e6;color:#cfcf9a;border:1px solid #555;pointer-events:none;z-index:19;opacity:0;transition:opacity .25s ease;";
      this.screen.appendChild(q);
      this.queueEl = q;
    }
    const q = this.queueEl;
    const keys = this.localPlayer.queuedKeys();
    if (keys.length === 0) { q.style.opacity = "0"; return; }
    const glyphs = keys.map(keyGlyph).join(" ");
    q.innerHTML = `Queued ${keys.length}: <span style="color:#e0b94d">${glyphs}</span> <span style="color:#777">⌫</span>`;
    q.style.opacity = "1";
  }
  livingPlayers(): Player[] { return this.allPlayers().filter((p) => p.alive); } // global — for game-over
  /** Living players standing on the floor currently being acted (co-op: floors run independently). */
  playersHere(): Player[] { return this.livingPlayers().filter((p) => p.floorKey === this.activeKey); }
  playerAt(x: number, y: number): Player | undefined { return this.playersHere().find((p) => p.x === x && p.y === y); }
  otherPlayerAt(self: Player, x: number, y: number): Player | undefined {
    return this.playersHere().find((p) => p !== self && p.x === x && p.y === y);
  }
  /** The living party member on this floor closest (Chebyshev) to a point — whom a monster targets. */
  nearestPlayer(x: number, y: number): Player {
    const pool = this.playersHere();
    const live = pool.length ? pool : this.livingPlayers(); // fall back to any survivor (callers run on-floor)
    if (live.length === 0) return this.player;
    const d = (p: Player) => Math.max(Math.abs(p.x - x), Math.abs(p.y - y));
    return live.reduce((a, b) => (d(b) < d(a) ? b : a));
  }
  /** Separate fog per player: each sees only its own FOV, computed on its OWN floor's level. */
  /** Co-op: two adventurers never share a tile. Slipping past swaps them cleanly; but if anything else
   *  (a teleport landing on a partner, say) collides them, the HOST keeps the tile and the GUEST yields
   *  to a free neighbour — a deterministic tie-break so both clients agree on the final position. */
  resolvePlayerOverlap(): void {
    const h = this.player, g = this.coPlayer; // names are stable across clients: this.player = "Host"
    if (!g || !g.alive || !h.alive || h.floorKey !== g.floorKey || h.x !== g.x || h.y !== g.y) return;
    const spot = this.adjacentFree(g.x, g.y);
    if (spot) { g.x = spot.x; g.y = spot.y; }
  }

  recomputeFOV(): void {
    if (this.coPlayer) this.resolvePlayerOverlap();
    const fovOn = (p: Player, co: boolean) => {
      const lvl = p.floorKey === this.activeKey ? this.level : this.slots.get(p.floorKey)?.level;
      if (!lvl) return; // floor not generated yet (mid-build) — the transition will recompute
      // blind → grope adjacent (lit rooms don't help); else a carried light gives full radius, the dark ~2.
      const lightRadius = p.blind > 0 ? 1 : this.hasLight(p) ? 8 : 2;
      const useLit = p.blind === 0; // lit rooms reveal whole only while sighted
      if (co) lvl.computeFOVCo(p.x, p.y, lightRadius, useLit); else lvl.computeFOV(p.x, p.y, lightRadius, useLit);
    };
    fovOn(this.player, false);
    if (this.coPlayer) fovOn(this.coPlayer, true);
    // a one-time nudge the first time you're groping in the dark with no light
    const lp = this.localPlayer;
    if (!this.darkHinted && lp.alive && lp.blind === 0 && !this.hasLight(lp) && lp.floorKey === this.activeKey && this.level.lit[lp.y]?.[lp.x] === false) {
      this.darkHinted = true;
      this.log.add("It's dark here — you can see only a step or two. A lit block explorer (an oil lamp; apply it) would light the way.", "sys", lp);
    }
  }
  private darkHinted = false;

  /** A carried, lit light source (a block explorer / the Genesis Candelabrum) gives full sight in the dark. */
  hasLight(p: Player): boolean {
    return p.inventory.items.some((it) => (it.type.id === "lamp" || it.type.id === "candelabrum") && it.lit === true);
  }

  descend(): void {
    if (this.branch) { this.descendBranch(); return; } // floor-by-floor within a sub-dungeon
    const me = this.acting; // co-op: only the descending adventurer moves
    me.depth++;
    me.maxDepthReached = Math.max(me.maxDepthReached, me.depth);
    const kind = this.currentChain ? "normal" : this.levelKindFor(me.depth);
    const restored = this.beginLevel(this.levelKey(), kind);
    me.x = this.level.start.x; // arrive at this level's up-stair (its start)
    me.y = this.level.start.y;
    if (restored) {
      this.restoreEnter();
    } else {
      this.placeUpStair();
      this.enterLevel();
      this.saveActive();
    }
    if (this.level.kind === "bigroom") this.log.add("You descend into THE MEMPOOL — a vast open churn of pending chaos. Loot, and a swarm.", "bad");
    else if (this.level.kind === "maze") this.log.add(`You descend into the maze of ${realmName(me.depth)} — narrow, lightless, and patient.`, "bad");
    else this.log.add(`You descend to depth ${me.depth} — ${realmName(me.depth)}.`, me.depth >= 18 ? "bad" : "sys");
    if (me.depth >= 18 && me.depth < MAX_DEPTH) this.log.add("Chaos thickens. Expect Kusama.", "bad");
    if (me.depth === MAX_DEPTH && !this.gehennomOpen) this.log.add("The foot of the relay. The vibrating square (≈) hums — perform the Invocation (I) with all three relics.", "bad");
    else if (me.depth === MAX_DEPTH) this.log.add("The foot of the relay — the gate to the Dark Forest stands open below. (>)", "bad");
    else if (me.depth > MAX_DEPTH && me.depth < GEHENNOM_BOTTOM) this.log.add("You sink into the Dark Forest — Gehennom. Censorship weeps from the walls.", "bad");
    else if (me.depth >= GEHENNOM_BOTTOM) this.log.add("The bottom of all things. MOLOCH, the Central Planner, hoards the JAM here.", "bad");
    this.draw();
  }

  // ── XCM: parachain side-branches (each scales difficulty × loot) ────────────
  private placePortals(): void {
    if (this.currentChain || this.acting.depth < 2 || this.acting.depth >= MAX_DEPTH) return; // XCM branches off the relay descent (d2 .. foot of the relay), not Gehennom
    const n = ROT.RNG.getUniform() < 0.7 ? (ROT.RNG.getUniform() < 0.3 ? 2 : 1) : 0;
    for (let i = 0; i < n; i++) {
      const centers = this.level.roomCenters.filter(
        (c) => this.level.tileAt(c.x, c.y) === "floor" && !(c.x === this.acting.x && c.y === this.acting.y) && !this.level.portalAt(c.x, c.y),
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
    const restored = this.beginLevel(this.levelKey(), (chain.layout as LevelKind) ?? "normal"); // each parachain has a signature layout
    this.acting.x = this.level.start.x;
    this.acting.y = this.level.start.y;
    if (restored) {
      this.restoreEnter();
    } else {
      this.placeUpStair(); // the way back to the relay
      this.enterLevel();
      const goodies = ITEMS.filter((i) => i.kind === "ring" || i.kind === "wand");
      const cacheN = Math.max(0, Math.round(2 * chain.loot));
      for (let i = 0; i < cacheN; i++) {
        const pos = this.level.randomFloor();
        if (this.level.tileAt(pos.x, pos.y) === "floor" && !this.level.itemAt(pos.x, pos.y))
          this.level.items.push({ x: pos.x, y: pos.y, type: ROT.RNG.getItem(goodies)! });
      }
      this.saveActive();
    }
    this.log.add(`${fp("You enter", "XCM →")} ${chainName(chain)}: difficulty ×${chain.difficulty}, loot ×${chain.loot}. (< to return to ${fp("the dungeon", "the relay")})`, chain.difficulty >= 1 ? "bad" : "sys");
    this.draw();
  }

  private exitChain(): void {
    const from = this.currentChain?.name ?? "the branch";
    this.currentChain = null;
    const restored = this.beginLevel(this.levelKey(), "normal");
    this.acting.x = this.level.stairs.x; // back on the relay, at its down-stair
    this.acting.y = this.level.stairs.y;
    if (restored) {
      this.restoreEnter();
    } else {
      if (this.acting.depth > 1) this.placeUpStair();
      this.enterLevel();
      this.saveActive();
    }
    this.log.add(`XCM ← you return from ${from} to the relay at depth ${this.acting.depth}.`, "sys");
    this.draw();
  }

  // ── Phase 16: sub-dungeon branches (the Mines) ──────────────────────────────
  /** Drop a branch-stair onto its host depth on the main descent (the Mines entrance). */
  private placeBranchEntrance(): void {
    if (this.currentChain) return; // branches root in the main dungeon only
    for (const b of BRANCHES) {
      if (this.acting.depth !== b.entryDepth) continue;
      if (this.level.branchEntries.some((e) => e.branchId === b.id)) continue;
      const centers = this.level.roomCenters.filter(
        (c) => this.level.tileAt(c.x, c.y) === "floor" && !(c.x === this.acting.x && c.y === this.acting.y) && !this.level.portalAt(c.x, c.y),
      );
      const c = centers.length ? ROT.RNG.getItem(centers)! : this.level.randomFloor();
      this.level.tiles[c.y][c.x] = "branchDown";
      this.level.branchEntries.push({ x: c.x, y: c.y, branchId: b.id });
      const verb = b.upward ? "rises off this floor toward" : "plunges off this floor toward";
      this.log.add(`A side-stair (a copper >) ${verb} ${b.name} — ${this.ident.name(itemById(b.prizeId)!)} waits at ${branchEnd(b)}.`, "good");
    }
  }

  /** Step from a branch-stair into a sub-dungeon; called by the > handler. Returns true if entered. */
  enterBranchAt(x: number, y: number): boolean {
    const e = this.level.branchEntryAt(x, y);
    const def = e ? branchById(e.branchId) : undefined;
    if (!def) return false;
    this.enterBranch(def);
    return true;
  }

  /** Enter a branch at its mouth (floor 1); progress runs via > toward the prize on the End floor. */
  enterBranch(def: BranchDef): void {
    this.enterBranchFloor(def, 1, "down");
    this.log.add(`${branchEntryFlavor(def) ?? `You clamber down into ${chainName(def)}.`} (< to climb back toward ${fp("the dungeon", "the relay")})`, "bad");
    this.draw();
  }

  /** Descend one floor deeper within the active branch (the > handler routes here in a branch). */
  private descendBranch(): void {
    const def = this.branch!;
    this.enterBranchFloor(def, this.branchFloor + 1, "down");
    const atEnd = this.branchFloor >= def.floors;
    this.log.add(
      atEnd ? `You reach ${branchEnd(def)}. ${this.ident.name(itemById(def.prizeId)!)} gleams ahead — and something guards it.`
            : `You ${def.upward ? "climb higher in" : "press deeper into"} ${chainName(def)} — floor ${this.branchFloor} of ${def.floors}.`,
      "bad",
    );
    this.draw();
  }

  /** Climb up within the active branch; at its top, step back out onto the host relay depth. */
  private ascendBranch(): void {
    const def = this.branch!;
    if (this.branchFloor > 1) {
      this.enterBranchFloor(def, this.branchFloor - 1, "up");
      this.log.add(`You ${def.upward ? "descend" : "climb back up"} ${chainName(def)} — floor ${this.branchFloor} of ${def.floors}.`, "sys");
      this.draw();
      return;
    }
    // top floor → leave the branch, back onto the host relay level at the branch-stair
    this.currentChain = null;
    this.branchFloor = 0;
    this.acting.depth = def.entryDepth; // a branch always roots at its entryDepth on the main descent
    const restored = this.beginLevel(this.levelKey(), this.levelKindFor(this.acting.depth));
    const entry = this.level.branchEntries.find((e) => e.branchId === def.id);
    const at = entry ?? this.level.start;
    this.acting.x = at.x; this.acting.y = at.y;
    if (restored) {
      this.restoreEnter();
    } else {
      if (this.acting.depth > 1) this.placeUpStair();
      this.enterLevel();
      this.saveActive();
    }
    this.log.add(`You climb out of ${def.name}, back onto the relay at depth ${this.acting.depth}.`, "sys");
    this.draw();
  }

  /** Shared branch-floor entry: set state + effective depth, restore-or-generate, place the End prize. */
  private enterBranchFloor(def: BranchDef, floor: number, dir: "up" | "down"): void {
    this.currentChain = def;
    this.branchFloor = floor;
    this.acting.depth = def.entryDepth + floor; // effective depth scales spawns/loot
    this.acting.maxDepthReached = Math.max(this.acting.maxDepthReached, this.acting.depth);
    const restored = this.beginLevel(this.levelKey(), def.sokoban ? "sokoban" : (def.layout as LevelKind));
    if (!restored && def.sokoban) this.buildSokobanFloor(def, floor); // stamp the prefab (sets start/stairs) before we read them
    const arrive = dir === "down" ? this.level.start : this.level.stairs; // down→up-stair, up→down-stair
    this.acting.x = arrive.x; this.acting.y = arrive.y;
    if (restored) {
      this.restoreEnter();
    } else if (def.sokoban) {
      this.placeParty(); this.rebuildSchedule(); // a hand-built floor is fully populated by buildSokobanFloor — no procedural spawn
      this.saveActive();
    } else {
      this.placeUpStair(); // the way back up toward the relay
      this.enterLevel();
      if (floor >= def.floors) this.placeBranchPrize(def); // the End — guaranteed prize, no stair deeper
      this.saveActive();
    }
  }

  /** Stamp a Sokoban branch floor from its template and lay the guaranteed prize on the goal tile. */
  private buildSokobanFloor(def: BranchDef, floor: number): void {
    this.monsters = []; // a pure puzzle — no spawns
    this.level.loadSokoban(SOKOBAN_FLOORS[Math.min(floor, SOKOBAN_FLOORS.length) - 1]);
    const s = this.level.stairs; // the goal `>` — the prize rests here (no stair deeper)
    const prize = itemById(def.prizeId);
    if (prize && !this.level.itemAt(s.x, s.y)) this.level.items.push({ x: s.x, y: s.y, type: prize, buc: "blessed", bucKnown: true });
  }

  /** A branch's end floor: its down-stair becomes the guaranteed prize, with a guardian beside it. */
  private placeBranchPrize(def: BranchDef): void {
    const s = this.level.stairs;
    this.level.tiles[s.y][s.x] = "floor"; // the End — nothing deeper
    const prize = itemById(def.prizeId);
    if (prize && !this.level.itemAt(s.x, s.y)) this.level.items.push({ x: s.x, y: s.y, type: prize, enchant: def.prizeEnchant, buc: "blessed", bucKnown: true });
    const guard = def.bossDef ?? MONSTERS.find((m) => m.ch === "O") ?? MONSTERS[MONSTERS.length - 1]; // the branch's boss, else a whale
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]] as [number, number][]) {
      const x = s.x + dx, y = s.y + dy;
      if (this.level.isPassable(x, y) && !this.monsterAt(x, y) && !(x === this.acting.x && y === this.acting.y)) {
        const m = new Monster(this, guard, x, y);
        this.monsters.push(m);
        this.scheduler.add(m, true); // enterLevel already scheduled; add the late-placed guardian
        break;
      }
    }
  }

  // ── the archetype Quest (Phase 13c) ──
  /** Open the homeland portal once, on the quest depth, until the Quest is done. */
  private placeQuestPortal(): void {
    if (this.questDone || this.inQuest || this.currentChain) return; // only on the main relay descent
    const q = questFor(this.acting.archetype);
    if (this.acting.depth !== q.portalDepth) return;
    const centers = this.level.roomCenters.filter((c) => this.level.tileAt(c.x, c.y) === "floor" && !this.level.portalAt(c.x, c.y) && !(c.x === this.acting.x && c.y === this.acting.y));
    const c = centers.length ? ROT.RNG.getItem(centers)! : this.level.randomFloor();
    this.level.tiles[c.y][c.x] = "portal";
    this.level.portals.push({ x: c.x, y: c.y, chain: CHAINS[0], quest: true });
    this.log.add(`A portal pulses with your homeland's sigil — your Quest awaits in ${questHomeland(q)} (Ω, > to enter). Slay your nemesis, claim your artifact.`, "good");
  }

  /** Enter the Quest homeland: your nemesis guards your signature artifact. */
  enterQuest(): void {
    const me = this.acting;
    const q = questFor(me.archetype);
    if (this.questDone) {
      // the homeland portal persists on the relay level now — spend it once the Quest is fulfilled
      this.level.tiles[me.y][me.x] = "floor";
      const pi = this.level.portals.findIndex((p) => p.x === me.x && p.y === me.y);
      if (pi >= 0) this.level.portals.splice(pi, 1);
      this.log.add("Your Quest is fulfilled — the homeland portal has gone dark.", "dim");
      this.recomputeFOV(); this.draw();
      return;
    }
    this.inQuest = true;
    this.currentChain = null;
    const restored = this.beginLevel(this.levelKey(), "normal");
    me.x = this.level.start.x;
    me.y = this.level.start.y;
    if (restored) {
      this.restoreEnter();
    } else {
      this.placeUpStair(); // the way home
      this.enterLevel();
      // the nemesis guards the artifact near the far end
      const s = this.level.stairs;
      this.level.tiles[s.y][s.x] = "floor";
      this.level.items.push({ x: s.x, y: s.y, type: itemById(q.artifactId)!, relic: true, enchant: 2, buc: "blessed", bucKnown: true });
      const spot = this.adjacentFree(s.x, s.y) ?? { x: s.x, y: s.y };
      const nemesis = new Monster(this, q.nemesis, spot.x, spot.y);
      this.monsters.push(nemesis);
      this.scheduler.add(nemesis, true); // enterLevel already scheduled; add the late-placed nemesis
      this.saveActive();
    }
    this.log.add(`You step into ${questHomeland(q)}. ${cap(monName(q.nemesis))} bars the way to ${this.ident.name(itemById(q.artifactId)!)}. (< to flee home)`, "bad");
    this.draw();
  }

  private exitQuest(): void {
    this.inQuest = false;
    const restored = this.beginLevel(this.levelKey(), "normal");
    this.acting.x = this.level.stairs.x;
    this.acting.y = this.level.stairs.y;
    if (restored) {
      this.restoreEnter();
    } else {
      if (this.acting.depth > 1) this.placeUpStair();
      this.enterLevel();
      this.saveActive();
    }
    this.log.add(`You return from your Quest to the relay at depth ${this.acting.depth}.`, "sys");
    this.draw();
  }

  ascend(): void {
    if (this.inQuest) { this.exitQuest(); return; }
    if (this.branch) { this.ascendBranch(); return; } // climb within / out of a sub-dungeon
    if (this.currentChain) { this.exitChain(); return; }
    if (this.plane > 0) { this.enterPlane(this.plane + 1); return; } // climb higher through the Planes
    const holder = this.allPlayers().find((p) => p.hasJam);
    const me = this.acting; // co-op: only the climbing adventurer moves
    const newDepth = me.depth - 1;
    if (newDepth < 1) {
      // at the surface: the JAM drags you UPWARD into the Planes; without it, the world ends here
      if (holder) this.enterPlane(1);
      return;
    }
    me.depth = newDepth;
    const restored = this.beginLevel(this.levelKey(), this.levelKindFor(newDepth));
    me.x = this.level.stairs.x; // you climb up INTO the down-stairs of the level above
    me.y = this.level.stairs.y;
    if (restored) {
      this.restoreEnter();
    } else {
      if (newDepth > 1) this.placeUpStair();
      this.enterLevel();
      this.saveActive();
    }
    // with the JAM at the surface, a stair beyond the world opens upward into the Planes
    if (newDepth === 1 && holder) this.level.tiles[me.y][me.x] = "stairsUp";
    this.log.add(`You climb to depth ${newDepth} — ${realmName(newDepth)}.`, "sys");
    if (newDepth === 1 && holder) this.log.add("The surface is near — but the JAM hauls you UPWARD, past the world itself. Climb (<) into the Planes.", "good");
    this.draw();
  }

  /** Enter the n-th Plane of the ascent (1..PLANES.length). The last is the Genesis Plane. */
  private enterPlane(n: number): void {
    if (n > PLANES.length) return; // already atop the Genesis Plane — offer the JAM, don't climb
    this.saveActive(); // persist the dungeon/plane level being left (no descent back, but keep its slot live)
    this.activeKey = `plane:${n}`; // the live floor is now this plane — so per-actor setActive finds it
    this.plane = n;
    this.currentChain = null;
    this.level = new Level(W, MAP_H, PLANE_KINDS[n - 1] ?? "normal"); // each Plane its own layout
    this.acting.x = this.level.start.x;
    this.acting.y = this.level.start.y;
    this.enterLevel(); // routes through setupPlane() since plane > 0; rebuildSchedule tags acting.floorKey = plane:n
    this.slots.set(this.activeKey, { level: this.level, monsters: this.monsters }); // register so setActive can return here
    const def = PLANES[n - 1];
    this.log.add(`You rise onto ${def.name}. ${def.flavor}`, n === PLANES.length ? "good" : "sys");
    this.draw();
  }

  /** Lay out a Plane: tough guardians + the stair to the next plane (or the Genesis altar). */
  private setupPlane(): void {
    const isGenesis = this.plane === PLANES.length;
    this.genesisAltars = [];
    if (isGenesis) {
      // three altars, one per ethos — only the one matching your alignment ascends
      const ethoses: Ethos[] = ROT.RNG.shuffle(["Order", "Balance", "Chaos"]);
      const spots = [this.level.stairs, ...this.level.roomCenters.filter((c) => this.level.tileAt(c.x, c.y) === "floor")];
      const used: { x: number; y: number }[] = [];
      for (const e of ethoses) {
        const spot = spots.find((s) => this.level.tileAt(s.x, s.y) === "floor" && !used.some((u) => u.x === s.x && u.y === s.y) && Math.max(Math.abs(s.x - this.player.x), Math.abs(s.y - this.player.y)) > 2) ?? this.level.randomFloor();
        this.level.tiles[spot.y][spot.x] = "altar";
        this.genesisAltars.push({ x: spot.x, y: spot.y, ethos: e });
        used.push({ x: spot.x, y: spot.y });
      }
    } else {
      const s = this.level.stairs;
      this.level.tiles[s.y][s.x] = "stairsUp"; // climb higher
    }
    this.spawnPlaneGuardians();
  }

  /** Sense an Astral altar's alignment when you step onto it (called as you enter a tile). */
  noteTile(p: Player): void {
    if (this.plane !== PLANES.length) return;
    const a = this.genesisAltars.find((g) => g.x === p.x && g.y === p.y);
    if (a) this.log.add(`This altar resonates with ${ethosName(a.ethos)}.${a.ethos === p.ethos ? ` It is yours — offer the ${fp("Amulet", "JAM")} (O).` : " Not your alignment."}`, a.ethos === p.ethos ? "good" : "dim");
  }

  // ── the Censor's hunt (Phase 12d) ──
  /** Once the JAM is taken, THE CENSOR keeps resurrecting to chase it. Called each player turn. */
  censorHuntTick(): void {
    if (this.over) return;
    const holder = this.allPlayers().find((q) => q.alive && q.hasJam);
    if (!holder && !this.jamStolen) return;
    if (holder) this.setActive(holder.floorKey); // the hunt always rises on the JAM-bearer's floor
    if (this.monsters.some((m) => m.alive && m.isHunter)) return; // a hunter already stalks this level
    if (this.censorTimer > 0) { this.censorTimer--; return; }
    this.summonCensor();
    this.censorTimer = 45 + ROT.RNG.getUniformInt(0, 30); // a lull before the next rising
  }

  /** Raise a resurrected Censor a few tiles from a player. */
  private summonCensor(): void {
    const target = this.livingPlayers().find((q) => q.hasJam) ?? this.livingPlayers()[0];
    if (!target) return;
    let spot: { x: number; y: number } | null = null;
    for (let i = 0; i < 60; i++) {
      const c = this.level.randomFloor();
      const d = Math.max(Math.abs(c.x - target.x), Math.abs(c.y - target.y));
      if (d >= 3 && d <= 8 && this.level.tileAt(c.x, c.y) === "floor" && !this.monsterAt(c.x, c.y) && !this.playerAt(c.x, c.y)) { spot = c; break; }
    }
    spot = spot ?? this.adjacentFree(target.x, target.y);
    if (!spot) return;
    const m = new Monster(this, CENSOR, spot.x, spot.y);
    m.isHunter = true;
    this.monsters.push(m);
    this.scheduler.add(m, true);
    this.log.add("The air curdles and tears — THE CENSOR rises again. It will not let the JAM leave.", "bad", "both");
    this.draw();
  }

  /** The hunting Censor snatches the JAM and level-blinks away — reclaim it by slaying it. */
  censorSteal(censor: Monster, holder: Player): void {
    holder.hasJam = false;
    this.jamStolen = true;
    this.log.add("THE CENSOR's hand closes on the JAM — it BLINKS away with your prize! Hunt it down.", "bad", "both");
    for (let i = 0; i < 60; i++) {
      const c = this.level.randomFloor();
      if (this.level.tileAt(c.x, c.y) === "floor" && !this.monsterAt(c.x, c.y) && !this.playerAt(c.x, c.y) && Math.max(Math.abs(c.x - holder.x), Math.abs(c.y - holder.y)) >= 6) { censor.x = c.x; censor.y = c.y; break; }
    }
    this.draw();
  }

  /** Plane guardians — Moloch's last servants, drawn from the deepest bestiary. */
  private spawnPlaneGuardians(): void {
    const deep = MONSTERS.filter((m) => (m.minDepth ?? 1) >= 5);
    const n = 3 + this.plane; // higher planes are better defended
    for (let i = 0; i < n; i++) {
      const pos = this.level.randomFloor();
      if (this.level.tileAt(pos.x, pos.y) !== "floor" || this.monsterAt(pos.x, pos.y) || (pos.x === this.player.x && pos.y === this.player.y)) continue;
      this.monsters.push(new Monster(this, ROT.RNG.getItem(deep)!, pos.x, pos.y));
    }
  }

  private placeUpStair(): void {
    const s = this.level.start;
    this.level.tiles[s.y][s.x] = "stairsUp";
  }

  /** The music area id for the current location (drives the soundtrack). */
  private currentAreaId(): string {
    if (this.plane > 0) return this.plane === PLANES.length ? "genesis" : "planes";
    if (this.inQuest || this.currentChain) return "elsewhere";
    const d = this.localPlayer.depth;
    if (this.level?.kind === "bigroom") return "mempool";
    if (d >= GEHENNOM_BOTTOM) return "sanctum";
    if (d > MAX_DEPTH) return "gehennom";
    if (d === MAX_DEPTH) return "relay";
    if (d >= 9) return "kusama";
    if (d >= 5) return "parachain";
    return "legacy";
  }

  /** 0..1 danger for the music tension layer: adjacency, bosses, and the Censor hunt. */
  private dangerLevel(): number {
    let danger = 0;
    const near = (m: Monster) => this.playersHere().some((p) => Math.max(Math.abs(m.x - p.x), Math.abs(m.y - p.y)) <= 1); // this floor's adventurers
    for (const m of this.monsters) {
      if (!m.alive || m.peaceful) continue;
      if (near(m)) danger = Math.max(danger, 0.55);
      if ((m.def.boss || m.isHunter || m.def === MOLOCH || m.def === CENSOR) && this.level.isVisible(m.x, m.y)) danger = Math.max(danger, 0.9);
    }
    if (this.jamStolen) danger = Math.max(danger, 0.5);
    return danger;
  }

  /** The per-frame snapshot the music engine reacts to: threat, danger, and nearby context.
   *  Depth no longer stresses the mix — only what's actually around you does. */
  private musicContext(): MusicContext {
    const p = this.localPlayer; // each client's music tracks its OWN adventurer
    const vis = (m: Monster) => this.level.isVisible(m.x, m.y);
    const isBoss = (m: Monster) => m.def.boss || m.isHunter || m.def === MOLOCH || m.def === CENSOR;
    // peril: low HP, afflictions, being hunted — folded into `danger` so the tension cues react to it
    let peril = 0;
    if (p.hp < p.maxHp * 0.4) peril = Math.max(peril, 1 - p.hp / (p.maxHp * 0.4));
    if (p.stoning > 0 || p.illness > 0) peril = Math.max(peril, 0.7);
    if (p.poison > 0) peril = Math.max(peril, 0.4);
    if (this.jamStolen || this.monsters.some((m) => m.alive && m.isHunter)) peril = Math.max(peril, 0.55);
    // threat: visible non-peaceful foes, scaled by how MANY and how CLOSE, peaking at bosses/swarms —
    // this is what now warps the sound (murk + detune), in place of depth.
    const here = this.playersHere();
    let threat = 0;
    for (const m of this.monsters) {
      if (!m.alive || m.peaceful || !vis(m)) continue;
      let dist = 99;
      for (const q of here) dist = Math.min(dist, Math.max(Math.abs(m.x - q.x), Math.abs(m.y - q.y)));
      const prox = Math.max(0, 1 - dist / 10); // ramps up within ~10 tiles
      threat += prox * 0.35 * (isBoss(m) ? 2.2 : 1);
    }
    threat = Math.min(1, threat);
    const bossNear = this.monsters.some((m) => m.alive && isBoss(m) && vis(m));
    const crowd = Math.min(1, this.monsters.filter((m) => m.alive && !m.peaceful && vis(m)).length / 6);
    const jamNear = this.allPlayers().some((q) => q.hasJam) || this.jamStolen || this.level.items.some((i) => i.type.id === "jam");
    const onFeat = (tile: string) => {
      for (const [dx, dy] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]] as [number, number][]) if (this.level.tileAt(p.x + dx, p.y + dy) === tile) return true;
      return false;
    };
    return { threat, danger: Math.min(1, Math.max(this.dangerLevel(), peril)), bossNear, crowd, jamNear, faucet: onFeat("faucet"), altar: onFeat("altar") };
  }

  /** Which level layout a depth uses — the descent rotates through layout zones for variety. */
  private levelKindFor(depth: number): LevelKind {
    if (depth === MEMPOOL_DEPTH) return "bigroom";                  // the Mempool (d13)
    if (depth === GEHENNOM_BOTTOM) return "concentric";             // Moloch's ringed arena (d48)
    if (depth > MAX_DEPTH && depth < GEHENNOM_BOTTOM) return depth === 36 ? "fortress" : "maze"; // the Council Fort mid-Gehennom (d36), else mazes
    switch (depth) {                                                // the relay descent (d1–25)
      case 4: case 17: return "grid";        // rollup metropolises
      case 6: case 10: case 21: return "cave"; // organic caverns (the Mines branch off d5)
      case 8: case 19: case 23: return "labyrinth"; // winding labyrinths (the Kusama deeps)
      case 15: return "swamp";               // the Liquidity Pools — open water + islands
      default: return "normal";              // the rest, incl. d25 (foot of the relay)
    }
  }

  private placeJamAndBoss(): void {
    const s = this.level.stairs;
    this.level.tiles[s.y][s.x] = "floor"; // the bottom — no stairs deeper
    this.level.items.push({ x: s.x, y: s.y, type: JAM });
    const offs = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]];
    for (const [dx, dy] of offs) {
      const x = s.x + dx, y = s.y + dy;
      if (this.level.isPassable(x, y) && !this.monsterAt(x, y) && !(x === this.player.x && y === this.player.y)) {
        this.monsters.push(new Monster(this, MOLOCH, x, y));
        break;
      }
    }
  }

  /** Depth 8 before the Invocation: the down-stairs are replaced by the vibrating square, the Censor on guard. */
  private placeVibratingSquare(): void {
    const s = this.level.stairs;
    this.level.tiles[s.y][s.x] = "vibrating";
    const offs = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]];
    for (const [dx, dy] of offs) {
      const x = s.x + dx, y = s.y + dy;
      if (this.level.isPassable(x, y) && !this.monsterAt(x, y) && !(x === this.player.x && y === this.player.y)) {
        this.monsters.push(new Monster(this, CENSOR, x, y));
        break;
      }
    }
  }

  /** Place this depth's invocation relic if no one in the party carries it yet (so it can't be permanently missed). */
  private placeRelics(): void {
    const id = RELIC_DEPTH[this.player.depth];
    if (!id) return;
    if (this.allPlayers().some((p) => p.inventory.items.some((it) => it.type.id === id || (it.contents ?? []).some((c) => c.type.id === id)))) return;
    const t = itemById(id); if (!t) return;
    const centers = this.level.roomCenters.filter((c) => this.level.tileAt(c.x, c.y) === "floor" && !this.level.itemAt(c.x, c.y) && !(c.x === this.player.x && c.y === this.player.y));
    const spot = centers.length ? ROT.RNG.getItem(centers)! : this.level.randomFloor();
    this.level.items.push({ x: spot.x, y: spot.y, type: t, buc: "blessed", bucKnown: true });
    this.log.add(`Something of power rests on this floor — one of the three Invocation relics. (${t.name})`, "good");
  }

  /** `#invoke` (I) — perform the Invocation at the vibrating square to open Gehennom. */
  invoke(p: Player): boolean {
    if (this.level.tileAt(p.x, p.y) !== "vibrating") { this.log.add("The ground here is silent. Seek the vibrating square (≈) at the foot of the relay.", "dim"); return false; }
    if (this.gehennomOpen) { this.log.add("The gate already yawns open below.", "dim"); return false; }
    const need = ["bell", "candelabrum", "graybook"];
    const have = (id: string) => p.inventory.items.some((it) => it.type.id === id);
    const missing = need.filter((id) => !have(id)).map((id) => itemById(id)!.name);
    if (missing.length) { this.log.add(`The square thrums, but the rite is incomplete. You still need: ${missing.join(", ")}.`, "bad"); return false; }
    this.gehennomOpen = true;
    this.level.tiles[p.y][p.x] = "stairsDown";
    this.log.add("You ring the Bell of Finality — one note, and it never decays.", "sys");
    this.log.add("You light the Genesis Candelabrum — seven flames of the first block flare.", "sys");
    this.log.add("You read aloud from the Gray Paper. The grammar of consensus unwrites itself.", "sys");
    this.log.add("✦ The vibrating square shatters into a stair spiralling down. GEHENNOM — the Dark Forest — is open. (> to descend)", "good");
    this.recomputeFOV(); this.draw();
    return true;
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

  private placeAltar(): void { this.placeFeature("altar", 0.45); }

  /** Place a single dungeon feature on an unused room centre. */
  private placeFeature(tile: TileType, chance: number): void {
    if (ROT.RNG.getUniform() > chance) return;
    const centers = this.level.roomCenters.filter(
      (c) => this.level.tileAt(c.x, c.y) === "floor" && !(c.x === this.player.x && c.y === this.player.y) && !this.monsterAt(c.x, c.y),
    );
    if (!centers.length) return;
    const c = ROT.RNG.getItem(centers)!;
    this.level.tiles[c.y][c.x] = tile;
  }

  /** Scatter pushable boulders in open rooms (≥3 open neighbours, so they can never seal a corridor). */
  private placeBoulders(): void {
    const open = (x: number, y: number) => ([[1, 0], [-1, 0], [0, 1], [0, -1]] as [number, number][]).filter(([dx, dy]) => this.level.isPassable(x + dx, y + dy)).length >= 3;
    const n = ROT.RNG.getUniformInt(0, this.level.kind === "bigroom" ? 5 : 2);
    for (let i = 0; i < n; i++) {
      let pos = this.level.randomFloor(), tries = 0;
      while (tries < 40 && (this.level.tileAt(pos.x, pos.y) !== "floor" || !open(pos.x, pos.y) || this.level.itemAt(pos.x, pos.y) || this.level.boulderAt(pos.x, pos.y) || this.monsterAt(pos.x, pos.y) || (pos.x === this.player.x && pos.y === this.player.y))) { pos = this.level.randomFloor(); tries++; }
      if (tries < 40) this.level.boulders.push({ x: pos.x, y: pos.y });
    }
  }

  /** Flood-fill the floor cells of the room containing (cx,cy); walls and doors bound it. */
  private roomCells(cx: number, cy: number, cap = 80): { x: number; y: number }[] {
    if (this.level.tileAt(cx, cy) !== "floor") return [];
    const seen = new Set<string>([`${cx},${cy}`]);
    const cells = [{ x: cx, y: cy }];
    const q = [{ x: cx, y: cy }];
    while (q.length && cells.length < cap) {
      const c = q.shift()!;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as [number, number][]) {
        const nx = c.x + dx, ny = c.y + dy, k = `${nx},${ny}`;
        if (!seen.has(k) && this.level.tileAt(nx, ny) === "floor") { seen.add(k); const cell = { x: nx, y: ny }; cells.push(cell); q.push(cell); }
      }
    }
    return cells;
  }

  /** Drop a NetHack-style special room into a standard floor: a temple, a zoo, or a treasure vault. */
  private placeSpecialRoom(): void {
    if (this.player.depth < 2 || this.level.kind !== "normal") return;
    if (ROT.RNG.getUniform() > 0.35) return;
    const candidates = ROT.RNG.shuffle(
      this.level.roomCenters.slice(1).filter((c) => this.level.tileAt(c.x, c.y) === "floor" && !(c.x === this.player.x && c.y === this.player.y)),
    );
    for (const c of candidates) {
      const cells = this.roomCells(c.x, c.y);
      const open = cells.filter((p) => this.level.tileAt(p.x, p.y) === "floor" && !this.monsterAt(p.x, p.y) && !this.level.itemAt(p.x, p.y) && !this.playerAt(p.x, p.y));
      if (cells.length < 6 || open.length < 4) continue;
      const kind = ROT.RNG.getItem(["temple", "zoo", "vault", "morgue", "oracle", "barracks", "beehive", "lephall", "swamp"])!;
      if (kind === "temple") this.makeTemple(c, open);
      else if (kind === "zoo") this.makeZoo(open);
      else if (kind === "morgue") this.makeMorgue(open);
      else if (kind === "oracle") this.makeOracle(c, open);
      else if (kind === "barracks") this.makeBarracks(open);
      else if (kind === "beehive") this.makeBeehive(open);
      else if (kind === "lephall") this.makeLeprechaunHall(open);
      else if (kind === "swamp") this.makeSwamp(c, open);
      else this.makeVault(c, open);
      return;
    }
  }

  /** A shrine: an altar tended by a peaceful Gavin priest (a Gavin shrine). */
  private makeTemple(center: { x: number; y: number }, open: { x: number; y: number }[]): void {
    this.level.tiles[center.y][center.x] = "altar";
    const guard = open.find((p) => !(p.x === center.x && p.y === center.y)) ?? open[0];
    if (guard) { const m = new Monster(this, PRIEST, guard.x, guard.y); m.peaceful = true; this.monsters.push(m); }
    this.log.add("A hush settles over this floor — a shrine to Gavin, its altar (_) tended by a priest. (P to pray, O to offer)", "good");
  }

  /** A morgue: rotting corpses of dead chains, stalked by wraiths and the deep undead. */
  private makeMorgue(open: { x: number; y: number }[]): void {
    const wraith = MONSTERS.find((m) => m.ch === "w");
    let dead = 0;
    for (const p of open) {
      const r = ROT.RNG.getUniform();
      if (r < 0.45 && !this.level.itemAt(p.x, p.y)) {
        this.level.items.push({ x: p.x, y: p.y, type: CORPSE, corpse: { def: this.pickMonster(this.player.depth), born: this.turn - 200 } }); // old, rotten remains
        dead++;
      } else if (r < 0.68) {
        const def = wraith && ROT.RNG.getUniform() < 0.5 ? wraith : this.pickMonster(this.player.depth);
        this.monsters.push(new Monster(this, def, p.x, p.y)); // gen-time spawn — scheduleParty schedules it
      }
    }
    if (dead) this.log.add("A reek of decay seeps through the wall — a morgue of dead chains, its rotting corpses (%) stalked by wraiths.", "bad");
  }

  /** The Oracle: a peaceful seer seated among springs — #chat (with coin) for a consultation. */
  private makeOracle(center: { x: number; y: number }, open: { x: number; y: number }[]): void {
    const m = new Monster(this, ORACLE, center.x, center.y); m.peaceful = true; this.monsters.push(m);
    let springs = 0;
    for (const p of open) {
      if (p.x === center.x && p.y === center.y) continue;
      if (springs < 3 && ROT.RNG.getUniform() < 0.35 && this.level.tileAt(p.x, p.y) === "floor" && !this.level.itemAt(p.x, p.y)) { this.level.tiles[p.y][p.x] = "faucet"; springs++; }
    }
    this.log.add("A strange calm pools through the wall — the Oracle (@) sits among the springs. (c to consult; coin loosens prophecy)", "sys");
  }

  /** A barracks: a garrison of armed mercenary nodes (the @ soldier line), with weapons + armor strewn about. */
  private makeBarracks(open: { x: number; y: number }[]): void {
    const soldier = MONSTERS.find((m) => m.fname === "a soldier") ?? this.pickMonster(this.player.depth);
    const gear = ITEMS.filter((i) => i.kind === "weapon" || i.kind === "armor");
    let n = 0;
    for (const p of open) {
      const r = ROT.RNG.getUniform();
      if (r < 0.5) { this.monsters.push(new Monster(this, soldier, p.x, p.y)); n++; }
      else if (r < 0.72 && !this.level.itemAt(p.x, p.y)) this.level.items.push({ x: p.x, y: p.y, type: ROT.RNG.getItem(gear)!, buc: rollBuc() });
    }
    if (n) this.log.add("Boots and barked orders ring through the wall — a barracks of mercenary nodes, armed and waiting.", "bad");
  }

  /** A beehive: a fast-swarming bot hive dripping with healing royal jelly. */
  private makeBeehive(open: { x: number; y: number }[]): void {
    const bot = MONSTERS.find((m) => m.ch === "b") ?? this.pickMonster(this.player.depth);
    const jelly = ITEMS.find((i) => i.id === "heal")!;
    let n = 0;
    for (const p of open) {
      const r = ROT.RNG.getUniform();
      if (r < 0.55) { this.monsters.push(new Monster(this, bot, p.x, p.y)); n++; }
      else if (r < 0.78 && !this.level.itemAt(p.x, p.y)) this.level.items.push({ x: p.x, y: p.y, type: jelly, buc: "blessed", bucKnown: false }); // royal jelly = a healing draught
    }
    if (n) this.log.add("A frantic buzzing leaks through the wall — a hive of bots, dripping with healing royal jelly.", "bad");
  }

  /** A leprechaun hall: airdrop farmers hoarding heaped gold (grab it before they swipe it). */
  private makeLeprechaunHall(open: { x: number; y: number }[]): void {
    const lep = MONSTERS.find((m) => m.stealsGold) ?? this.pickMonster(this.player.depth);
    let n = 0;
    for (const p of open) {
      const r = ROT.RNG.getUniform();
      if (r < 0.45) { this.monsters.push(new Monster(this, lep, p.x, p.y)); n++; }
      else if (r < 0.78 && !this.level.itemAt(p.x, p.y)) this.level.items.push({ x: p.x, y: p.y, type: GOLD, coins: ROT.RNG.getUniformInt(20, 60) });
    }
    if (n) this.log.add("Coins glint and tiny feet scatter — a leprechaun hall of airdrop farmers, hoarding gold.", "good");
  }

  /** A swamp: brackish bog pools (impassable water) churning with eels and serpents, a prize in the muck. */
  private makeSwamp(center: { x: number; y: number }, open: { x: number; y: number }[]): void {
    const eel = MONSTERS.find((m) => m.ch === ";") ?? this.pickMonster(this.player.depth);
    const serpent = MONSTERS.find((m) => m.fname === "a giant serpent") ?? eel;
    let beasts = 0;
    for (const p of open) {
      if (p.x === center.x && p.y === center.y) continue; // keep the core dry so the room stays crossable
      const r = ROT.RNG.getUniform();
      if (r < 0.3 && this.level.tileAt(p.x, p.y) === "floor" && !this.level.itemAt(p.x, p.y) && !(p.x === this.player.x && p.y === this.player.y)) this.level.tiles[p.y][p.x] = "water"; // a bog pool
      else if (r < 0.5) { this.monsters.push(new Monster(this, ROT.RNG.getUniform() < 0.55 ? eel : serpent, p.x, p.y)); beasts++; }
      else if (r < 0.62 && !this.level.itemAt(p.x, p.y)) this.level.items.push({ x: p.x, y: p.y, type: pickItemType(), buc: rollBuc() });
    }
    if (beasts) this.log.add("A dank, brackish reek wells through the wall — a drowned swamp, its bog pools (}) churning with eels and serpents.", "bad");
  }

  /** A zoo: a room packed with monsters guarding scattered loot (an airdrop trap room). */
  private makeZoo(open: { x: number; y: number }[]): void {
    let beasts = 0;
    for (const p of open) {
      const r = ROT.RNG.getUniform();
      if (r < 0.55) { this.monsters.push(new Monster(this, this.pickMonster(this.player.depth), p.x, p.y)); beasts++; }
      else if (r < 0.8) this.level.items.push({ x: p.x, y: p.y, type: pickItemType(), buc: rollBuc() });
    }
    if (beasts) this.log.add("A foul racket leaks through a doorway — a packed menagerie of the legacy stack, hoarding loot.", "bad");
  }

  /** A vault: a dense treasure room — the Treasury — with a locked chest at its heart. */
  private makeVault(center: { x: number; y: number }, open: { x: number; y: number }[]): void {
    let dropped = 0;
    for (const p of open) {
      if (p.x === center.x && p.y === center.y) continue;
      if (ROT.RNG.getUniform() < 0.45) {
        const type = ROT.RNG.getUniform() < 0.3 ? ROT.RNG.getItem(ITEMS.filter((i) => isGear(i)))! : pickItemType();
        this.level.items.push({ x: p.x, y: p.y, type, buc: rollBuc() }); dropped++;
      }
    }
    if (this.level.tileAt(center.x, center.y) === "floor" && !this.level.itemAt(center.x, center.y))
      this.level.items.push({ x: center.x, y: center.y, type: CHEST, chest: { locked: true } });
    if (dropped) this.log.add("Coffers glint behind a door — the Treasury, heaped with wares around a locked chest.", "good");
  }

  /** Drop a chest of loot on an unused room centre. */
  private placeChest(chance: number): void {
    if (ROT.RNG.getUniform() > chance) return;
    const centers = this.level.roomCenters.filter(
      (c) => this.level.tileAt(c.x, c.y) === "floor" && !this.level.itemAt(c.x, c.y) && !(c.x === this.player.x && c.y === this.player.y),
    );
    if (!centers.length) return;
    const c = ROT.RNG.getItem(centers)!;
    this.level.items.push({ x: c.x, y: c.y, type: CHEST, chest: { locked: ROT.RNG.getUniform() < 0.5 } });
  }

  chestUnderfoot(p: Player): boolean {
    return this.level.items.some((i) => i.chest && i.x === p.x && i.y === p.y);
  }

  /** Does this attempt to force a lock succeed? Weapons help; a missed swing may ding the blade. */
  private tryForce(p: Player): boolean {
    const armed = !!p.weapon;
    const chance = armed ? Math.max(0.25, 0.5 + abilityMod(p.str) * 0.08) : Math.max(0.15, 0.3 + abilityMod(p.str) * 0.05);
    if (ROT.RNG.getUniform() < chance) return true;
    if (armed && !p.weapon!.proofed && ROT.RNG.getUniform() < 0.12) {
      p.weapon!.erosion = Math.min(3, (p.weapon!.erosion ?? 0) + 1);
      this.log.add(`Your ${this.ident.name(p.weapon!.type)} scrapes and dulls against the lock.`, "dim");
    }
    return false;
  }

  /** `o` in a direction — open a door (force it with your weapon if locked). */
  openDir(p: Player, dx: number, dy: number): boolean {
    const nx = p.x + dx, ny = p.y + dy;
    const tile = this.level.tileAt(nx, ny);
    const fi = this.level.items.find((i) => i.chest && i.x === nx && i.y === ny);
    if (fi) { this.log.add("Step onto the chest, then press o to open it.", "dim"); return false; }
    if (tile === "door") { this.log.add("That door is already open.", "dim"); return false; }
    if (tile === "doorClosed") { this.level.tiles[ny][nx] = "door"; this.recomputeFOV(); this.log.add(`${this.sub(p)} ${this.verbS(p, "open")} the door.`, "dim"); this.draw(); return true; }
    if (tile === "doorLocked") {
      const how = p.weapon ? `force the door with ${this.ident.name(p.weapon.type)}` : "shoulder the door";
      if (!this.tryForce(p)) { this.log.add(`You ${how} — the lock holds. (try again, or K to kick)`, "dim"); return true; }
      this.level.tiles[ny][nx] = "door"; this.recomputeFOV();
      this.log.add(`${this.sub(p)} ${this.verbS(p, "force")} the door open.`, "good"); this.draw(); return true;
    }
    this.log.add("There's nothing there to open.", "dim"); return false;
  }

  /** `C` in a direction — close an open door, sealing it (blocks sight + pursuers). */
  closeDoor(p: Player, dx: number, dy: number): boolean {
    const nx = p.x + dx, ny = p.y + dy;
    if (this.level.tileAt(nx, ny) !== "door") { this.log.add("There's no open door there to close.", "dim"); return false; }
    if (this.monsterAt(nx, ny) || this.playerAt(nx, ny) || this.level.boulderAt(nx, ny) || this.level.itemAt(nx, ny)) {
      this.log.add("Something's in the doorway — it won't close.", "dim"); return false;
    }
    this.level.tiles[ny][nx] = "doorClosed"; this.recomputeFOV();
    this.log.add(`${this.sub(p)} ${this.verbS(p, "pull")} the door shut.`, "dim"); this.draw(); return true;
  }

  /** `K` in a direction — kick a foe (damage + maybe stun/knockback), a boulder, a door, or a wall. */
  kick(p: Player, dx: number, dy: number): boolean {
    const nx = p.x + dx, ny = p.y + dy;
    // Kicking your co-op partner is the deliberate way to turn on them — a real attack.
    const ally = this.otherPlayerAt(p, nx, ny);
    if (ally) { this.attack(p, ally); return true; }
    const foe = this.monsterAt(nx, ny);
    if (foe) {
      if (foe.def.keeper && foe.peaceful) { foe.peaceful = false; foe.fg = "#ff5030"; this.log.add("You kick the Marketmaker — \"Assault!\" It turns lethal.", "bad"); }
      const dmg = Math.max(1, ROT.RNG.getUniformInt(1, 3) + abilityMod(p.str));
      foe.hp -= dmg;
      this.log.add(`${this.sub(p)} ${this.verbS(p, "kick")} ${foe.name} for ${dmg}.`, "good");
      if (foe.hp <= 0) { this.gainXp(p, foe.maxHp); this.kill(foe); return true; }
      // a solid boot can stun and shove the foe back a tile
      if (ROT.RNG.getUniform() < 0.35) {
        const bx = nx + dx, by = ny + dy;
        if (this.level.isPassable(bx, by) && !this.monsterAt(bx, by) && !this.playerAt(bx, by) && !this.level.boulderAt(bx, by)) { foe.x = bx; foe.y = by; }
        foe.sleepTurns = Math.max(foe.sleepTurns, 1);
        this.log.add(`${cap(foe.name)} reels from the blow.`, "dim");
      }
      return true;
    }
    if (this.level.boulderAt(nx, ny)) {
      const b = this.level.boulderAt(nx, ny)!, bx = nx + dx, by = ny + dy;
      if (this.level.tileAt(bx, by) === "pit" && !this.level.boulderAt(bx, by) && !this.monsterAt(bx, by) && !this.playerAt(bx, by)) {
        this.level.boulders = this.level.boulders.filter((x) => x !== b); this.level.tiles[by][bx] = "floor";
        this.recomputeFOV(); this.log.add("You kick the boulder into the chasm — it fills.", "good");
      } else if (this.level.isPassable(bx, by) && !this.level.boulderAt(bx, by) && !this.monsterAt(bx, by) && !this.playerAt(bx, by)) { b.x = bx; b.y = by; this.log.add("You kick the boulder forward.", "dim"); }
      else { this.log.add("You kick the boulder — it doesn't move. Ow.", "dim"); if (ROT.RNG.getUniform() < 0.3) { p.hp -= 1; if (p.hp <= 0) this.killPlayer(p); } }
      this.draw(); return true;
    }
    const tile = this.level.tileAt(nx, ny);
    if (tile === "sink") return this.kickSink(p, nx, ny);
    if (tile === "doorLocked") return this.kickDoor(p, nx, ny);
    if (tile === "doorClosed") { this.level.tiles[ny][nx] = "door"; this.recomputeFOV(); this.log.add("You kick the door open.", "good"); this.draw(); return true; }
    if (tile === "wall" || tile === "doorHidden") { this.log.add("You kick the wall. Ow — that was foolish.", "dim"); if (ROT.RNG.getUniform() < 0.4) { p.hp -= 1; if (p.hp <= 0) this.killPlayer(p); } return true; }
    this.log.add("You kick at the air.", "dim"); return false;
  }

  /** `#dip` (D) — dip your wielded weapon into a faucet underfoot. The lawful relic awaits the worthy. */
  dipWeapon(p: Player): boolean {
    if (this.level.tileAt(p.x, p.y) !== "faucet") { this.log.add("You see no faucet here to dip into.", "dim"); return false; }
    if (!p.weapon) { this.log.add("You have nothing wielded to dip.", "dim"); return false; }
    const w = p.weapon, name = this.ident.name(w.type), r = ROT.RNG.getUniform();
    const worthy = (this.luckOf(p) >= 3 || p.level >= 6) && w.buc !== "cursed";
    if (r < 0.10 && worthy && !w.relic) {
      w.relic = true; w.buc = "blessed"; w.bucKnown = true; w.enchant = Math.max(3, (w.enchant ?? 0) + 1);
      p.applyWeapon();
      this.log.add(`✦ The faucet erupts in light — a lawful current floods your ${name}! It is now Polkadot's Edge, +${w.enchant} blessed.`, "good");
    } else if (r < 0.32) { w.buc = "blessed"; w.bucKnown = true; this.log.add(`A clear glow washes your ${name} — it feels blessed.`, "good"); }
    else if (r < 0.46) { w.erosion = w.proofed ? 0 : Math.min(3, (w.erosion ?? 0) + 1); this.log.add(`The water is corrosive — your ${name} ${w.proofed ? "shrugs it off" : "corrodes"}.`, w.proofed ? "dim" : "bad"); }
    else if (r < 0.60) { const spot = this.adjacentFree(p.x, p.y); if (spot) { const m = new Monster(this, MONSTERS[0], spot.x, spot.y); this.monsters.push(m); this.scheduler.add(m, true); } this.log.add("A faucet bot sloshes out at the disturbance!", "bad"); }
    else this.log.add(`You dip your ${name}. The water ripples. Nothing happens.`, "dim");
    return true;
  }

  /** `#dip` (D) off a faucet — dip a chosen item into a held vial of water. Holy water (blessed)
   *  blesses & uncurses it; unholy water (cursed) curses it; plain water just wets it. One vial spent. */
  dipInWater(p: Player, target: Item): boolean {
    // Pick a vial to dip into — prefer a known holy one, then a known unholy one, then any (not the target itself).
    const waters = p.inventory.items.filter((it) => it.type.id === "water" && it !== target);
    if (waters.length === 0) { this.log.add("You've no other vial of water to dip into.", "dim"); return false; }
    const vial = waters.find((w) => w.bucKnown && w.buc === "blessed") ?? waters.find((w) => w.bucKnown && w.buc === "cursed") ?? waters[0];
    const tname = this.ident.name(target.type);
    this.ident.learn(vial.type); vial.bucKnown = true; // dipping reveals what the water was
    p.inventory.remove(vial);
    if (vial.buc === "blessed") {
      target.buc = "blessed"; target.bucKnown = true; // blessing also uncurses — a welded piece comes loose
      this.log.add(`You dip ${tname} into the holy water — it glows amber. It is now blessed.`, "good");
    } else if (vial.buc === "cursed") {
      target.buc = "cursed"; target.bucKnown = true;
      this.log.add(`You dip ${tname} into the unholy water — a black flicker crawls over it. It is now cursed.`, "bad");
    } else {
      this.log.add(`You dip ${tname} into the testnet water. It gets wet. Nothing more.`, "dim");
    }
    return true;
  }

  /** `^` — identify the trap underfoot and any revealed traps beside you. A free survey. */
  identifyTrap(p: Player): void {
    const here = this.level.trapAt(p.x, p.y);
    const around: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]];
    let found = false;
    if (here && here.revealed) { this.log.add(`You stand on a ${this.trapName(here.kind)}.`, "sys"); found = true; }
    for (const [dx, dy] of around) {
      const t = this.level.trapAt(p.x + dx, p.y + dy);
      if (t && t.revealed) { this.log.add(`There is a ${this.trapName(t.kind)} beside you.`, "sys"); found = true; }
    }
    if (!found) this.log.add("You sense no traps nearby. (s to search for hidden ones)", "dim");
  }

  /** `#twoweapon` (X) — set or clear the off-hand weapon. */
  setOffhand(p: Player, item: Item | null): boolean {
    if (item === null) {
      if (!p.offhand) return false;
      this.log.add(`${this.sub(p)} ${this.verbS(p, "sheathe")} the off-hand ${this.ident.name(p.offhand.type)}.`, "dim");
      p.offhand = null; return false; // a free action
    }
    p.offhand = item;
    this.log.add(`${this.sub(p)} ${this.verbS(p, "ready")} ${this.ident.name(item.type)} in the off-hand — now two-weaponing.`, "good");
    return true; // committing to the stance costs the turn
  }

  /** `#ride` (M) — mount or dismount the nominator steed (adjacent or underfoot). */
  toggleRide(p: Player): boolean {
    const steed = this.pet;
    if (p.riding) { p.riding = false; this.log.add(`${this.sub(p)} ${this.verbS(p, "dismount")} the nominator.`, "dim"); return true; }
    if (!steed || !steed.alive) { this.log.add("You have no steed to ride. (a tamed nominator)", "dim"); return false; }
    if (Math.max(Math.abs(steed.x - p.x), Math.abs(steed.y - p.y)) > 1) { this.log.add("Your steed is too far — step beside it first.", "dim"); return false; }
    p.riding = true; steed.x = p.x; steed.y = p.y;
    this.log.add(`${this.sub(p)} ${this.verbS(p, "mount")} the nominator — you ride as one, swift and sure.`, "good");
    return true;
  }

  /** Open a chest underfoot — force the lock if need be, then spill its loot. */
  openChest(p: Player): boolean {
    const fi = this.level.items.find((i) => i.chest && i.x === p.x && i.y === p.y);
    if (!fi || !fi.chest) { this.log.add("There's no chest here to open.", "dim"); return false; }
    if (fi.chest.locked) {
      const how = p.weapon ? `force the lock with ${this.ident.name(p.weapon.type)}` : "strain at the lock";
      if (!this.tryForce(p)) { this.log.add(`You ${how} — it holds. (try again)`, "dim"); return true; }
      this.log.add(`You ${how} open.`, "good"); fi.chest.locked = false;
    }
    this.level.items = this.level.items.filter((i) => i !== fi);
    const n = ROT.RNG.getUniformInt(1, 3);
    const spots = [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]];
    let dropped = 0, si = 0;
    for (let k = 0; k < n; k++) {
      const type = ROT.RNG.getUniform() < 0.15 ? itemById("hodlstone")! : pickItemType();
      while (si < spots.length) {
        const [dx, dy] = spots[si++];
        const x = p.x + dx, y = p.y + dy;
        if (this.level.isPassable(x, y) && !this.level.itemAt(x, y)) { this.level.items.push({ x, y, type, buc: rollBuc() }); dropped++; break; }
      }
    }
    // chests usually hold a purse of gold alongside the loot
    if (ROT.RNG.getUniform() < 0.75) {
      const amount = ROT.RNG.getUniformInt(10, 30) + this.player.depth * 5;
      const spot = this.adjacentFreeFloor(p.x, p.y);
      if (spot) { this.level.items.push({ x: spot.x, y: spot.y, type: GOLD, coins: amount }); dropped++; }
    }
    this.log.add(dropped ? `The chest holds ${dropped} ${dropped > 1 ? "things" : "thing"} — they spill out. (, to pick up)` : "The chest is empty.", dropped ? "good" : "dim");
    return true;
  }

  private trapName(k: TrapKind): string {
    return ({ gas: "gas-fee trap", slash: "slashing trap", reorg: "reorg trap", fork: "fork trap", trapdoor: "trapdoor",
      web: "honeypot web", dart: "front-running dart trap", antimagic: "anti-magic field", statue: "statue trap" } as Record<TrapKind, string>)[k];
  }

  /** A ring of searching: each turn, a chance to reveal an adjacent hidden trap or door. */
  autoSearchAround(p: Player): void {
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const x = p.x + dx, y = p.y + dy;
      const trap = this.level.trapAt(x, y);
      if (trap && !trap.revealed && ROT.RNG.getUniform() < 0.3) { trap.revealed = true; this.log.add(`Your ring senses a hidden ${this.trapName(trap.kind)}.`, "sys", p); }
      if (this.level.tileAt(x, y) === "doorHidden" && ROT.RNG.getUniform() < 0.3) { this.level.tiles[y][x] = "doorClosed"; this.log.add("Your ring senses a hidden door.", "sys", p); this.recomputeFOV(); }
    }
  }

  /** Search the surrounding tiles: Insight (WIS) reveals hidden traps & doors; then carefully
   *  disarm (DEX) any revealed trap beside you — your way past a path-blocking reorg trap. */
  search(p: Player): boolean {
    const find = Math.max(0.25, Math.min(0.92, 0.5 + abilityMod(p.wis) * 0.06 + this.luckOf(p) * 0.02));
    const disarm = Math.max(0.2, 0.4 + abilityMod(p.dex) * 0.07);
    let found = 0, disarmed = 0;
    const around: [number, number][] = [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]];
    for (const [dx, dy] of around) {
      const x = p.x + dx, y = p.y + dy;
      const trap = this.level.trapAt(x, y);
      if (trap && !trap.revealed && ROT.RNG.getUniform() < find) { trap.revealed = true; found++; this.log.add(`You spot a hidden ${this.trapName(trap.kind)}!`, "sys"); }
      if (this.level.tileAt(x, y) === "doorHidden" && ROT.RNG.getUniform() < find) { this.level.tiles[y][x] = "doorClosed"; found++; this.log.add("You uncover a hidden door!", "sys"); this.recomputeFOV(); }
      if (trap && trap.revealed && (dx !== 0 || dy !== 0) && ROT.RNG.getUniform() < disarm) {
        this.level.traps = this.level.traps.filter((t) => t !== trap); disarmed++;
        this.log.add(`${this.sub(p)} ${this.verbS(p, "disarm")} the ${this.trapName(trap.kind)}.`, "good");
      }
    }
    if (!found && !disarmed) this.log.add("You search around. Nothing hidden here.", "dim");
    this.draw();
    return true;
  }

  /** Apply a touchstone (appraiser's loupe): identify every unappraised gem in the pack. */
  appraiseGems(p: Player): boolean {
    const seen = new Set<string>();
    const gems = p.inventory.items.filter((it) => it.type.kind === "gem" && !this.ident.isKnown(it.type));
    if (!gems.length) { this.log.add("You have no unappraised gems.", "dim"); return false; }
    for (const g of gems) {
      if (seen.has(g.type.id)) continue; seen.add(g.type.id);
      this.ident.learn(g.type);
      const real = (g.type.value ?? 0) > 0;
      this.log.add(`You rub it on the loupe — it's ${this.ident.name(g.type)}${real ? " (genuine!)" : " (worthless glass)"}.`, real ? "good" : "dim");
    }
    return true;
  }

  /** The Marketmaker appraises + buys every gem you carry: real ones for their value, glass for a pittance.
   *  Returns the appraisal line (and pays gold), or null if you carry no gems. */
  private sellGems(p: Player): string | null {
    const gems = p.inventory.items.filter((it) => it.type.kind === "gem");
    if (!gems.length) return null;
    let gold = 0; const real: string[] = []; let glass = 0;
    for (const g of gems) {
      this.ident.learn(g.type);
      const v = g.type.value ?? 0;
      if (v > 0) { gold += v; real.push(this.ident.name(g.type)); } else { glass++; gold += 1; }
      p.inventory.remove(g);
    }
    p.gold += gold;
    this.breakConduct(p, "bankless"); // dealing at the market ends Bankless
    const parts: string[] = [];
    if (real.length) parts.push(`${real.join(", ")} — genuine`);
    if (glass) parts.push(`${glass} worthless ${glass > 1 ? "shards" : "shard"} of glass`);
    return `The Marketmaker appraises your stones (${parts.join("; ")}) and slides ${gold} gold across. (${p.gold} total)`;
  }

  /** The Oracle's consultation: pay gold for guidance. A major (rich purse) buys a real hint; a minor
   *  buys a cryptic rumor; the penniless get a free mutter. Returns the spoken line. */
  private oracleConsult(p: Player): string {
    if (p.gold >= 150) {
      const fee = Math.max(120, Math.round(p.gold * 0.2));
      p.gold -= fee; this.breakConduct(p, "bankless");
      return `The Oracle accepts ${fee} gold for a major consultation: "${ROT.RNG.getItem(ORACLE_HINTS)!}" (${p.gold} left)`;
    }
    if (p.gold >= 30) {
      const fee = Math.min(p.gold, 25 + ROT.RNG.getUniformInt(0, 20));
      p.gold -= fee; this.breakConduct(p, "bankless");
      return `The Oracle accepts ${fee} gold for a minor consultation: "${ROT.RNG.getItem(ORACLE_RUMORS)!}" (${p.gold} left)`;
    }
    return `The Oracle eyes your thin purse. "Return with coin, seeker." Then, unbidden: "${ROT.RNG.getItem(ORACLE_RUMORS)!}"`;
  }

  /** `c` — chat with an adjacent monster. A free social action; lore, banter, or a taunt. */
  chat(m: Monster): void {
    const d = m.def;
    let line: string;
    if (d.seer) {
      line = m.peaceful ? this.oracleConsult(this.acting) : "The Oracle, struck and bleeding, screams curses — the springs run red.";
    } else if (d.keeper) {
      const sale = m.peaceful ? this.sellGems(this.acting) : null; // a peaceful keeper appraises + buys any gems you carry
      line = !m.peaceful
        ? "\"THIEF! You'll settle this in blood, not blocks!\""
        : sale ?? ROT.RNG.getItem([
            "\"Welcome, anon. Pay the bill and the goods are yours — lift them and I'll have your keys.\"",
            "\"Coin on the counter, goods in your pack. No credit, no exceptions.\"",
            "\"I make markets in everything but trust. That, you bring yourself.\"",
          ])!;
    } else if (d.boss) {
      line = ROT.RNG.getItem([
        `${cap(m.name)} regards you coldly: \"You are an unconfirmed transaction. I am finality.\"`,
        `${cap(m.name)} sneers: \"Turn back, validator. The JAM is not for the likes of you.\"`,
      ])!;
    } else if (d.name.includes("oracle")) {
      line = "The oracle intones: " + ROT.RNG.getItem([
        "\"Seek the vibrating square where consensus trembles.\"",
        "\"Three relics gate the Genesis: the Sigil, the Seal, and the Spec.\"",
        "\"A blessed audit proofs your armour against the rust of forks.\"",
        "\"The Censor fears only a finalized block — and a sharp blade.\"",
      ])!;
    } else if (m.peaceful) {
      line = ROT.RNG.getItem([
        `${cap(m.name)} nods to you and keeps watch.`,
        `${cap(m.name)} murmurs, \"We nominate the same cause, friend.\"`,
      ])!;
    } else if (d.cowardly) {
      line = `${cap(m.name)} whimpers, \"I'm just exit liquidity, please — don't!\"`;
    } else if (d.steals) {
      line = `${cap(m.name)} grins, eyeing your pack. \"Nice keys. Be a shame if they got... rugged.\"`;
    } else {
      line = ROT.RNG.getItem([
        `${cap(m.name)} snarls and pays you no heed.`,
        `${cap(m.name)} hisses something in raw bytecode.`,
        `${cap(m.name)} bares its teeth — no words, only malice.`,
      ])!;
    }
    this.log.add(line, m.peaceful ? "sys" : "dim");
  }

  /** `/` — identify a glyph from the symbol legend (a free lookup). */
  whatIs(key: string): void {
    const feat: Record<string, string> = {
      "@": "the adventurer — you, or a fellow delver",
      "#": "a wall (or, just maybe, a hidden door — search it)",
      "·": "ordinary floor", ".": "ordinary floor",
      "'": "an open doorway",
      "+": "a closed door — or a spellbook (a runtime to study)",
      ">": "a staircase down toward the JAM (a copper > is a branch-stair into the Mines)", "<": "a staircase up",
      "_": "an altar — offer a corpse (O) here for favor", "Ω": "an XCM portal to a parachain realm",
      "{": "a testnet faucet — q to quaff it", "\\": "the Sudo Throne — s to sit on it",
      "≈": "the vibrating square — perform the Invocation (I) here with the three relics",
      "}": "open water — impassable; cross by a causeway or an XCM jump",
      "0": "a boulder — walk into it to shove it", "§": "a warding engraving",
      ")": "a weapon", "[": "a piece of armor", "(": "a tool, or a chest",
      "!": "a potion", "?": "a scroll", "=": "a ring", "/": "a wand",
      "\"": "an amulet — W to wear it, T to take it off",
      "%": "food — or a corpse you can eat (e)", "*": "the JAM, a luckstone, or a gem",
      "$": "a pile of gold — step on it to scoop it up",
    };
    const mons = [...MONSTERS, SHOPKEEPER, PRIEST, COUNCIL_GUARD, ORACLE, HONEYPOT, CENSOR, MOLOCH, ...Object.values(MINIBOSSES), ...BRANCHES.flatMap((b) => (b.bossDef ? [b.bossDef] : []))].find((m) => m.ch === key);
    const parts: string[] = [];
    if (mons) parts.push(mons.name);
    if (feat[key]) parts.push(feat[key]);
    if (parts.length === 0) { this.log.add(`'${key}' isn't a symbol you recognize.`, "dim"); return; }
    this.log.add(`${key} — ${parts.join("; or ")}.`, "sys");
  }

  /** `;` — farlook the tile in a direction (monster, item, or terrain). A free survey. */
  lookAt(x: number, y: number): void {
    if (!this.level.tileAt(x, y)) { this.log.add("That's beyond the dungeon's edge.", "dim"); return; }
    const m = this.monsterAt(x, y);
    if (m && (m.revealed || !m.def.mimic)) {
      const r = m.hp / m.maxHp;
      const band = r >= 1 ? "unhurt" : r > 0.66 ? "lightly wounded" : r > 0.33 ? "moderately wounded" : r > 0.12 ? "heavily wounded" : "near death";
      const tags: string[] = [];
      if (m.peaceful) tags.push("peaceful"); else tags.push("hostile");
      if (m.def.boss || m.def.keeper) tags.push("formidable");
      if (m.def.ranged) tags.push("ranged");
      if (m.def.breath) tags.push("breath-weapon");
      if (m.def.summons) tags.push("summoner");
      if (m.def.heals) tags.push("healer");
      if (m.def.steals) tags.push("thief");
      if (m.def.breeds || m.def.splits) tags.push("breeder");
      if (m.def.corpseEffect === "petrify") tags.push("petrifying");
      if (m.def.drains) tags.push("life-draining");
      if (m.def.engulfs) tags.push("engulfing");
      if (m.def.silences) tags.push("silencing");
      if (m.def.drainsStat) tags.push("mind-draining");
      if (m.def.infects) tags.push("infectious");
      if (m.def.muse) tags.push("self-mending");
      if (m.def.zaps) tags.push("caster");
      if (m.def.throws) tags.push("thrower");
      if (m.worn > 0) tags.push("armored");
      if (m.def.diseases) tags.push("sickening");
      if (m.def.seduces) tags.push("seductive");
      if (m.sleepTurns > 0) tags.push("asleep");
      if (m.cancelled) tags.push("nullified");
      this.log.add(`You see ${m.name} — ${band} (${tags.join(", ")}).`, "sys");
      return;
    }
    const it = this.level.itemAt(x, y);
    if (it) {
      const what = it.corpse ? `the corpse of ${monName(it.corpse.def)}` : it.chest ? `a ${it.chest.locked ? "locked " : ""}chest` : this.ident.name(it.type);
      this.log.add(`You see ${what} lying there.`, "sys");
      return;
    }
    const trap = this.level.trapAt(x, y);
    if (trap && trap.revealed) { this.log.add(`You see a ${this.trapName(trap.kind)}.`, "sys"); return; }
    if (this.level.engravingAt(x, y)) { this.log.add("You see a warding engraving (§) scratched here.", "sys"); return; }
    if (this.level.boulderAt(x, y)) { this.log.add("You see a boulder (0).", "sys"); return; }
    const t = this.level.tileAt(x, y);
    const names: Partial<Record<TileType, string>> = {
      wall: "a wall", floor: "bare floor", door: "an open doorway", doorClosed: "a closed door",
      doorLocked: "a locked door", doorHidden: "a wall", stairsDown: "a staircase down",
      stairsUp: "a staircase up", altar: "an altar", portal: "an XCM portal", faucet: "a faucet",
      throne: "the Sudo Throne", vibrating: "the vibrating square — invoke (I) the ritual here",
      water: "open water — too deep to wade; find a causeway or jump (XCM)",
      branchDown: "a branch-stair into the Storage Caverns — > to descend",
      pit: "a chasm — impassable; shove a boulder into it to bridge across",
    };
    this.log.add(`You see ${names[t!] ?? "nothing notable"}.`, "dim");
  }

  /** Kick a locked door — Stake-weight (STR) decides if it bursts; sometimes you stub your foot. */
  kickDoor(p: Player, nx: number, ny: number): boolean {
    const chance = Math.max(0.15, 0.3 + abilityMod(p.str) * 0.08);
    if (ROT.RNG.getUniform() < chance) {
      this.level.tiles[ny][nx] = "door";
      this.recomputeFOV();
      this.log.add(`${this.sub(p)} ${this.verbS(p, "kick")} the door — it bursts open!`, "good");
    } else {
      this.log.add("The locked door holds fast. (kick again)", "dim");
      if (ROT.RNG.getUniform() < 0.15) { p.hp -= 1; this.log.add("Ow — your foot smarts.", "dim"); if (p.hp <= 0) this.killPlayer(p); }
    }
    this.draw();
    return true;
  }

  /** Quaff from a testnet faucet underfoot — a random boon or bane. */
  quaffFaucet(p: Player): boolean {
    const r = ROT.RNG.getUniform();
    if (r < 0.30) { const h = ROT.RNG.getUniformInt(4, 10); p.hp = Math.min(p.maxHp, p.hp + h); this.log.add(`Cool testnet water — refreshing. (+${h} HP)`, "good"); }
    else if (r < 0.50) { const spot = this.adjacentFree(p.x, p.y); if (spot) { const m = new Monster(this, MONSTERS[0], spot.x, spot.y); this.monsters.push(m); this.scheduler.add(m, true); } this.log.add("A faucet bot sloshes out of the pipes!", "bad"); }
    else if (r < 0.65) { this.log.add("The water is tainted!", "bad"); this.applyStatus(p, "poison"); }
    else if (r < 0.80) { if (!this.level.itemAt(p.x, p.y)) { this.level.items.push({ x: p.x, y: p.y, type: itemById("hodlstone")!, buc: rollBuc() }); this.log.add("You fish a HODL stone from the basin!", "good"); } else this.log.add("The water tastes of nothing.", "dim"); }
    else if (r < 0.90) { this.level.tiles[p.y][p.x] = "floor"; this.log.add("The faucet sputters and runs dry.", "dim"); }
    else this.log.add("You sip. Nothing happens.", "dim");
    if (p.hp <= 0) this.killPlayer(p);
    return true;
  }

  /** Quaff from a burn sink underfoot — foul, mostly; rarely a ring rattles loose in the pipes. */
  quaffSink(p: Player): boolean {
    const r = ROT.RNG.getUniform();
    if (r < 0.45) { this.log.add("You take a sip from the burn sink. Foul — that token was worthless.", "dim"); p.nutrition = Math.max(0, p.nutrition - 5); }
    else if (r < 0.62) { this.log.add("The sink quivers and rumbles — something's stuck in the drain. (kick it?)", "sys"); }
    else if (r < 0.78) { this.log.add("Acrid backwash from the burn address!", "bad"); this.applyStatus(p, "poison"); }
    else if (r < 0.90) { const spot = this.adjacentFree(p.x, p.y); if (spot) { const m = new Monster(this, MONSTERS[0], spot.x, spot.y); this.monsters.push(m); this.scheduler.add(m, true); } this.log.add("A sludge bot crawls up out of the drain!", "bad"); }
    else { this.log.add("You quaff. The pipes gurgle. Nothing.", "dim"); }
    if (p.hp <= 0) this.killPlayer(p);
    return true;
  }

  /** Kick a burn sink — the classic gamble: a ring may rattle loose, or you just stub your boot. */
  private kickSink(p: Player, nx: number, ny: number): boolean {
    const r = ROT.RNG.getUniform();
    if (r < 0.22) {
      const rings = ITEMS.filter((i) => i.kind === "ring");
      const spot = this.level.itemAt(nx, ny) ? this.adjacentFreeFloor(nx, ny) : { x: nx, y: ny };
      if (rings.length && spot) { this.level.items.push({ x: spot.x, y: spot.y, type: ROT.RNG.getItem(rings)!, buc: rollBuc() }); this.log.add("Clang! A ring rattles loose from the drain.", "good"); }
      else this.log.add("Clang! The pipes shudder but yield nothing.", "dim");
    } else if (r < 0.42) { const spot = this.adjacentFree(p.x, p.y); if (spot) { const m = new Monster(this, MONSTERS[0], spot.x, spot.y); this.monsters.push(m); this.scheduler.add(m, true); } this.log.add("Your kick dislodges a sludge bot!", "bad"); }
    else { this.log.add("You kick the burn sink. Clang — and your foot smarts.", "dim"); if (ROT.RNG.getUniform() < 0.4) { p.hp -= 1; if (p.hp <= 0) this.killPlayer(p); } }
    this.draw();
    return true;
  }

  /** Sit the Sudo Throne underfoot — raw privilege, for better or worse. */
  sitThrone(p: Player): boolean {
    this.breakConduct(p, "atheist"); // claiming a throne ends Self-custodian
    const r = ROT.RNG.getUniform();
    if (r < 0.25) { p.hp = p.maxHp; p.luck = Math.min(13, p.luck + 1); this.log.add(`${this.sub(p)} ${this.verbS(p, "sit")} the Sudo Throne — power flows. (full HP, Fortune up)`, "good"); }
    else if (r < 0.40) { const eq = [p.weapon, ...p.wornArmor, p.ring].filter((x): x is Item => !!x && x.buc !== "cursed"); if (eq.length) { const it = ROT.RNG.getItem(eq)!; it.buc = "cursed"; it.bucKnown = true; p.recomputeAC(); p.applyWeapon(); this.log.add(`A surge of raw sudo — your ${this.ident.name(it.type)} is cursed!`, "bad"); } else this.log.add("A jolt of sudo finds no purchase.", "dim"); }
    else if (r < 0.55) { let pos = this.level.randomFloor(), t = 0; while (t < 40 && (this.monsterAt(pos.x, pos.y) || this.level.tileAt(pos.x, pos.y) === "stairsDown")) { pos = this.level.randomFloor(); t++; } p.x = pos.x; p.y = pos.y; this.recomputeFOV(); this.log.add("The throne flings you across the level!", "bad"); }
    else if (r < 0.70) { for (const it of p.inventory.items) this.ident.learn(it.type); this.log.add("Privileged insight — your pack is identified.", "sys"); }
    else if (r < 0.82) { this.gainXp(p, Math.max(10, this.xpForLevel(p.level + 1) - p.xp + 1), false); this.log.add("Authority flows into you — you feel experienced.", "good"); }
    else if (r < 0.92) { const spot = this.adjacentFree(p.x, p.y); if (spot) { const def = ROT.RNG.getItem(MONSTERS.filter((m) => m.weight > 0))!; this.monsters.push(new Monster(this, def, spot.x, spot.y)); this.scheduler.add(this.monsters[this.monsters.length - 1], true); } this.log.add("A throne guardian materializes!", "bad"); }
    else { this.level.tiles[p.y][p.x] = "floor"; this.log.add("The throne crumbles to dust beneath you.", "dim"); }
    if (p.hp <= 0) this.killPlayer(p);
    return true;
  }

  pray(): void {
    const p = this.acting;
    if (p.prayerCooldown > 0) { this.wrath(p); return; } // praying too soon angers him
    p.prayerCooldown = 130;
    p.hp = p.maxHp;
    p.nutrition = Math.max(p.nutrition, 600);
    p.poison = 0; p.confused = 0; p.silenced = 0;
    const drained = Object.entries(p.statDrain).filter(([, n]) => n > 0);
    if (drained.length) { for (const [a, n] of drained) (p as unknown as Record<string, number>)[a] += n; p.statDrain = {}; this.recomputeEnergy(p); this.log.add("Your drained faculties are restored.", "good"); }
    if (p.lycanthrope) { p.lycanthrope = null; if (p.polyForm) this.revertPoly(p, true); this.log.add("The wildness is purged — you are wholly yourself again.", "good"); }
    if (p.stoning > 0 || p.illness > 0) { p.stoning = 0; p.illness = 0; this.log.add("The petrifying chill / the bad block lifts.", "good"); }
    if (p.blind > 0) { p.blind = 0; this.recomputeFOV(); }
    if (p.luck < 0) { p.luck = 0; this.log.add("Gavin steadies your fortune.", "good"); }
    this.log.add("Gavin, the Architect, hears you. You are made whole.", "good");
    // Gavin lifts the curses binding your worn gear.
    const bound = [p.weapon, ...p.wornArmor, p.ring].filter((it): it is Item => !!it && it.buc === "cursed");
    if (bound.length) {
      for (const it of bound) { it.buc = "uncursed"; it.bucKnown = true; }
      p.applyWeapon(); p.recomputeAC();
      this.log.add("Welds loosen — the curses on your gear are lifted.", "good");
    }
    // Gavin also burnishes away rust and corrosion from your worn gear.
    let repaired = 0;
    for (const it of [p.weapon, ...p.wornArmor].filter((x): x is Item => !!x)) if (it.erosion) { it.erosion = 0; repaired++; }
    if (repaired) { p.recomputeAC(); p.applyWeapon(); this.log.add("Rust and corrosion flake away — your gear is restored.", "good"); }
    if (ROT.RNG.getUniform() < 0.4) {
      for (const it of p.inventory.items) this.ident.learn(it.type);
      this.log.add("Truth is revealed — your pack is identified.", "sys");
    }
    p.favor += 1;
    this.maybeCrown(p);
    this.draw();
  }

  /** Praying before the cooldown lapses — Gavin's displeasure: smite, curse, or sour your luck. */
  private wrath(p: Player): void {
    this.log.add(`${this.sub(p)} ${this.verbS(p, "pray")} too soon — Gavin is wroth!`, "bad");
    p.favor = Math.max(0, p.favor - 2);
    const r = ROT.RNG.getUniform();
    if (r < 0.5) {
      const d = ROT.RNG.getUniformInt(4, 10); p.hp -= d;
      this.log.add(`A bolt of displeasure strikes ${p.name === "you" ? "you" : p.name} for ${d}.`, "bad");
      if (p.hp <= 0) this.killPlayer(p);
    } else if (r < 0.8) {
      const eq = [p.weapon, ...p.wornArmor, p.ring].filter((x): x is Item => !!x && x.buc !== "cursed");
      if (eq.length) { const it = ROT.RNG.getItem(eq)!; it.buc = "cursed"; it.bucKnown = true; p.recomputeAC(); p.applyWeapon(); this.log.add(`Your ${this.ident.name(it.type)} is cursed by his glare!`, "bad"); }
      else this.log.add("His glare chills you to the bone.", "bad");
    } else {
      p.luck = Math.max(-13, p.luck - 2);
      this.log.add("Your Fortune sours under his gaze.", "bad");
    }
    this.draw();
  }

  /** When favored, Gavin may induct you into the Technical Fellowship — a rank, a gift, Fortune, and a boon. */
  private maybeCrown(p: Player): void {
    if (p.crowned || p.favor < 8 || ROT.RNG.getUniform() > 0.5) return;
    p.crowned = true;
    // Fellowship ranks, flavored by ethos.
    const rank: Record<string, string> = { Order: "Architect", Balance: "Fellow", Chaos: "Adept" };
    p.title = rank[p.ethos] ?? "Fellow";
    this.log.add(`✦ Gavin inducts ${p.name === "you" ? "you" : p.name} into the Technical Fellowship — rise, ${p.title}! ✦`, "sys");
    p.luck = Math.min(13, p.luck + 3);
    p.intrinsics.add("poisonResist");
    if (!this.level.itemAt(p.x, p.y)) {
      const prize = ROT.RNG.getItem(ITEMS.filter((i) => isGear(i)))!;
      this.level.items.push({ x: p.x, y: p.y, type: prize, enchant: 3, buc: "blessed", bucKnown: true });
      this.log.add(`A blessed ${prize.name} +3 manifests at your feet — your crowning gift.`, "good");
    }
  }

  /** Offer a corpse (on or beside a Gavin altar) — burn it for the Architect's favor: Fortune, and rarely a gift. */
  offerCorpse(p: Player): boolean {
    if (this.level.tileAt(p.x, p.y) !== "altar") { this.log.add("You can only make an offering at a Gavin altar (_).", "dim"); return false; }
    // The Genesis Plane: offer the JAM on your aligned altar of pure intent — the true ascension.
    if (this.plane === PLANES.length && p.hasJam) {
      const altar = this.genesisAltars.find((g) => g.x === p.x && g.y === p.y);
      if (altar && altar.ethos === p.ethos) {
        this.log.add(`You lay the ${fp("Amulet", "JAM")} upon the ${ethosName(altar.ethos)} altar of pure intent. It dissolves into first light.`, "good");
        this.win(p);
        return true;
      }
      // wrong-aligned altar: rejected, blasted, and a guardian erupts — find your own altar
      this.log.add(`The ${altar ? ethosName(altar.ethos) : "alien"} altar flares and REJECTS your offering — this is not your alignment (${ethosName(p.ethos)}). Seek your own.`, "bad");
      const dmg = ROT.RNG.getUniformInt(5, 12); p.hp -= dmg;
      this.log.add(`Reproachful fire scours you for ${dmg}.`, "bad");
      const spot = this.adjacentFree(p.x, p.y);
      if (spot) { const deep = MONSTERS.filter((m) => (m.minDepth ?? 1) >= 9); const m = new Monster(this, ROT.RNG.getItem(deep.length ? deep : MONSTERS)!, spot.x, spot.y); this.monsters.push(m); this.scheduler.add(m, true); }
      if (p.hp <= 0) this.killPlayer(p);
      this.draw();
      return true;
    }
    let fi = this.level.items.find((i) => i.corpse && i.x === p.x && i.y === p.y);
    if (!fi) {
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]] as [number, number][]) {
        const c = this.level.items.find((i) => i.corpse && i.x === p.x + dx && i.y === p.y + dy);
        if (c) { fi = c; break; }
      }
    }
    if (!fi || !fi.corpse) { this.log.add("There's no corpse on or beside the altar to offer. (kill something near it)", "dim"); return false; }
    this.breakConduct(p, "atheist"); // sacrificing at an altar ends Self-custodian
    const rotten = this.turn - fi.corpse.born > 60;
    const name = monName(fi.corpse.def);
    this.level.items = this.level.items.filter((i) => i !== fi);
    if (rotten) {
      p.luck = Math.max(-13, p.luck - 1);
      this.log.add(`You burn the rotten ${name} on the altar — Gavin is unimpressed. (Fortune dips)`, "bad");
      return true;
    }
    p.luck = Math.min(13, p.luck + 1);
    p.favor += 2;
    this.log.add(`You burn the ${name} on the altar as an offering. Gavin's favor warms you. (Fortune rises)`, "good");
    this.maybeCrown(p);
    const r = ROT.RNG.getUniform();
    if (r < 0.06 && !this.level.itemAt(p.x, p.y)) {
      const prize = ROT.RNG.getItem(ITEMS.filter((i) => isGear(i)))!;
      this.level.items.push({ x: p.x, y: p.y, type: prize, enchant: ROT.RNG.getUniformInt(1, 2), buc: "blessed", bucKnown: true });
      this.log.add(`✦ Gavin bestows a gift upon the altar — a blessed ${prize.name}!`, "sys");
    } else if (r < 0.22) {
      p.hp = Math.min(p.maxHp, p.hp + ROT.RNG.getUniformInt(4, 10));
      this.log.add("A wave of finality mends you.", "good");
    }
    return true;
  }

  /** Scratch a warding sigil (a Gray-Paper clause) at your feet; ordinary foes shrink from the tile. */
  engrave(): boolean {
    const p = this.acting;
    const t = this.level.tileAt(p.x, p.y);
    if (t !== "floor" && t !== "door") { this.log.add("There's no dust here to scratch a sigil into.", "dim"); return false; }
    this.breakConduct(p, "illiterate"); // writing words ends Illiterate
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

  private win(winner?: Player): void {
    if (this.over) return;
    this.over = true;
    this.engine.lock(); // halt the scheduler — otherwise it spins on the (promise-less) monsters
    const w = winner ?? this.player;
    if (this.coop) {
      this.log.add(`✦ ${cap(w.name)} carries the JAM into the light — the party ASCENDS together. You win! ✦`, "good");
    } else {
      this.log.add("✦ You climb into the light, the JAM blazing in your grasp. ✦", "good");
      this.log.add("ASCENSION! The chain needs no master. You have won, Seeker.", "sys");
    }
    this.conductReport(w);
    this.log.add("Press R to begin a new descent.", "dim");
    this.music.playStinger("ascend");
    this.draw();
    void this.recordResult(true);
    void this.mintDeed(w);
    void this.showHallOfFame();
  }

  /** On a true ascension, mint the winner's soulbound Deed of Ascension (their own wallet pays). */
  private async mintDeed(w: Player): Promise<void> {
    if (!this.wallet) { return; }
    if (!deedConfigured()) { this.log.add("(deploy AscendDeed to mint your soulbound Deed of Ascension)", "dim"); return; }
    const existing = await readDeed(this.wallet.address);
    if (existing) { this.log.add(`Your soulbound Deed of Ascension (#${existing.tokenId}) already adorns this wallet.`, "good"); return; }
    this.log.add("Confirm in your wallet to mint your soulbound Deed of Ascension…", "sys"); this.draw();
    const r = await claimDeed(this.wallet.provider, w.maxDepthReached, w.level, (h) => this.log.add(`Minting deed… ${h.slice(0, 10)}…`, "dim"));
    if (r.ok) this.log.add("✦ A soulbound Deed of Ascension is minted to your wallet — proof, forever, that you ascended. It cannot be sold, only earned. ✦", "good");
    else this.log.add(`Deed mint: ${r.error}`, "dim");
    this.draw();
  }

  private gameOver(): void {
    if (this.over) return;
    this.over = true;
    this.engine.lock(); // stop the engine looping forever over the surviving monsters (no player promise → freeze)
    this.player.hp = 0;
    this.log.add(ROT.RNG.getItem(deaths())!, "bad", "both");
    this.log.add(`You fell at depth ${this.player.depth} (deepest ${this.player.maxDepthReached}). Press R to try again.`, "sys", "both");
    this.conductReport(this.player);
    this.music.playStinger("death");
    this.draw();
    void this.recordResult(false);
    void this.showHallOfFame();
  }

  // ── on-chain persistence (Phase 4) ─────────────────────────────────────────
  private async recordResult(won: boolean): Promise<void> {
    if (!this.wallet) return; // on-chain run records are deferred — to be reintroduced in a later update
    const depth = won ? GEHENNOM_BOTTOM : this.player.maxDepthReached; // a win means wresting the JAM from the bottom
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

  // ── the Treasury vault (NetHack vault + guard) ───────────────────────────────
  /** Carve a sealed vault into the rock (~18% of cozy floors, d3+) and heap it with gold. Teleport-in only. */
  private placeVault(): void {
    if (this.acting.depth < 3 || ROT.RNG.getUniform() > 0.18) return;
    if (!this.level.placeVault() || !this.level.vault) return;
    const v = this.level.vault;
    const piles = [{ x: v.x0, y: v.y0 }, { x: v.x1, y: v.y1 }]; // a couple of fat hoards
    for (const s of piles) if (!this.level.itemAt(s.x, s.y)) this.level.items.push({ x: s.x, y: s.y, type: GOLD, coins: ROT.RNG.getUniformInt(120, 280) + this.acting.depth * 30 });
  }

  /** The vault guardian flow: spawn the Council Guard when an adventurer teleports into the Treasury;
   *  it cuts an exit and escorts them out; once they're clear it reseals and departs. */
  checkVault(): void {
    if (!this.level.vault) return;
    const inside = this.playersHere().some((p) => this.level.inVault(p.x, p.y));
    if (inside && (!this.vaultGuard || !this.vaultGuard.alive)) {
      this.level.openVaultExit();
      const v = this.level.vault;
      const spot = this.level.vaultBreach[0] ?? { x: v.x0, y: v.y0 };
      const g = new Monster(this, COUNCIL_GUARD, spot.x, spot.y);
      g.peaceful = true;
      this.monsters.push(g); this.scheduler.add(g, true);
      this.vaultGuard = g;
      this.recomputeFOV();
      this.log.add("\"HALT. This is the Treasury — you've no business here.\" A Council Guard cuts a passage and beckons you out. (leave, and the gold is yours)", "sys");
      this.draw();
    } else if (!inside && this.vaultGuard && this.vaultGuard.alive && this.vaultGuard.peaceful && this.level.vaultBreach.length) {
      // escorted out cleanly — the guard reseals the Treasury and withdraws
      for (const b of this.level.vaultBreach) if (!this.monsterAt(b.x, b.y) && !this.playerAt(b.x, b.y) && !this.level.itemAt(b.x, b.y)) this.level.tiles[b.y][b.x] = "wall";
      this.level.vaultBreach = [];
      const gi = this.monsters.indexOf(this.vaultGuard); if (gi >= 0) this.monsters.splice(gi, 1);
      this.scheduler.remove(this.vaultGuard); this.vaultGuard = null;
      this.recomputeFOV();
      this.log.add("The Council Guard seals the Treasury behind you and is gone.", "dim");
      this.draw();
    }
  }

  // ── combat ─────────────────────────────────────────────────────────────────
  attack(a: Entity, d: Entity): void {
    // Per-player log routing: an attack belongs to the player(s) involved (a monster's turn leaves
    // this.acting stale, so address the line explicitly).
    const who: LogWho = a instanceof Player && d instanceof Player ? "both" : d instanceof Player ? d : a instanceof Player ? a : "both";
    // Touching a disguised honeypot springs the trap — it sheds its loot form.
    if (d instanceof Monster && d.def.mimic && !d.revealed) {
      d.revealed = true;
      const lure = d.disguiseType ? this.ident.name(d.disguiseType) : "the loot";
      this.log.add(`${cap(lure)} you reached for lurches alive — it's a honeypot! A mimic.`, "bad", who);
    }
    // Striking a peaceful shopkeeper provokes it — now it fights to the death.
    if (d instanceof Monster && d.def.keeper && d.peaceful) {
      d.peaceful = false; d.fg = "#ff5030";
      this.log.add("The Marketmaker roars \"Bad debt!\" and turns lethal.", "bad", who);
    }
    // Striking a peaceful priest desecrates the shrine — it abandons restraint.
    if (d instanceof Monster && d.def.priest && d.peaceful) {
      d.peaceful = false; d.fg = "#ff5030";
      this.log.add("The priest's blessing curdles to wrath — \"Sacrilege!\"", "bad", who);
    }
    // Striking the Oracle profanes her springs — the seer turns on you.
    if (d instanceof Monster && d.def.seer && d.peaceful) {
      d.peaceful = false; d.fg = "#ff5030";
      this.log.add("You strike the Oracle — \"Fool! The springs will remember this.\"", "bad", who);
    }
    // Striking the Council Guard ends the escort — now it means to see you never leave.
    if (d instanceof Monster && d.def.guard && d.peaceful) {
      d.peaceful = false; d.fg = "#ff5030"; this.vaultGuard = null;
      this.log.add("The Council Guard's patience snaps — \"Then you'll not leave at all!\"", "bad", who);
    }
    // A d20 to-hit layer: level + DEX + enchant vs the target's dodge. Misses happen now.
    if (!this.lands(a, d)) {
      if (a instanceof Player && d instanceof Monster) this.log.add(`${this.sub(a)} ${this.verbS(a, "miss")} ${d.name}.`, "dim", who);
      else if (a instanceof Monster && d instanceof Player) this.log.add(`${cap(a.name)} misses ${d.name}.`, "dim", who);
      return;
    }
    // Fighting on a warded tile scuffs the sigil away faster.
    if (a instanceof Player) { const e = this.level.engravingAt(a.x, a.y); if (e) e.life -= 3; }
    const [lo, hi] = a.attackDmg;
    let dmg = ROT.RNG.getUniformInt(lo, hi);
    if (a instanceof Player) dmg = Math.max(1, dmg + abilityMod(a.str) + this.skillDmgBonus(a) + a.ringDmg); // Stake-weight + trained skill + a ring of damage drive the blow
    d.hp -= dmg;
    if (a instanceof Player && d instanceof Monster) this.noteSkillHit(a); // a landed blow trains the weapon's skill
    // A rust/corrosion striker (rust bug) eats away a random worn piece on a hit.
    if (a instanceof Monster && !a.cancelled && a.def.corrodes && d instanceof Player) this.corrodeArmor(d);
    if (a instanceof Player && d instanceof Monster) this.log.add(`${this.sub(a)} ${this.verbS(a, "strike")} ${d.name} for ${dmg}.`, "good", who);
    else if (a instanceof Monster && d instanceof Player) {
      this.log.add(`${cap(a.name)} hits ${d.name} for ${dmg}.`, "bad", who);
      if (!a.cancelled && a.def.inflict && d.hp > 0 && ROT.RNG.getUniform() < 0.3) this.applyStatus(d, a.def.inflict);
      if (!a.cancelled && a.def.stealsLuck && d.hp > 0 && d.luck > -13 && ROT.RNG.getUniform() < 0.5) {
        d.luck = Math.max(-13, d.luck - 1);
        this.log.add(`${cap(a.name)} leeches your Fortune — doubt creeps in.`, "bad", who);
      }
      if (!a.cancelled && a.def.drains && d.hp > 0 && !d.intrinsics.has("drainResist") && ROT.RNG.getUniform() < 0.33) this.drainLevel(d, a.name);
      if (a.def.engulfs && d.hp > 0 && !d.engulfedBy) {
        d.engulfedBy = a;
        this.log.add(`${cap(a.name)} engulfs ${d.name} — swallowed whole! (move in any direction to struggle free)`, "bad", who);
      }
      if (!a.cancelled && a.def.silences && d.hp > 0 && d.silenced === 0 && ROT.RNG.getUniform() < 0.4) {
        d.silenced = ROT.RNG.getUniformInt(6, 11);
        this.log.add(`${cap(a.name)} smothers ${d.name} in silence — your voice is gone!`, "bad", who);
      }
      if (!a.cancelled && a.def.drainsStat && d.hp > 0 && ROT.RNG.getUniform() < 0.4) this.drainStat(d, a.name);
      if (a.def.infects && d.hp > 0 && !d.lycanthrope && ROT.RNG.getUniform() < 0.25) {
        d.lycanthrope = a.def;
        this.log.add(`${cap(a.name)}'s bite festers — you've been forked! A wildness takes root in you. (pray to cure)`, "bad", who);
      }
      if (!a.cancelled && a.def.diseases && d.hp > 0 && d.illness === 0 && ROT.RNG.getUniform() < 0.3) {
        d.illness = ROT.RNG.getUniformInt(10, 16);
        this.log.add(`${cap(a.name)} infects ${d.name} — you sicken! (cure it before it's fatal)`, "bad", who);
      }
    }
    else if (a instanceof Player && d instanceof Player) this.log.add(`${this.sub(a)} ${this.verbS(a, "strike")} ${d.name} for ${dmg} — friendly fire!`, "bad", who);
    else if (a === this.pet) this.log.add(`Your nominator savages ${d.name} for ${dmg}.`, "good", who);
    else if (d === this.pet) this.log.add(`${cap(a.name)} mauls ${this.pet?.name ?? fp("your hound", "your nominator")} for ${dmg}.`, "bad", who);
    if (d.hp <= 0) {
      if (a instanceof Player && d instanceof Monster) this.gainXp(a, d.maxHp); // XP = the foe's vitality
      this.kill(d);
    }
    // #twoweapon: a lighter off-hand follow-up if the foe still stands.
    if (a instanceof Player && d instanceof Monster && d.alive && a.offhand) {
      if (ROT.RNG.getUniform() < 0.5 + this.skillAccBonus(a) * 0.05) {
        const [olo, ohi] = a.offhand.type.dmg ?? [1, 2];
        const od = Math.max(1, Math.floor(ROT.RNG.getUniformInt(olo, ohi) / 2) + (a.offhand.enchant ?? 0));
        d.hp -= od;
        this.log.add(`${this.sub(a)} ${this.verbS(a, "follow")} up with the off-hand ${this.ident.name(a.offhand.type)} for ${od}.`, "good", who);
        if (d.hp <= 0) { this.gainXp(a, d.maxHp); this.kill(d); }
      } else this.log.add("Your off-hand swing goes wide.", "dim", who);
    }
    // A watcher eye's gaze: melee it and — if it survives the blow — its stare freezes you in place.
    if (a instanceof Player && d instanceof Monster && d.alive && d.def.paralyzes && a.paralyzed === 0 && !a.freeAction) {
      a.paralyzed = ROT.RNG.getUniformInt(3, 6);
      this.log.add(`${cap(d.name)} fixes ${a.name} with its gaze — frozen, helpless!`, "bad", a);
    }
  }

  /** d20 to-hit: nat 20 always lands, nat 1 always misses; else roll + accuracy ≥ 10 + dodge.
   *  Pet and monster-vs-monster swings always land (kept simple). */
  private lands(a: Entity, d: Entity): boolean {
    if (!(a instanceof Player) && !(d instanceof Player)) return true;
    const roll = ROT.RNG.getUniformInt(1, 20);
    if (roll === 20) return true;
    if (roll === 1) return false;
    let acc = 0, eva = 0;
    if (a instanceof Player) acc = a.level + abilityMod(a.dex) + (a.weapon?.enchant ?? 0) + this.skillAccBonus(a) + a.ringAcc - (a.blind > 0 ? 3 : 0) + Math.round(this.luckOf(a) / 3); // weapon mastery + a ring of accuracy + Fortune sway the roll; blind swings miss

    else if (a instanceof Monster) acc = 2 + Math.floor(a.maxHp / 8);
    if (d instanceof Player) eva = abilityMod(d.dex) + Math.floor(d.level / 3) + Math.floor(d.ac / 2) + Math.round(this.luckOf(d) / 3); // armor is dodge now; Fortune helps you slip
    else if (d instanceof Monster) eva = (d.def.speed ? Math.max(0, Math.floor((d.def.speed - 100) / 12)) : 0) + d.worn; // worn armor makes a monster harder to hit too
    return roll + acc >= 10 + eva;
  }

  /** Effective Fortune: base luck + a carried HODL stone (blessed +2 luckstone / cursed −2 loadstone). */
  luckOf(p: Player): number {
    let l = p.luck;
    for (const it of p.inventory.items) if (it.type.id === "hodlstone") l += it.buc === "blessed" ? 2 : it.buc === "cursed" ? -2 : 0;
    return Math.max(-13, Math.min(13, l));
  }

  // ── #enhance: weapon skills ──
  private weaponSkillClass(p: Player): string { return p.weapon?.type.skill ?? "martial"; }
  /** To-hit bonus from your trained rank with the wielded weapon's class. */
  skillAccBonus(p: Player): number { return p.skillRank[this.weaponSkillClass(p)] ?? 0; }
  /** A touch of extra damage at Skilled (+1) and Expert (+2). */
  skillDmgBonus(p: Player): number { const r = p.skillRank[this.weaponSkillClass(p)] ?? 0; return r >= 3 ? 2 : r >= 2 ? 1 : 0; }

  /** Tally a landed melee blow toward the wielded weapon's skill. */
  noteSkillHit(p: Player): void {
    const c = this.weaponSkillClass(p);
    p.skillXp[c] = (p.skillXp[c] ?? 0) + 1;
    const rank = p.skillRank[c] ?? 0;
    if (rank < 3 && p.skillXp[c] === SKILL_NEED[rank + 1]) this.log.add(`${this.sub(p)} ${this.verbS(p, "feel")} more practiced with ${SKILL_LABEL[c] ?? c}. (press x to #enhance)`, "sys");
  }

  /** `x` / #enhance — advance any ready skill a rank; otherwise show the skill sheet. A free action. */
  enhanceSkills(p: Player): void {
    const classes = Object.keys(p.skillXp);
    if (classes.length === 0) { this.log.add("You have landed no weapon blows yet — nothing to enhance.", "dim"); return; }
    let advanced = false;
    for (const c of classes) {
      const rank = p.skillRank[c] ?? 0;
      if (rank < 3 && (p.skillXp[c] ?? 0) >= SKILL_NEED[rank + 1]) {
        p.skillRank[c] = rank + 1; advanced = true;
        this.log.add(`${this.sub(p)} ${this.verbS(p, "advance")} to ${SKILL_RANKS[rank + 1]} with ${SKILL_LABEL[c] ?? c}!`, "good");
      }
    }
    if (advanced) { this.draw(); return; }
    this.log.add("— Weapon skills —", "sys");
    for (const c of classes) {
      const rank = p.skillRank[c] ?? 0, xp = p.skillXp[c] ?? 0;
      const next = rank < 3 ? ` (${xp}/${SKILL_NEED[rank + 1]} to ${SKILL_RANKS[rank + 1]})` : " (maxed)";
      this.log.add(`  ${SKILL_LABEL[c] ?? c}: ${SKILL_RANKS[rank]}${next}`, "dim");
    }
  }

  /** Erode a random unproofed worn piece (rust/corrosion), reducing its evasion. */
  private corrodeArmor(p: Player): void {
    const targets = p.wornArmor.filter((it) => !it.proofed && (it.erosion ?? 0) < 3);
    if (targets.length === 0) return;
    const it = ROT.RNG.getItem(targets)!;
    it.erosion = (it.erosion ?? 0) + 1;
    p.recomputeAC();
    const tag = ["", "rusty", "corroded", "badly corroded"][it.erosion];
    this.log.add(`${p.name === "you" ? "Your" : p.name + "'s"} ${this.ident.name(it.type)} corrodes — now ${tag}.`, "bad");
  }

  /** Subject + verb agreement so the shared co-op log reads right ("You strike" / "Guest strikes"). */
  private sub(p: Player): string { return p.name === "you" ? "You" : cap(p.name); }
  private verbS(p: Player, base: string): string { return p.name === "you" ? base : base + "s"; }

  applyStatus(target: Player, kind: "poison" | "confuse"): void {
    if (kind === "poison" && (target.intrinsics.has("poisonResist") || target.ringPoisonRes)) { this.log.add(`${target.name === "you" ? "You resist" : target.name + " resists"} the toxin.`, "dim", target); return; }
    if (kind === "poison") { target.poison = Math.max(target.poison, 6); this.log.add(`${target.name === "you" ? "You are" : target.name + " is"} poisoned!`, "bad", target); }
    else { target.confused = Math.max(target.confused, 5); this.log.add(`${target.name === "you" ? "Your head spins" : target.name + "'s head spins"} — confused!`, "bad", target); }
  }

  /** A worn amulet of reflection rebounds rays/breath back at the source (works even cursed). */
  private reflects(p: Player): boolean { return p.amulet?.type.id === "amulet_reflect"; }

  /** A trapper digests the adventurer it has swallowed — direct damage, no escape unless you struggle. */
  digestEngulfed(m: Monster): boolean {
    const p = this.allPlayers().find((q) => q.alive && q.engulfedBy === m);
    if (!p) return false;
    if (Math.max(Math.abs(m.x - p.x), Math.abs(m.y - p.y)) > 1) { p.engulfedBy = null; return false; } // knocked apart — released
    const [lo, hi] = m.attackDmg;
    const d = ROT.RNG.getUniformInt(lo, hi);
    p.hp -= d;
    this.log.add(`${cap(m.name)} digests ${p.name} for ${d}!`, "bad", p);
    if (p.hp <= 0) this.killPlayer(p);
    return true;
  }

  /** Thrash against the trapper that swallowed you: a strike at it, plus a chance to wrench free. */
  struggleEngulf(p: Player): boolean {
    const m = p.engulfedBy;
    if (!m || !m.alive) { p.engulfedBy = null; return false; }
    if (Math.max(Math.abs(m.x - p.x), Math.abs(m.y - p.y)) > 1) { p.engulfedBy = null; return false; } // knocked apart — freed
    this.attack(p, m); // a swing from inside
    if (!m.alive) { p.engulfedBy = null; this.log.add(`${this.sub(p)} ${this.verbS(p, "cut")} free as ${m.name} dies!`, "good", p); return true; }
    const odds = 0.3 + Math.max(0, abilityMod(p.str)) * 0.06 + Math.max(0, abilityMod(p.dex)) * 0.04;
    if (ROT.RNG.getUniform() < odds) {
      p.engulfedBy = null;
      this.log.add(`${this.sub(p)} ${this.verbS(p, "wrench")} free of ${m.name}!`, "good", p);
    } else {
      this.log.add(`${this.sub(p)} ${this.verbS(p, "struggle")} against ${m.name}'s grip.`, "dim", p);
    }
    return true;
  }

  /** A ranged foe zaps the nearest party member (armor half-soaks; can still inflict status). */
  /** muse.c: a caster zaps a wand-borne debuff at the nearest party member (silence already gates it). */
  monsterZap(m: Monster, _p: Player): void {
    const p = this.nearestPlayer(m.x, m.y);
    const me = cap(m.name), you = p.name === "you";
    switch (m.def.zaps) {
      case "sleep":
        if (p.freeAction) { this.log.add(`${me} levels a wand at ${p.name} — but the sleep finds no purchase.`, "dim", p); return; }
        p.paralyzed = Math.max(p.paralyzed, ROT.RNG.getUniformInt(2, 4));
        this.log.add(`${me} zaps a wand of sleep — ${p.name} ${you ? "freeze" : "freezes"} stiff!`, "bad", p);
        break;
      case "blind":
        p.blind = Math.max(p.blind, ROT.RNG.getUniformInt(6, 12)); this.recomputeFOV();
        this.log.add(`${me} zaps a searing flash — ${p.name} ${you ? "are" : "is"} blinded!`, "bad", p);
        break;
      case "confuse":
        this.log.add(`${me} zaps a wand at ${p.name}.`, "bad", p);
        this.applyStatus(p, "confuse");
        break;
    }
  }

  /** muse.c: a cornered foe gulps a teleport draught and blinks far across the level to escape. */
  museTeleport(m: Monster, p: Player): void {
    let pos = this.level.randomFloor(), t = 0;
    while (t < 40 && (this.monsterAt(pos.x, pos.y) || this.playerAt(pos.x, pos.y) || Math.max(Math.abs(pos.x - p.x), Math.abs(pos.y - p.y)) < 6)) { pos = this.level.randomFloor(); t++; }
    m.x = pos.x; m.y = pos.y;
    this.log.add(`${cap(m.name)} gulps a draught and vanishes — blinked away!`, "bad", p);
  }

  /** mthrowu.c: a thrower hurls a dart or a rock at the nearest party member (armor half-soaks; a thrown
   *  dart sometimes clatters to the floor beside you to reclaim — a rock just shatters). */
  monsterThrow(m: Monster): void {
    const p = this.nearestPlayer(m.x, m.y);
    const [lo, hi] = m.attackDmg;
    let dmg = ROT.RNG.getUniformInt(lo, hi);
    if (p.ac > 0) dmg = Math.max(1, dmg - Math.floor(p.ac / 2));
    p.hp -= dmg;
    const proj = m.def.throws === "rock" ? "a boulder" : "a dart";
    this.log.add(`${cap(m.name)} hurls ${proj} at ${p.name} for ${dmg}!`, "bad", p);
    if (m.def.throws === "dart" && p.hp > 0 && ROT.RNG.getUniform() < 0.4) {
      const spot = this.adjacentFreeFloor(p.x, p.y);
      if (spot && !this.level.itemAt(spot.x, spot.y)) this.level.items.push({ x: spot.x, y: spot.y, type: itemById("dagger")!, buc: "uncursed", bucKnown: true });
    }
    if (p.hp <= 0) this.kill(p);
  }

  rangedAttack(a: Monster): void {
    const p = this.nearestPlayer(a.x, a.y);
    const [lo, hi] = a.attackDmg;
    let dmg = ROT.RNG.getUniformInt(lo, hi);
    if (this.reflects(p)) { // the bolt caroms off the mirror, straight back at the caster
      p.amulet!.bucKnown = true;
      a.hp -= dmg;
      this.log.add(`${cap(a.name)}'s bolt rebounds off ${p.name === "you" ? "your" : p.name + "'s"} mirror — ${dmg} back at it!`, "good", p);
      if (a.hp <= 0) this.kill(a);
      return;
    }
    if (p.ac > 0) dmg = Math.max(1, dmg - Math.floor(p.ac / 2));
    p.hp -= dmg;
    this.log.add(`${cap(a.name)} zaps ${p.name} from afar for ${dmg}!`, "bad", p);
    if (a.def.inflict && p.hp > 0 && ROT.RNG.getUniform() < 0.3) this.applyStatus(p, a.def.inflict);
    if (p.hp <= 0) this.kill(p);
  }

  /** A dragon breathes a damaging ray down the line toward the nearest party member. */
  breathAttack(m: Monster): void {
    const p = this.nearestPlayer(m.x, m.y);
    const dx = Math.sign(p.x - m.x), dy = Math.sign(p.y - m.y);
    if (dx === 0 && dy === 0) return;
    this.log.add(`${cap(m.name)} breathes a searing gout of finality!`, "bad", p);
    const max = m.def.breath ?? 10;
    this.castRay(m.x, m.y, dx, dy, 6, (e) => {
      if (e === m) return;
      const d = ROT.RNG.getUniformInt(Math.floor(max / 2), max);
      if (e instanceof Player && this.reflects(e)) { // the breath rebounds off the mirror onto the dragon
        e.amulet!.bucKnown = true;
        m.hp -= d;
        this.log.add(`The breath rebounds off ${e.name === "you" ? "your" : e.name + "'s"} mirror, searing ${m.name} for ${d}!`, "good", e);
        if (m.hp <= 0) this.kill(m);
        return;
      }
      e.hp -= d;
      if (e instanceof Player) { this.log.add(`The breath sears ${e.name} for ${d}!`, "bad", e); if (e.hp <= 0) this.killPlayer(e); }
      else if (e instanceof Monster && e.hp <= 0) this.kill(e);
    });
  }

  /** A breeder multiplies into an adjacent free cell — capped per kind so it can't runaway-swarm. */
  breedNear(m: Monster): boolean {
    const kin = this.monsters.reduce((n, o) => n + (o.alive && o.def === m.def ? 1 : 0), 0);
    if (kin >= 10 || this.monsters.length >= 30) return false;
    const offs = ROT.RNG.shuffle([[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]] as [number, number][]);
    for (const [dx, dy] of offs) {
      const nx = m.x + dx, ny = m.y + dy;
      if (this.level.isPassable(nx, ny) && !this.monsterAt(nx, ny) && !this.playerAt(nx, ny) && !this.level.boulderAt(nx, ny)) {
        const s = new Monster(this, m.def, nx, ny);
        this.monsters.push(s); this.scheduler.add(s, true);
        this.log.add(`${cap(m.name)} multiplies!`, "bad");
        return true;
      }
    }
    return false;
  }

  /** A conjurer summons a depth-appropriate ally into an adjacent free cell. */
  summonNear(m: Monster): boolean {
    if (this.monsters.length >= 30) return false;
    const offs = ROT.RNG.shuffle([[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]] as [number, number][]);
    for (const [dx, dy] of offs) {
      const nx = m.x + dx, ny = m.y + dy;
      if (this.level.isPassable(nx, ny) && !this.monsterAt(nx, ny) && !this.playerAt(nx, ny) && !this.level.boulderAt(nx, ny)) {
        const pool = MONSTERS.filter((d) => d.weight > 0 && d.minDepth <= this.player.depth && !d.breath && !d.summons);
        const def = ROT.RNG.getItem(pool) ?? MONSTERS[0];
        const s = new Monster(this, def, nx, ny);
        this.monsters.push(s); this.scheduler.add(s, true);
        this.log.add(`${cap(m.name)} conjures ${def.name}!`, "bad");
        return true;
      }
    }
    return false;
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

  killPlayer(p: Player = this.player): void {
    // A fork collapsing isn't death — you snap back to your true (saved) HP and may survive.
    if (p.polyForm) {
      this.revertPoly(p);
      this.log.add(`${this.sub(p)} ${this.verbS(p, "collapse")} out of the fork.`, "bad", p);
      if (p.hp > 0) return;
    }
    // An amulet of life saving spends itself to pull you back from a lethal blow (crumbles, even if cursed).
    if (p.amulet?.type.id === "amulet_life") {
      const am = p.amulet;
      am.bucKnown = true; p.amulet = null; p.inventory.remove(am);
      p.hp = p.maxHp; p.poison = 0; p.stoning = 0; p.illness = 0; // and the worst afflictions are purged
      this.log.add(`As you fall, ${this.ident.name(am.type)} flares white-hot and crumbles to dust — your life is wrenched back!`, "good", p);
      this.draw();
      return;
    }
    this.downPlayer(p);
  }

  /** A player falls. Solo (or last to fall) → game over; in co-op the survivor fights on. */
  private downPlayer(p: Player): void {
    if (DEBUG && this.godMode) { p.hp = p.maxHp; this.log.add("[DEBUG] godmode — death negated.", "sys"); this.draw(); return; } // ── DEBUG (remove for release) ──
    if (p.hp > 0) p.hp = 0; // a downed player is simply at 0 HP (alive is hp > 0)
    if (this.downed.has(p)) return;
    this.downed.add(p);
    this.scheduler.remove(p);
    if (this.livingPlayers().length === 0) { this.gameOver(); return; }
    this.log.add(`${cap(p.name)} falls! The other adventurer presses on — recover the JAM.`, "bad", "both");
    this.draw();
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

  /** Scatter a few piles of gold across the floor (the main coin source). */
  private placeGold(): void {
    const loot = this.currentChain?.loot ?? 1;
    const n = ROT.RNG.getUniformInt(1, 3) + (this.player.depth >= 6 ? 1 : 0);
    for (let i = 0; i < n; i++) {
      if (ROT.RNG.getUniform() > 0.75 * loot) continue; // not every roll lands a pile
      let pos = this.level.randomFloor(), tries = 0;
      while (tries < 30 && (this.level.itemAt(pos.x, pos.y) || (pos.x === this.player.x && pos.y === this.player.y) || this.level.tileAt(pos.x, pos.y) === "stairsDown")) { pos = this.level.randomFloor(); tries++; }
      if (tries >= 30) continue;
      const amount = Math.round((ROT.RNG.getUniformInt(4, 12) + this.player.depth * ROT.RNG.getUniformInt(1, 3)) * loot);
      this.level.items.push({ x: pos.x, y: pos.y, type: GOLD, coins: amount });
    }
  }

  /** Scoop up a gold pile underfoot. */
  collectGold(p: Player, fi: FloorItem): void {
    p.gold += fi.coins ?? 0;
    this.level.items = this.level.items.filter((i) => i !== fi);
    this.log.add(`${this.sub(p)} ${this.verbS(p, "scoop")} up ${fi.coins} gold. (${p.gold} total)`, "good");
  }

  /** Drop a little gold where a monster fell (depth-scaled). */
  private dropGold(x: number, y: number): void {
    if (ROT.RNG.getUniform() > 0.5) return; // only some foes carry coin
    const amount = ROT.RNG.getUniformInt(1, 3 + this.player.depth);
    const spot = this.level.itemAt(x, y) ? this.adjacentFreeFloor(x, y) : { x, y };
    if (spot) this.level.items.push({ x: spot.x, y: spot.y, type: GOLD, coins: amount });
  }

  /** A passable floor cell adjacent to (x,y) with no item, for dropping loot. */
  private adjacentFreeFloor(x: number, y: number): { x: number; y: number } | null {
    for (const [dx, dy] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]] as [number, number][]) {
      const nx = x + dx, ny = y + dy;
      if (this.level.isPassable(nx, ny) && !this.level.itemAt(nx, ny)) return { x: nx, y: ny };
    }
    return null;
  }

  /** A thief snatches a random pack item (unequipping it if worn/wielded). Returns it, or null if the pack is bare. */
  stealItem(target: Player): Item | null {
    const p = target;
    if (p.inventory.items.length === 0) return null;
    const it = ROT.RNG.getItem(p.inventory.items)!;
    if (p.weapon === it) { p.weapon = null; p.applyWeapon(); }
    if (p.offhand === it) p.offhand = null;
    if (p.quiver === it) p.quiver = null;
    if (p.wornArmor.includes(it)) { p.wornArmor = p.wornArmor.filter((a) => a !== it); p.recomputeAC(); }
    if (p.ring === it) { p.applyRing(it, false); p.ring = null; }
    if (p.amulet === it) p.amulet = null;
    p.inventory.remove(it);
    return it;
  }

  /** An airdrop farmer grabs a fistful of the player's gold. Returns the amount taken. */
  stealGold(target: Player): number {
    const take = Math.min(target.gold, ROT.RNG.getUniformInt(8, 25) + Math.floor(target.gold / 3));
    target.gold -= take;
    return take;
  }

  /** Add an item to the pack, rolling wand charges. NFT relics carry enchant + a relic mark; every item gets a BUC. */
  giveItem(type: ItemType, opts?: { enchant?: number; relic?: boolean; buc?: Buc; bucKnown?: boolean }): Item {
    const it = this.acting.inventory.add(type);
    if (type.kind === "wand") it.charges = type.id === "wand_wish" ? ROT.RNG.getUniformInt(1, 2) : ROT.RNG.getUniformInt(3, 6); // wishes are precious
    if (type.id === "marker") it.charges = ROT.RNG.getUniformInt(2, 4); // a contract deployer's gas
    if (type.id === "trickbag") it.charges = ROT.RNG.getUniformInt(5, 12); // a faucet bag's stored monsters
    if (type.id === "camera") it.charges = ROT.RNG.getUniformInt(3, 6); // a snapshot camera's film
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
    let x = this.acting.x, y = this.acting.y;
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
          if (hit.hp <= 0) { this.gainXp(this.acting, hit.maxHp); this.kill(hit); }
        } else if (t.effect === "heal") {
          hit.hp = Math.min(hit.maxHp, hit.hp + ROT.RNG.getUniformInt(8, 14));
          this.log.add(`The ${t.name} splashes ${hit.name} — you mend it by mistake!`, "bad");
        } else if (t.effect === "blind") {
          hit.blindTurns = ROT.RNG.getUniformInt(8, 14);
          this.log.add(`The ${t.name} bursts over ${hit.name} — blinded, it gropes about.`, "good");
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
      if (hit.hp <= 0) { this.gainXp(this.acting, hit.maxHp); this.kill(hit); }
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
      let x = this.acting.x, y = this.acting.y, dug = 0;
      for (let step = 0; step < 8 && dug < 4; step++) {
        x += dx; y += dy;
        if (x < 1 || y < 1 || x >= W - 1 || y >= MAP_H - 1) break; // keep the border intact
        if (this.level.tileAt(x, y) === "wall") { this.level.tiles[y][x] = "floor"; dug++; }
      }
      this.log.add(dug ? `You bore through ${dug} wall${dug > 1 ? "s" : ""}.` : "The wand of digging finds no wall.", dug ? "good" : "dim");
      this.recomputeFOV();
    } else if (item.type.id === "wand_fire") {
      // A bouncing fire ray — it sears everything in its path, including you if it caroms back.
      this.castRay(this.acting.x, this.acting.y, dx, dy, 9, (e) => {
        const d = ROT.RNG.getUniformInt(6, 12); e.hp -= d;
        this.log.add(e instanceof Player ? `The firebolt scorches ${e.name} for ${d}!` : `The firebolt sears ${e.name} for ${d}.`, e instanceof Player ? "bad" : "good");
        if (e.hp <= 0) { if (e instanceof Monster) this.gainXp(this.acting, e.maxHp); this.kill(e); }
      });
    } else if (item.type.id === "wand_cold") {
      this.castRay(this.acting.x, this.acting.y, dx, dy, 9, (e) => {
        const d = ROT.RNG.getUniformInt(5, 11); e.hp -= d;
        this.log.add(e instanceof Player ? `A lance of cold rakes ${e.name} for ${d}!` : `A lance of cold freezes ${e.name} for ${d}.`, e instanceof Player ? "bad" : "good");
        if (e instanceof Monster && e.alive && ROT.RNG.getUniform() < 0.4) { e.speedMod = 0.5; this.scheduler.remove(e); this.scheduler.add(e, true); } // the chill slows it
        if (e.hp <= 0) { if (e instanceof Monster) this.gainXp(this.acting, e.maxHp); this.kill(e); }
      });
    } else if (item.type.id === "wand_lightning") {
      this.castRay(this.acting.x, this.acting.y, dx, dy, 9, (e) => {
        const d = ROT.RNG.getUniformInt(7, 13); e.hp -= d;
        this.log.add(e instanceof Player ? `Lightning forks through ${e.name} for ${d}!` : `Lightning blasts ${e.name} for ${d}.`, e instanceof Player ? "bad" : "good");
        if (e instanceof Player && e.hp > 0 && ROT.RNG.getUniform() < 0.4) { e.blind = Math.max(e.blind, 8); this.recomputeFOV(); } // the flash blinds you if it caroms back
        if (e.hp <= 0) { if (e instanceof Monster) this.gainXp(this.acting, e.maxHp); this.kill(e); }
      });
    } else if (item.type.id === "wand_missile") {
      this.castRay(this.acting.x, this.acting.y, dx, dy, 9, (e) => {
        const d = ROT.RNG.getUniformInt(6, 10); e.hp -= d;
        this.log.add(e instanceof Player ? `Force missiles batter ${e.name} for ${d}!` : `Force missiles batter ${e.name} for ${d}.`, e instanceof Player ? "bad" : "good");
        if (e.hp <= 0) { if (e instanceof Monster) this.gainXp(this.acting, e.maxHp); this.kill(e); }
      });
    } else if (item.type.id === "wand_open") {
      const fi = this.level.itemAt(this.acting.x, this.acting.y);
      if (fi?.chest?.locked) { fi.chest.locked = false; this.log.add("The chest's lock springs open. (o to open)", "good"); }
      else {
        let x = this.acting.x, y = this.acting.y, done = false;
        for (let step = 0; step < 8 && !done; step++) { x += dx; y += dy; const t = this.level.tileAt(x, y); if (t === "doorLocked" || t === "doorClosed") { this.level.tiles[y][x] = "door"; this.recomputeFOV(); this.log.add("A lock clicks — the door swings open.", "good"); done = true; } else if (t === "wall" || t == null) break; }
        if (!done) this.log.add("The wand of opening finds no lock to spring.", "dim");
      }
    } else if (item.type.id === "wand_light") {
      const R = 6, a = this.acting;
      for (let yy = a.y - R; yy <= a.y + R; yy++) for (let xx = a.x - R; xx <= a.x + R; xx++) {
        if (xx >= 0 && yy >= 0 && xx < W && yy < MAP_H && this.level.tileAt(xx, yy) && Math.max(Math.abs(xx - a.x), Math.abs(yy - a.y)) <= R) this.level.lit[yy][xx] = true;
      }
      this.recomputeFOV();
      this.log.add("Brilliant light floods out — the dark recoils.", "good");
    } else if (item.type.id === "wand_secret") {
      let found = 0;
      for (let yy = 0; yy < MAP_H; yy++) for (let xx = 0; xx < W; xx++) if (this.level.tileAt(xx, yy) === "doorHidden") { this.level.tiles[yy][xx] = "doorClosed"; found++; }
      for (const tr of this.level.traps) if (!tr.revealed) { tr.revealed = true; tr.detected = true; found++; }
      this.recomputeFOV();
      this.log.add(found ? `Hidden things shimmer into view — ${found} secret(s) revealed.` : "The wand of scanning finds nothing hidden here.", found ? "sys" : "dim");
    } else if (item.type.id === "wand_create") {
      // Conjures depth-appropriate foes around the zapper — no aim, and rarely a boon.
      const n = ROT.RNG.getUniformInt(1, 3); let made = 0;
      for (let i = 0; i < n; i++) {
        const spot = this.adjacentFree(this.acting.x, this.acting.y);
        if (!spot) break;
        const m = new Monster(this, this.pickMonster(this.acting.depth), spot.x, spot.y);
        this.monsters.push(m); this.scheduler.add(m, true); made++;
      }
      this.log.add(made ? `The wand of spawning hums — ${made} shape${made > 1 ? "s" : ""} coalesce${made > 1 ? "" : "s"} out of the aether!` : "The wand of spawning hums, but there's no room for anything to form.", made ? "bad" : "dim");
    } else {
      let x = this.acting.x, y = this.acting.y;
      let hit: Monster | undefined;
      for (let step = 0; step < 10; step++) {
        x += dx; y += dy;
        if (!this.level.isPassable(x, y) || this.level.boulderAt(x, y)) break; // a boulder stops a bolt
        const m = this.monsterAt(x, y); if (m) { hit = m; break; }
      }
      if (!hit) {
        this.log.add(`The ${item.type.name} fizzles into the dark.`, "dim");
      } else if (item.type.id === "wand_bolt" || item.type.id === "art_compiler") {
        const strong = item.type.id === "art_compiler";
        const d = strong ? ROT.RNG.getUniformInt(12, 20) : ROT.RNG.getUniformInt(8, 14); hit.hp -= d;
        this.log.add(`${strong ? "The Genesis Compiler discharges raw genesis into" : "A bolt of finality strikes"} ${hit.name} for ${d}.`, "good");
        if (hit.hp <= 0) { this.gainXp(this.acting, hit.maxHp); this.kill(hit); }
      } else if (item.type.id === "wand_death") {
        if (hit.def.boss) { const d = ROT.RNG.getUniformInt(30, 50); hit.hp -= d; this.log.add(`A ray of pure finality tears into ${hit.name} for ${d} — it endures.`, "good"); }
        else { this.log.add(`A ray of pure finality unwrites ${hit.name} — it is simply gone.`, "good"); hit.hp = 0; }
        if (hit.hp <= 0) { this.gainXp(this.acting, hit.maxHp); this.kill(hit); }
      } else if (item.type.id === "wand_banish") {
        let pos = this.level.randomFloor(), t = 0;
        while (t < 40 && (this.monsterAt(pos.x, pos.y) || this.playerAt(pos.x, pos.y))) { pos = this.level.randomFloor(); t++; }
        hit.x = pos.x; hit.y = pos.y;
        this.log.add(`${cap(hit.name)} is banished across the chain.`, "good");
      } else if (item.type.id === "wand_slow") {
        hit.speedMod = 0.5;
        this.scheduler.remove(hit); this.scheduler.add(hit, true); // re-time at the slower speed
        this.log.add(`${cap(hit.name)} slows to a crawl.`, "good");
      } else if (item.type.id === "wand_sleep") {
        hit.sleepTurns = ROT.RNG.getUniformInt(5, 10);
        this.log.add(`${cap(hit.name)} freezes in stasis.`, "good");
      } else if (item.type.id === "wand_poly") {
        const old = hit.name;
        const pool = MONSTERS.filter((m) => m.weight > 0 && m !== hit!.def);
        const nd = ROT.RNG.getItem(pool)!;
        hit.def = nd; hit.ch = nd.ch; hit.fg = nd.fg; hit.name = nd.name;
        hit.hp = hit.maxHp = nd.hp; hit.attackDmg = nd.dmg;
        hit.splitsLeft = nd.splits ? 2 : 0; hit.cancelled = false; hit.sleepTurns = 0; hit.speedMod = 1;
        this.scheduler.remove(hit); this.scheduler.add(hit, true);
        this.log.add(`${cap(old)} is forked into ${nd.name}!`, "sys");
      } else if (item.type.id === "wand_speed") {
        hit.speedMod = Math.max(hit.speedMod, 1.5);
        this.scheduler.remove(hit); this.scheduler.add(hit, true); // re-time at the faster speed
        this.log.add(`${cap(hit.name)} blurs into a faster gear.`, hit.peaceful || hit === this.pet ? "good" : "bad");
      } else if (item.type.id === "wand_invis") {
        hit.invisible = true;
        this.log.add(`${cap(hit.name)} shimmers and vanishes from sight.`, hit === this.pet ? "good" : "bad");
      } else if (item.type.id === "wand_silence") {
        hit.silenced = ROT.RNG.getUniformInt(8, 14);
        this.log.add(`${cap(hit.name)} is wrapped in silence — its voice fails.`, "good");
      } else if (item.type.id === "wand_cancel") {
        hit.cancelled = true;
        this.log.add(`${cap(hit.name)} is nullified — its powers fail.`, "good");
      } else if (item.type.id === "wand_probe") {
        const tr = [hit.def.inflict && `inflicts ${hit.def.inflict}`, hit.def.ranged && "ranged", hit.def.steals && "thief", hit.def.stealsGold && "gold thief", hit.def.stealsLuck && "Fortune leech", hit.def.drains && "life-draining", hit.def.engulfs && "engulfing", hit.def.silences && "silencing", hit.def.drainsStat && "mind-draining", hit.def.infects && "infectious", hit.def.muse && "self-mending", hit.def.zaps && "caster", hit.def.throws && "thrower", hit.def.diseases && "sickening", hit.def.seduces && "seductive", hit.def.paralyzes && "paralyzing gaze", hit.def.splits && "splits", hit.def.corrodes && "corrodes", hit.cancelled && "nullified", hit.worn > 0 && "armored"].filter(Boolean).join(", ");
        this.log.add(`State-read ${hit.name}: ${hit.hp}/${hit.maxHp} HP${tr ? " · " + tr : ""}.`, "sys");
      }
    }

    if (item.charges <= 0) { this.acting.inventory.remove(item); this.log.add(`The ${item.type.name} crumbles to dust.`, "dim"); }
    this.draw();
  }

  /** Trace a ray that bounces off walls, calling onHit for each entity (monster or player)
   *  it passes through — so a careless shot down a short corridor can carom back onto you. */
  private castRay(sx: number, sy: number, dx: number, dy: number, range: number, onHit: (e: Entity) => void): void {
    let x = sx, y = sy;
    for (let step = 0; step < range; step++) {
      let nx = x + dx, ny = y + dy;
      if (!this.level.isPassable(nx, ny)) {
        const bx = !this.level.isPassable(x + dx, y);
        const by = !this.level.isPassable(x, y + dy);
        if (bx) dx = -dx;
        if (by) dy = -dy;
        if (!bx && !by) { dx = -dx; dy = -dy; } // dead-on into a corner — reverse
        nx = x + dx; ny = y + dy;
        if (!this.level.isPassable(nx, ny)) break; // boxed in
      }
      x = nx; y = ny;
      const bldr = this.level.boulderAt(x, y);
      if (bldr) { this.level.boulders = this.level.boulders.filter((z) => z !== bldr); this.log.add("A boulder shatters under the blast.", "dim"); break; } // the ray spends itself
      const m = this.monsterAt(x, y); if (m && m.alive) onHit(m);
      const pl = this.playerAt(x, y); if (pl) onHit(pl);
    }
  }

  // ── spellcasting (Phase 8a) ──────────────────────────────────────────────────
  private recomputeEnergy(p: Player): void { p.maxEnergy = 5 + p.level * 2 + Math.max(0, abilityMod(p.int)) * 3; }
  /** Throughput (INT) + epoch drive spell success; costlier spells are harder. */
  private castChance(p: Player, cost: number): number {
    return Math.max(0.25, Math.min(0.97, 0.5 + abilityMod(p.int) * 0.07 + p.level * 0.02 - cost * 0.01));
  }

  /** Study a runtime (spellbook) to learn its extrinsic — INT-gated, retryable. */
  studySpellbook(book: Item): boolean {
    const sid = book.type.teaches;
    const s = sid ? spellById(sid) : undefined;
    if (!sid || !s) { this.log.add("There's nothing to study here.", "dim"); return false; }
    const p = this.acting;
    this.breakConduct(p, "illiterate"); // studying a runtime ends Illiterate
    if (p.spells.has(sid)) { this.log.add(`You already grok ${s.name}.`, "dim"); return true; }
    const chance = Math.max(0.2, Math.min(0.95, 0.35 + abilityMod(p.int) * 0.08 + p.level * 0.03));
    if (ROT.RNG.getUniform() < chance) {
      p.spells.add(sid);
      this.log.add(`${this.sub(p)} ${this.verbS(p, "grok")} ${s.name}. (Z to cast)`, "good");
    } else {
      this.log.add(`The runtime's logic eludes ${p.name === "you" ? "you" : p.name} — study fails. Try again.`, "bad");
    }
    return true; // studying spends the turn either way
  }

  /** Cast a known extrinsic. Returns true if the turn (and energy) were spent. */
  castSpell(id: string, dx: number, dy: number): boolean {
    const p = this.acting;
    const s = spellById(id);
    if (!s || !p.spells.has(id)) { this.log.add("You don't know that extrinsic.", "dim"); return false; }
    if (p.silenced > 0) { this.log.add(`${this.sub(p)} ${this.verbS(p, "mouth")} the extrinsic, but no sound comes — silenced!`, "bad"); return false; }
    if (p.energy < s.cost) { this.log.add(`Not enough energy — ${s.name} needs ${s.cost}.`, "bad"); return false; }
    p.energy -= s.cost;
    if (ROT.RNG.getUniform() > this.castChance(p, s.cost)) {
      this.log.add(`${this.sub(p)} ${this.verbS(p, "fumble")} ${s.name} — it fizzles.`, "dim");
      this.draw(); return true;
    }
    switch (id) {
      case "bolt": {
        let x = p.x, y = p.y; let hit: Monster | undefined;
        for (let step = 0; step < 10; step++) { x += dx; y += dy; if (!this.level.isPassable(x, y) || this.level.boulderAt(x, y)) break; const m = this.monsterAt(x, y); if (m) { hit = m; break; } }
        if (!hit) this.log.add("The finality bolt streaks into the dark.", "dim");
        else { const d = ROT.RNG.getUniformInt(6, 12); hit.hp -= d; this.log.add(`Finality bolt strikes ${hit.name} for ${d}.`, "good"); if (hit.hp <= 0) { this.gainXp(p, hit.maxHp); this.kill(hit); } }
        break;
      }
      case "heal": { const h = ROT.RNG.getUniformInt(8, 16) + Math.max(0, abilityMod(p.int)); p.hp = Math.min(p.maxHp, p.hp + h); this.log.add(`${this.sub(p)} ${this.verbS(p, "mend")} ${h} HP.`, "good"); break; }
      case "map": { this.level.revealAll(); this.log.add("A light client reveals the whole level.", "sys"); break; }
      case "sense": { p.senseTurns = Math.max(p.senseTurns, 12); this.log.add(`${this.sub(p)} ${this.verbS(p, "sense")} the minds around ${p.name === "you" ? "you" : "them"}.`, "sys"); break; }
      case "tele": { let pos = this.level.randomFloor(), t = 0; while (t < 40 && (this.monsterAt(pos.x, pos.y) || this.level.tileAt(pos.x, pos.y) === "stairsDown")) { pos = this.level.randomFloor(); t++; } p.x = pos.x; p.y = pos.y; this.recomputeFOV(); this.log.add(`${this.sub(p)} XCM-${this.verbS(p, "jump")} across the level.`, "sys"); break; }
      case "haste": { p.hasteTurns = Math.max(p.hasteTurns, 20); this.scheduler.remove(p); this.scheduler.add(p, true); this.log.add(`${this.sub(p)} ${this.verbS(p, "overclock")}! (haste)`, "good"); break; }
      case "fireball": {
        this.castRay(p.x, p.y, dx, dy, 8, (e) => {
          const d = ROT.RNG.getUniformInt(7, 14); e.hp -= d;
          this.log.add(e instanceof Player ? `The fireball scorches ${e.name} for ${d}!` : `The fireball engulfs ${e.name} for ${d}.`, e instanceof Player ? "bad" : "good");
          if (e.hp <= 0) { if (e instanceof Monster) this.gainXp(p, e.maxHp); this.kill(e); }
        });
        break;
      }
      case "cure": this.applyEffect("cure", "blessed"); break;
      case "detect": this.applyEffect("detect_obj"); break;
      case "uncurse": this.applyEffect("uncurse"); break;
      case "dig": {
        let x = p.x, y = p.y, dug = 0;
        for (let step = 0; step < 8 && dug < 4; step++) { x += dx; y += dy; if (x < 1 || y < 1 || x >= W - 1 || y >= MAP_H - 1) break; if (this.level.tileAt(x, y) === "wall") { this.level.tiles[y][x] = "floor"; dug++; } }
        this.log.add(dug ? `Raw force bores through ${dug} wall${dug > 1 ? "s" : ""}.` : "The dig spell finds only open air.", dug ? "good" : "dim");
        if (dug) this.recomputeFOV();
        break;
      }
      case "slow": { const hit = this.firstMonsterInDir(p, dx, dy); if (hit) { hit.speedMod = 0.5; this.scheduler.remove(hit); this.scheduler.add(hit, true); this.log.add(`${cap(hit.name)} slows to a crawl.`, "good"); } else this.log.add("The throttle finds nothing.", "dim"); break; }
      case "sleep": { const hit = this.firstMonsterInDir(p, dx, dy); if (hit) { hit.sleepTurns = ROT.RNG.getUniformInt(5, 10); this.log.add(`${cap(hit.name)} freezes in stasis.`, "good"); } else this.log.add("The stasis field grips nothing.", "dim"); break; }
      case "turn": {
        let n = 0;
        for (const m of [...this.monsters]) {
          if (!m.alive || m.peaceful || Math.max(Math.abs(m.x - p.x), Math.abs(m.y - p.y)) > 4) continue;
          const demonish = m.def.fearless || m.def.summons || /demon|fiend|imp|wraith|lich|daemon|undead|kraken/i.test(m.def.name);
          const d = ROT.RNG.getUniformInt(4, 9) + (demonish ? 6 : 0); m.hp -= d; n++;
          if (m.hp <= 0) { this.gainXp(p, m.maxHp); this.kill(m); }
        }
        this.log.add(n ? `A wave of finality scours ${n} nearby foe${n > 1 ? "s" : ""} — the unfinalized recoil.` : "You slash at the unfinalized — but none are near.", n ? "good" : "dim");
        break;
      }
    }
    this.draw();
    return true;
  }

  /** Scan a straight line from the caster and return the first monster struck (for directional spells). */
  private firstMonsterInDir(p: Player, dx: number, dy: number): Monster | undefined {
    let x = p.x, y = p.y;
    for (let step = 0; step < 10; step++) { x += dx; y += dy; if (!this.level.isPassable(x, y) || this.level.boulderAt(x, y)) break; const m = this.monsterAt(x, y); if (m) return m; }
    return undefined;
  }

  // ── polymorph self / "fork" (Phase 8b) ──────────────────────────────────────
  /** Hard-fork into a monster form: its glyph, attacks, speed, and HP pool, for a while. */
  polySelf(p: Player, form?: MonsterDef): void {
    if (p.polyForm) this.revertPoly(p, true);
    const f = form ?? ROT.RNG.getItem(MONSTERS.filter((m) => m.weight > 0))!;
    p.polyForm = f;
    p.polyTurns = ROT.RNG.getUniformInt(20, 40);
    p.savedHp = p.hp; p.savedMaxHp = p.maxHp;
    p.maxHp = f.hp; p.hp = f.hp;
    p.attackDmg = f.dmg;
    this.log.add(`${this.sub(p)} ${this.verbS(p, "hard-fork")} into ${f.name}!`, "sys");
  }

  /** Lycanthropy: while infected, a small chance each turn to involuntarily shift into the were-beast
   *  (unless already in a form). The fork reverts on its own; the infection persists until cured. */
  tickLycanthropy(p: Player): void {
    if (!p.lycanthrope || p.polyForm || !p.alive) return;
    if (ROT.RNG.getUniform() < 0.04) {
      this.log.add(`${this.sub(p)} ${this.verbS(p, "convulse")} — the change takes you, against your will!`, "bad", p);
      this.polySelf(p, p.lycanthrope);
    }
  }

  /** Snap back to your true form, restoring your real HP pool. */
  revertPoly(p: Player, silent = false): void {
    if (!p.polyForm) return;
    p.polyForm = null; p.polyTurns = 0;
    p.maxHp = p.savedMaxHp;
    p.hp = Math.min(p.savedHp, p.savedMaxHp);
    p.applyWeapon();
    if (!silent) this.log.add(`${this.sub(p)} ${this.verbS(p, "snap")} back to ${p.name === "you" ? "your" : "their"} true form.`, "sys");
  }

  // ── tools (the `apply` command, Phase 7c) ────────────────────────────────────
  /** Sound an auditor's horn (unicorn horn): clear afflictions + a little mend. Returns false if there's nothing to fix. */
  /** `a` an indexer (crystal ball) — gaze to reveal every mind on the floor. INT + Fortune + BUC gate
   *  success; a failed gaze swims and confuses, and a cursed ball dazzles you outright. Reusable. */
  applyCrystalBall(p: Player, ball: Item): boolean {
    if (p.blind > 0) { this.log.add("You can't gaze into the indexer — you're blind.", "dim"); return false; }
    ball.bucKnown = true;
    const buc = ball.buc ?? "uncursed";
    const bonus = buc === "blessed" ? 0.2 : buc === "cursed" ? -0.25 : 0;
    const chance = Math.max(0.1, Math.min(0.95, 0.45 + abilityMod(p.int) * 0.08 + this.luckOf(p) * 0.02 + bonus));
    if (ROT.RNG.getUniform() < chance) {
      p.senseTurns = Math.max(p.senseTurns, buc === "blessed" ? 40 : 25);
      this.recomputeFOV();
      this.log.add("You gaze into the indexer — every mind on this floor lights up before you.", "good");
      return true;
    }
    if (buc === "cursed") {
      p.confused = Math.max(p.confused, ROT.RNG.getUniformInt(4, 8));
      p.blind = Math.max(p.blind, ROT.RNG.getUniformInt(2, 5));
      this.log.add("The indexer flares with a malign light — dazzled and reeling, you tear your eyes away.", "bad");
    } else {
      p.confused = Math.max(p.confused, ROT.RNG.getUniformInt(2, 5));
      this.log.add("The swirling depths of the indexer dizzy you — you look away, confused.", "bad");
    }
    return true;
  }

  applyHorn(p: Player): boolean {
    if (p.poison === 0 && p.confused === 0 && p.stoning === 0 && p.illness === 0 && p.blind === 0 && p.paralyzed === 0 && p.silenced === 0 && p.hp >= p.maxHp) {
      this.log.add("The auditor's horn finds nothing amiss.", "dim"); return false;
    }
    p.poison = 0; p.confused = 0; p.stoning = 0; p.illness = 0; p.blind = 0; p.paralyzed = 0; p.silenced = 0;
    p.hp = Math.min(p.maxHp, p.hp + ROT.RNG.getUniformInt(2, 6));
    this.recomputeFOV();
    this.log.add(`${this.sub(p)} ${this.verbS(p, "sound")} the auditor's horn — afflictions clear.`, "good");
    return true;
  }

  /** Upend a faucet bag (bag of tricks) — spit a depth-appropriate foe into an open neighbour. Charged. */
  applyTrickbag(p: Player, bag: Item): boolean {
    if (!bag.charges || bag.charges <= 0) { this.log.add("You shake the faucet bag — limp and empty.", "dim"); return true; }
    const spot = this.adjacentFree(p.x, p.y);
    if (!spot) { this.log.add("The faucet bag bulges, but there's nowhere for what's inside to land.", "dim"); return false; }
    bag.charges--;
    const def = this.pickMonster(p.depth);
    const m = new Monster(this, def, spot.x, spot.y);
    this.monsters.push(m); this.scheduler.add(m, true);
    this.log.add(`You upend the faucet bag — ${def.name} tumbles out!`, "bad");
    this.draw();
    return true;
  }

  /** Apply a directional tool (excavator digs walls; state reader probes an adjacent foe). */
  applyTool(item: Item, dx: number, dy: number): boolean {
    const p = this.acting;
    if (item.type.id === "pickaxe") {
      let x = p.x, y = p.y, dug = 0;
      for (let step = 0; step < 6 && dug < 3; step++) {
        x += dx; y += dy;
        if (x < 1 || y < 1 || x >= W - 1 || y >= MAP_H - 1) break;
        if (this.level.tileAt(x, y) === "wall") { this.level.tiles[y][x] = "floor"; dug++; }
      }
      this.log.add(dug ? `${this.sub(p)} ${this.verbS(p, "hew")} through ${dug} wall${dug > 1 ? "s" : ""} with the excavator.` : "Nothing to dig there.", dug ? "good" : "dim");
      if (dug) this.recomputeFOV();
      return true; // a swing of the pick spends the turn either way
    }
    if (item.type.id === "scope") {
      const m = this.monsterAt(p.x + dx, p.y + dy);
      if (!m) { this.log.add("You press the state reader to empty air.", "dim"); return false; }
      const tr = [m.def.inflict && `inflicts ${m.def.inflict}`, m.def.ranged && "ranged", m.def.steals && "thief", m.def.stealsGold && "gold thief", m.def.stealsLuck && "Fortune leech", m.def.drains && "life-draining", m.def.engulfs && "engulfing", m.def.silences && "silencing", m.def.drainsStat && "mind-draining", m.def.infects && "infectious", m.def.muse && "self-mending", m.def.zaps && "caster", m.def.throws && "thrower", m.def.diseases && "sickening", m.def.seduces && "seductive", m.def.paralyzes && "paralyzing gaze", m.def.splits && "splits", m.def.corrodes && "corrodes", m.cancelled && "nullified", m.worn > 0 && "armored", m.sleepTurns > 0 && "asleep"].filter(Boolean).join(", ");
      this.log.add(`State-read ${m.name}: ${m.hp}/${m.maxHp} HP${tr ? " · " + tr : ""}.`, "sys");
      return true;
    }
    if (item.type.id === "mirror") {
      const m = this.monsterAt(p.x + dx, p.y + dy);
      if (!m) { this.log.add("You peer into the mirror node — only your own reflection stares back.", "dim"); return false; }
      if (m.blindTurns > 0) { this.log.add(`${cap(m.name)} can't see its reflection.`, "dim"); return true; }
      // A petrifier meets its own gaze — the classic cockatrice fate: it turns to stone.
      if (m.def.corpseEffect === "petrify" && !m.def.boss) {
        this.log.add(`${cap(m.name)} meets its own gaze in the mirror node — it turns to stone!`, "good");
        this.gainXp(p, m.maxHp); this.kill(m); return true;
      }
      // A gazer (watcher eye) reflects its own paralyzing stare and freezes.
      if (m.def.paralyzes) {
        m.sleepTurns = Math.max(m.sleepTurns, ROT.RNG.getUniformInt(4, 8));
        this.log.add(`${cap(m.name)} catches its own eye in the mirror node — it freezes, transfixed!`, "good");
        return true;
      }
      // Bosses and the fearless are unmoved; a peaceful one just looks away; everything else flees.
      if (m.def.boss || m.def.fearless) { this.log.add(`${cap(m.name)} sneers at its reflection, unshaken.`, "dim"); return true; }
      if (m.peaceful) { this.log.add(`${cap(m.name)} glances at the mirror node and looks away.`, "dim"); return true; }
      m.frightened = Math.max(m.frightened, ROT.RNG.getUniformInt(4, 8));
      this.log.add(`${cap(m.name)} recoils from its reflection in the mirror node and flees!`, "good");
      return true;
    }
    if (item.type.id === "camera") {
      if ((item.charges ?? 0) <= 0) { this.log.add("The snapshot camera is out of film.", "dim"); return false; }
      item.charges = (item.charges ?? 0) - 1;
      let hits = 0;
      this.castRay(p.x, p.y, dx, dy, 6, (e) => {
        if (e instanceof Monster) {
          e.blindTurns = Math.max(e.blindTurns, ROT.RNG.getUniformInt(6, 12)); hits++;
          this.log.add(`The flash sears ${e.name} — blinded, it gropes about.`, "good");
        } else if (e instanceof Player) { // caught in the bounce (a co-op partner, or your own light off a wall)
          e.blind = Math.max(e.blind, ROT.RNG.getUniformInt(3, 6));
          this.log.add(`The flash catches ${e.name} full in the face — blinded!`, "bad", e);
        }
      });
      this.log.add(hits ? `The camera flashes. (film left: ${item.charges})` : `The camera flashes into empty air. (film left: ${item.charges})`, hits ? "sys" : "dim");
      return true;
    }
    return false;
  }

  /** Show the contract-deployer (magic marker) scroll menu. */
  promptWrite(): void {
    const menu = WRITABLE_SCROLLS.map((id, i) => `(${i + 1}) ${itemById(id)?.name ?? id}`).join("  ");
    this.log.add(`Deploy which scroll? ${menu}  (Esc to cancel)`, "sys");
  }

  /** The wand of wishing's menu of wish-worthy items (each granted blessed; gear at the listed enchant). */
  promptWish(): void {
    const menu = WISHES.map((w, i) => { const t = itemById(w.id); return `(${i + 1}) ${t ? this.ident.name(t) : w.id}${w.enchant ? ` +${w.enchant}` : ""}`; }).join("  ");
    this.log.add(`For what do you wish? ${menu}  (Esc to forgo)`, "sys");
  }

  /** Grant the chosen wish: a blessed item dropped into the pack; the wand spends a charge, then crumbles. */
  grantWish(wand: Item, n: number): boolean {
    if (n < 0 || n >= WISHES.length) { this.log.add("You wish for nothing in particular.", "dim"); return false; }
    if (this.acting.inventory.full) { this.log.add("Your pack is too full to hold a wish.", "bad"); return false; }
    const w = WISHES[n], type = itemById(w.id);
    if (!type) return false;
    const it = this.giveItem(type, { enchant: w.enchant, buc: "blessed", bucKnown: true });
    this.log.add(`Reality bends — ${this.ident.name(type)}${w.enchant ? ` +${it.enchant}` : ""} settles into your pack, wished into being.`, "good");
    wand.charges = (wand.charges ?? 1) - 1;
    if ((wand.charges ?? 0) <= 0) { this.acting.inventory.remove(wand); this.log.add("The wand of wishing crumbles to dust, its magic spent.", "dim"); }
    return true;
  }

  /** Which pack items a scroll of charging can top up: wands and the charged tools. */
  canCharge(it: Item): boolean {
    return it.type.kind === "wand" || it.type.id === "marker" || it.type.id === "trickbag";
  }

  /** Read a scroll of gas top-up onto a chosen wand/tool. Blessed adds more; cursed drains it. */
  chargeItem(buc: Buc, target: Item): boolean {
    if (!this.canCharge(target)) { this.log.add(`${this.ident.name(target.type)} holds no charge to top up.`, "dim"); return true; }
    const cur = target.charges ?? 0;
    if (buc === "cursed") {
      target.charges = Math.max(0, cur - ROT.RNG.getUniformInt(1, 2));
      this.log.add(`A cursed surge saps ${this.ident.name(target.type)} — now [${target.charges}].`, "bad");
      if ((target.charges ?? 0) <= 0 && target.type.kind === "wand") { this.acting.inventory.remove(target); this.log.add(`The ${target.type.name} crumbles to dust, drained dry.`, "dim"); }
      return true;
    }
    // The wand of wishing is too potent to top up freely — a single grudging charge at most.
    const gain = target.type.id === "wand_wish" ? 1 : buc === "blessed" ? ROT.RNG.getUniformInt(4, 6) : ROT.RNG.getUniformInt(2, 4);
    target.charges = cur + gain;
    this.log.add(`${cap(this.ident.name(target.type))} thrums with fresh charge — now [${target.charges}].`, "good");
    return true;
  }

  // ── #loot: the multisig vault (bag of holding) ──
  /** An item can't be stashed while it's equipped (worn/wielded/on-hand/welded) or unpaid (no hiding the bill). */
  private lootLocked(p: Player, it: Item): boolean {
    return !!it.unpaid || p.isWelded(it) || it === p.weapon || it === p.ring || it === p.amulet || p.wornArmor.includes(it);
  }

  lootMenu(vault: Item): void {
    if (!vault.contents) vault.contents = [];
    this.log.add(`— Multisig vault (${vault.contents.length}/${VAULT_CAP} held) —  press (i) to stash in · (o) to take out · (Esc) to close`, "sys");
  }

  lootStashPrompt(vault: Item): void {
    const p = this.acting;
    const eligible = p.inventory.items.filter((it) => it !== vault && !this.lootLocked(p, it));
    if (eligible.length === 0) { this.log.add("You have nothing loose to stash. (take gear off first)", "dim"); return; }
    if ((vault.contents?.length ?? 0) >= VAULT_CAP) { this.log.add("The vault is full.", "bad"); return; }
    this.showInventory();
    this.log.add("Stash which item into the vault? (a pack letter, Esc to cancel)", "sys");
  }

  lootTakePrompt(vault: Item): void {
    const held = vault.contents ?? [];
    if (held.length === 0) { this.log.add("The vault is empty.", "dim"); return; }
    this.log.add("— Vault contents —", "sys");
    held.forEach((it, i) => {
      const buc = it.bucKnown && it.buc ? `${it.buc} ` : "";
      this.log.add(`  ${i + 1}) ${buc}${this.ident.name(it.type)}`, "dim");
    });
    this.log.add("Take out which? (a number, Esc to cancel)", "sys");
  }

  lootStash(vault: Item, item: Item): boolean {
    const p = this.acting;
    if (item === vault) { this.log.add("A vault can't hold itself.", "dim"); return false; }
    if (this.lootLocked(p, item)) { this.log.add(`You'd have to take off ${this.ident.name(item.type)} first.`, "dim"); return false; }
    if (!vault.contents) vault.contents = [];
    if (vault.contents.length >= VAULT_CAP) { this.log.add("The vault is full.", "bad"); return false; }
    p.inventory.remove(item);
    if (item === p.quiver) p.quiver = null;
    vault.contents.push(item);
    this.log.add(`${this.sub(p)} ${this.verbS(p, "stash")} ${this.ident.name(item.type)} in the vault. (${vault.contents.length}/${VAULT_CAP})`, "good");
    return true;
  }

  lootTake(vault: Item, idx: number): boolean {
    const p = this.acting;
    const held = vault.contents ?? [];
    if (idx < 0 || idx >= held.length) { this.log.add("No such item in the vault.", "dim"); return false; }
    if (p.inventory.full) { this.log.add("Your pack is full — no room to withdraw.", "bad"); return false; }
    const item = held.splice(idx, 1)[0];
    p.inventory.items.push(item);
    this.log.add(`${this.sub(p)} ${this.verbS(p, "withdraw")} ${this.ident.name(item.type)} from the vault.`, "good");
    return true;
  }

  /** Write (deploy) a scroll with a contract deployer, spending a charge. */
  writeScroll(marker: Item, idx: number): boolean {
    if (idx < 0 || idx >= WRITABLE_SCROLLS.length) { this.log.add("No such scroll on the menu.", "dim"); return false; }
    if ((marker.charges ?? 0) <= 0) { this.log.add("The contract deployer is out of gas.", "dim"); return false; }
    const p = this.acting;
    this.breakConduct(p, "illiterate"); // writing a scroll ends Illiterate
    if (p.inventory.full) { this.log.add("Your pack is full.", "bad"); return false; }
    const t = itemById(WRITABLE_SCROLLS[idx]);
    if (!t) return false;
    marker.charges = (marker.charges ?? 0) - 1;
    const it = p.inventory.add(t); it.buc = "uncursed"; it.bucKnown = true;
    this.ident.learn(t); // deploying it reveals its identity
    this.log.add(`${this.sub(p)} ${this.verbS(p, "deploy")} ${t.name}. (deployer gas left: ${marker.charges})`, "good");
    return true;
  }

  tryPickup(): boolean {
    const who = this.acting;
    const fi = this.level.itemAt(who.x, who.y);
    if (!fi) { this.log.add("There is nothing here to pick up.", "dim"); return false; }
    if (fi.coins != null) { this.collectGold(who, fi); return true; }
    if (fi.chest) { this.log.add("It's a chest — press o to open it.", "dim"); return false; }
    if (fi.corpse) { this.log.add(`Best eaten where it lies — press e to eat the ${monName(fi.corpse.def)} corpse.`, "dim"); return false; }
    if (fi.type.id === "jam") {
      who.hasJam = true;
      this.level.items = this.level.items.filter((i) => i !== fi);
      this.log.add(`${who.name === "you" ? "You seize" : who.name + " seizes"} the JAM! Now ASCEND — climb back to the surface (press <).`, "good");
      return true;
    }
    if (who.inventory.full) { this.log.add("Your pack is full.", "bad"); return false; }
    // A priced ware with a peaceful keeper goes onto your BILL — carry it, settle at the door (or drop to return).
    if (fi.price) {
      const k = this.shopkeeper();
      if (k && k.peaceful) {
        const it = this.giveItem(fi.type, { enchant: fi.enchant, relic: fi.relic, buc: fi.buc, bucKnown: fi.bucKnown });
        it.unpaid = fi.price;
        this.level.items = this.level.items.filter((i) => i !== fi);
        this.log.add(`You add ${this.ident.name(fi.type)} to your bill — ${fi.price} gold, due at the door.`, "sys", who);
        return true;
      }
      // no keeper to mind the till → it's free loot (fall through)
    }
    this.giveItem(fi.type, { enchant: fi.enchant, relic: fi.relic, buc: fi.buc, bucKnown: fi.bucKnown });
    this.level.items = this.level.items.filter((i) => i !== fi);
    const tag = fi.relic ? ` +${fi.enchant ?? 0} ✦` : "";
    this.log.add(`You pick up ${this.ident.name(fi.type)}${tag}.`);
    // Claiming your Quest artifact completes the Quest — the homeland portal won't reopen.
    if (fi.type.id.startsWith("art_")) {
      this.questDone = true;
      this.log.add(`✦ ${fi.type.name} is yours — your Quest is fulfilled. Wield it well.`, "good");
    }
    return true;
  }

  /** Eat a corpse lying at a player's feet. Returns true if there was one (the turn is spent).
   *  Corpses feed you — but some are poisonous, some petrify, and old ones make you ill. */
  eatFloorCorpse(p: Player): boolean {
    const fi = this.level.items.find((i) => i.x === p.x && i.y === p.y && i.corpse);
    if (!fi || !fi.corpse) return false;
    const { def, born } = fi.corpse;
    this.breakConduct(p, "vegetarian"); // eating a corpse ends Vegetarian
    this.level.items = this.level.items.filter((i) => i !== fi);
    p.nutrition += Math.max(50, Math.min(600, def.hp * 12));
    this.log.add(`${this.sub(p)} ${this.verbS(p, "eat")} the ${def.name} corpse.`, "good");
    const rotten = this.turn - born > 60;
    if (def.corpseEffect === "petrify" && !p.intrinsics.has("petrifyResist")) {
      p.stoning = 5;
      this.log.add(`${this.sub(p)} ${this.verbS(p, "start")} to freeze solid — find a cure, fast! (pray, or a cleanse)`, "bad");
    } else if (def.corpseEffect === "poisonous") {
      if ((p.intrinsics.has("poisonResist") || p.ringPoisonRes)) this.log.add("Toxic — but you shrug it off.", "dim");
      else { this.applyStatus(p, "poison"); if (ROT.RNG.getUniform() < 0.33) { p.intrinsics.add("poisonResist"); this.log.add("Your gut hardens — poison resistance!", "good"); } }
    } else if (def.corpseEffect === "speed") {
      if (!p.intrinsics.has("fast") && ROT.RNG.getUniform() < 0.4) { p.intrinsics.add("fast"); this.log.add("You feel quick! (intrinsic speed)", "good"); }
    } else if (def.corpseEffect === "telepathy") {
      if (!p.intrinsics.has("telepathy")) { p.intrinsics.add("telepathy"); this.log.add("Your mind expands — you sense other minds while blind. (telepathy)", "good"); }
    } else if (def.corpseEffect === "levelup") {
      this.gainXp(p, Math.max(10, this.xpForLevel(p.level + 1) - p.xp + 1), false); // the wight's hoarded vitality flows back
      this.log.add("Stolen vitality floods back into you — you feel experienced!", "good");
      if (!p.intrinsics.has("drainResist") && ROT.RNG.getUniform() < 0.33) { p.intrinsics.add("drainResist"); this.log.add("Your spirit anchors — draining can't take hold. (drain resistance)", "good"); }
    } else if (rotten && !(p.intrinsics.has("poisonResist") || p.ringPoisonRes) && ROT.RNG.getUniform() < 0.5) {
      p.illness = 8;
      this.log.add("That was rotten — a bad block churns in you. (cure it before it's fatal)", "bad");
    } else if (ROT.RNG.getUniform() < 0.06) {
      p.intrinsics.add("poisonResist");
      this.log.add("You feel hardier. (poison resistance)", "good");
    }
    if (p.hp <= 0) this.killPlayer(p);
    return true;
  }

  /** The bazaar's shopkeeper on this level, if one is still alive. */
  shopkeeper(): Monster | undefined {
    return this.monsters.find((m) => m.alive && m.def.keeper);
  }

  /** The shop bill-ledger: once you step beyond the shop carrying unpaid wares, the Marketmaker settles
   *  the bill — it auto-pays if you can afford it, else it's theft and the keeper turns lethal. */
  checkShopBill(p: Player): void {
    if (!this.level.shop) return;
    // still browsing — nothing due yet, unless you're on a stair/portal about to leave the level entirely
    const leaving = ["stairsDown", "stairsUp", "branchDown", "portal"].includes(this.level.tileAt(p.x, p.y) ?? "");
    if (this.level.inShop(p.x, p.y) && !leaving) return;
    const owed = p.inventory.items.filter((it) => it.unpaid);
    if (!owed.length) return;
    const k = this.shopkeeper();
    if (!k || !k.peaceful) { for (const it of owed) it.unpaid = undefined; return; } // no keeper at the till → free
    const total = owed.reduce((n, it) => n + (it.unpaid ?? 0), 0);
    if (p.gold >= total) {
      p.gold -= total;
      for (const it of owed) it.unpaid = undefined;
      this.breakConduct(p, "bankless");
      this.log.add(`The Marketmaker settles your bill at the door — ${total} gold for ${owed.length} ware(s). (${p.gold} left)`, "good", p);
    } else {
      k.peaceful = false; k.fg = "#ff5030";
      this.log.add(`You slip out owing ${total} gold you can't cover — the Marketmaker bellows "THIEF!" and gives chase.`, "bad", p);
    }
    this.draw();
  }

  dropItem(item: Item): void {
    const x = this.acting.x, y = this.acting.y;
    // A vault spills its stash onto the floor when set down, so nothing is lost.
    if (item.contents?.length) {
      for (const c of item.contents) this.level.items.push({ x, y, type: c.type, enchant: c.enchant, relic: c.relic, buc: c.buc, bucKnown: c.bucKnown });
      this.log.add(`The vault's ${item.contents.length} stashed item(s) spill out onto the floor.`, "sys");
      item.contents = [];
    }
    const fi: FloorItem = { x, y, type: item.type, enchant: item.enchant, relic: item.relic, buc: item.buc, bucKnown: item.bucKnown };
    // Returning an unpaid ware to the shop floor puts it back on the shelf and clears it from your bill.
    if (item.unpaid && this.level.inShop(x, y) && this.shopkeeper()) {
      fi.price = item.unpaid;
      this.log.add(`You set ${this.ident.name(item.type)} back on the shelf — off your bill.`, "sys");
    }
    // Gavin's altar reveals an item's sanctity when you set it down upon it.
    if (this.level.tileAt(x, y) === "altar") {
      // A vial of water left on the altar is consecrated into holy water.
      if (item.type.id === "water" && item.buc !== "blessed") {
        fi.buc = "blessed"; fi.bucKnown = true; this.ident.learn(item.type);
        this.log.add("The water rests on the altar and is consecrated — holy water, now blessed.", "good");
      } else {
        fi.bucKnown = true;
        const b = item.buc ?? "uncursed";
        const glow = b === "blessed" ? "an amber glow" : b === "cursed" ? "a black flicker" : "no glow at all";
        this.log.add(`The ${this.ident.name(item.type)} rests on the altar — ${glow}. It is ${b}.`, b === "cursed" ? "bad" : "sys");
      }
    }
    this.level.items.push(fi);
  }

  /** `\` — the discoveries screen: every potion/scroll type you've identified this run. */
  showDiscoveries(): void {
    const groups = this.ident.discoveries();
    const total = groups.reduce((n, g) => n + g.entries.length, 0);
    this.log.add(`— Discoveries (${total} identified) —`, "sys");
    let any = false;
    for (const g of groups) {
      if (g.entries.length === 0) continue;
      any = true;
      this.log.add(`${cap(g.kind)}s:`, "sys");
      for (const e of g.entries) this.log.add(`  ${e.name}${e.look ? ` — was "${e.look}"` : ""}`, "dim");
    }
    if (!any) this.log.add("Nothing identified yet — quaff, read, or use a scroll of identify.", "dim");
    const unknown = groups.reduce((n, g) => n + g.unknown, 0);
    if (unknown) this.log.add(`${unknown} potion/scroll/gem type(s) still a mystery.`, "dim");
  }

  showInventory(): void {
    const who = this.acting;
    const inv = who.inventory;
    if (inv.items.length === 0) { this.log.add("Your pack is empty.", "dim"); return; }
    this.log.add(`— ${who.name === "you" ? "Inventory" : who.name + "'s pack"} —`, "sys");
    inv.items.forEach((it, i) => {
      const welded = who.isWelded(it);
      const eq = welded ? " (welded)" : it === who.weapon ? " (wielded)" : it === who.offhand ? " (off-hand)" : who.wornArmor.includes(it) ? " (worn)" : it === who.ring ? " (on hand)" : it === who.amulet ? " (around your neck)" : it === who.quiver ? " (at the ready)" : "";
      const lbl = it.label ? ` named "${it.label}"` : "";
      const ch = it.charges != null ? ` [${it.charges}]` : it.type.id === "vault" ? ` {${it.contents?.length ?? 0} held}` : "";
      const relic = it.relic ? ` +${it.enchant ?? 0} ✦` : "";
      const buc = it.bucKnown && it.buc ? `${it.buc} ` : "";
      const ero = it.erosion ? (["", "rusty ", "corroded ", "very corroded "][it.erosion] ?? "") : (it.proofed ? "audited " : "");
      const unpaid = it.unpaid ? ` (unpaid, ${it.unpaid} gold)` : "";
      const tone = it.unpaid ? "bad" : it.bucKnown && it.buc === "cursed" ? "bad" : it.bucKnown && it.buc === "blessed" ? "good" : it.relic ? "sys" : "dim";
      this.log.add(`  ${inv.letter(i)}) ${buc}${ero}${this.ident.name(it.type)}${relic}${ch}${lbl}${eq}${unpaid}`, tone);
    });
  }

  applyEffect(effect: EffectId, buc: Buc = "uncursed"): void {
    const p = this.acting;
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
      case "water": {
        // Holy water (blessed) purifies; unholy water (cursed) burns; plain water is just water.
        if (buc === "blessed") {
          if (p.poison > 0 || p.confused > 0 || p.stoning > 0 || p.illness > 0 || p.blind > 0) {
            p.poison = 0; p.confused = 0; p.stoning = 0; p.illness = 0; p.blind = 0;
            this.log.add("You drink the holy water — it purifies you, body and ledger.", "good");
          } else { p.hp = Math.min(p.maxHp, p.hp + ROT.RNG.getUniformInt(3, 6)); this.log.add("You drink the holy water. A blessed calm settles over you.", "good"); }
        } else if (buc === "cursed") {
          p.hp -= ROT.RNG.getUniformInt(3, 6); this.log.add("You drink the unholy water — it sears going down!", "bad");
        } else this.log.add("You drink the testnet water. Refreshing, and nothing more.", "dim");
        break;
      }
      case "strength": {
        p.maxHp += 3; p.hp += 3;
        this.log.add("You feel staked. (max HP increased)", "good"); break;
      }
      case "teleport": {
        let pos = this.level.randomFloor(), t = 0;
        while (t < 40 && (this.monsterAt(pos.x, pos.y) || this.level.tileAt(pos.x, pos.y) === "stairsDown")) { pos = this.level.randomFloor(); t++; }
        p.x = pos.x; p.y = pos.y; p.engulfedBy = null; p.webbed = 0; this.recomputeFOV(); // a blink slips you out of a trapper's gut / a web
        this.log.add("You blink across the chain.", "sys"); break;
      }
      case "map": {
        this.level.revealAll();
        this.log.add("A light client reveals the whole level.", "sys"); break;
      }
      case "detect_obj": {
        const n = this.level.items.length; // every floor item, gold piles included
        for (const i of this.level.items) i.detected = true;
        this.recomputeFOV();
        this.log.add(n ? `Auditing the ledger — you sense ${n} object${n > 1 ? "s" : ""} scattered across the level.` : "You audit the ledger, but sense no objects here.", n ? "good" : "dim");
        break;
      }
      case "scare": {
        // A wave of dread — nearby foes recoil and flee (bosses/fearless/peaceful are unmoved). Blessed reaches the whole floor.
        const reach = buc === "blessed" ? 999 : 8, turns = buc === "blessed" ? 15 : 8;
        let n = 0;
        for (const m of this.monsters) {
          if (!m.alive || m.peaceful || m.def.boss || m.def.fearless) continue;
          if (Math.max(Math.abs(m.x - p.x), Math.abs(m.y - p.y)) <= reach) { m.frightened = Math.max(m.frightened, turns); n++; }
        }
        this.log.add(n ? `A wave of dread rolls out — ${n} foe${n > 1 ? "s" : ""} recoil and flee!` : "A wave of dread rolls out, but nothing near enough feels it.", n ? "good" : "dim");
        break;
      }
      case "gold": {
        let n = 0;
        for (const i of this.level.items) if (i.coins != null) { i.detected = true; n++; }
        this.recomputeFOV();
        this.log.add(n ? `A balance check pings — you sense ${n} gold pile${n > 1 ? "s" : ""} across the floor.` : "A balance check pings, but no gold lies loose on this floor.", n ? "good" : "dim");
        break;
      }
      case "clairvoyance": {
        const r = buc === "blessed" ? 14 : 8;
        const n = this.level.revealAround(p.x, p.y, r);
        this.recomputeFOV();
        this.log.add(n ? "A remote view floods your mind — the surrounding halls lay themselves bare." : "A remote view floods your mind, but you already know these halls.", n ? "sys" : "dim");
        break;
      }
      case "detect_trap": {
        let n = 0;
        for (const tr of this.level.traps) { tr.revealed = true; tr.detected = true; n++; }
        this.recomputeFOV();
        this.log.add(n ? `An exploit scan — you sense ${n} trap${n > 1 ? "s" : ""} laid across the level.` : "You scan for exploits, but the level is clean of traps.", n ? "good" : "dim");
        break;
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
        if (p.poison > 0 || p.confused > 0 || p.stoning > 0 || p.illness > 0 || p.blind > 0 || p.silenced > 0 || p.lycanthrope) {
          p.poison = 0; p.confused = 0; p.stoning = 0; p.illness = 0; p.blind = 0; p.silenced = 0;
          if (p.lycanthrope) { p.lycanthrope = null; if (p.polyForm) this.revertPoly(p, true); }
          this.log.add("A cleansing light — your afflictions lift.", "good"); this.recomputeFOV();
        } else this.log.add("You feel briefly cleansed.", "dim");
        break;
      }
      case "polyself": { this.polySelf(p); break; }
      case "blind": {
        if (p.intrinsics.has("telepathy")) this.log.add("Your sight goes dark — but your mind's eye stays open.", "sys");
        else this.log.add(`${this.sub(p)} ${this.verbS(p, "go")} blind — the world obfuscates!`, "bad");
        p.blind = Math.max(p.blind, buc === "cursed" ? 50 : buc === "blessed" ? 15 : 30);
        this.recomputeFOV();
        break;
      }
      case "uncurse": {
        // A formal-verification pass clears every curse you carry and reveals sanctity.
        const wash = buc === "blessed"; // blessed verification also blesses the cleansed items
        let n = 0;
        for (const it of p.inventory.items) {
          if (it.buc === "cursed") { it.buc = wash ? "blessed" : "uncursed"; n++; }
          it.bucKnown = true;
          if (it.type.kind === "armor" || it.type.kind === "weapon") { it.erosion = 0; it.proofed = true; } // audited = rust-proof
        }
        p.applyWeapon(); p.recomputeAC();
        this.log.add(n > 0 ? `Verification passes — ${n} curse${n > 1 ? "s" : ""} lifted; your pack is audited.` : "Verification passes — your gear is clean.", "good");
        break;
      }
    }
    if (p.hp <= 0) this.killPlayer(p);
    this.draw();
  }

  // ── wallet + shops (Phase 2: gasless PAS economy) ──────────────────────────
  async connect(): Promise<void> {
    try {
      this.wallet = await connectWallet();
      this.player.pas = await walletBalancePas(this.wallet.address);
      const a = this.wallet.address;
      this.log.add(`Wallet connected: ${a.slice(0, 6)}…${a.slice(-4)} — ${this.player.pas.toFixed(1)} PAS. Standard wares cost gold; only NFT relics charge your wallet.`, "sys");
      this.onWallet?.(a, this.player.pas);
      this.draw();
      void this.loadRelics(); // bring any owned NFT relics into the current pack
    } catch (e) {
      this.log.add(`Wallet: ${e instanceof Error ? e.message : "failed"}`, "bad");
    }
  }

  private spawnShop(): void {
    const centers = this.level.roomCenters.slice(1); // not the start room
    if (centers.length === 0) return;
    const c = ROT.RNG.getItem(centers)!;
    this.level.shop = { x: c.x, y: c.y, r: 3 }; // the shop region — your bill settles when you step beyond it
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
          this.level.items.push({ x, y, type: t, price: PRICE_GOLD[t.kind] ?? 30, buc: "uncursed", bucKnown: true });
          break;
        }
      }
    }
    // NFT relic wares (bought with PAS from a connected wallet) are deferred — to be
    // reintroduced in a later update. The bazaar carries gold-priced standard stock only.
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
        ? "A bazaar glints on this floor — the Marketmaker ($) tends it. Buy on the spot (p), or pick wares onto your bill (,) and settle at the door. Leave owing more than you hold, and it turns lethal."
        : "A bazaar glints somewhere on this floor — provisions for gold (stand on a ware, press p).",
      "dim",
    );
  }

  async tryBuy(): Promise<void> {
    if (this.busy) return;
    const fi = this.level.itemAt(this.acting.x, this.acting.y);
    if (!fi || !fi.price) {
      // No ware underfoot — but if you carry an unpaid bill and the keeper's at hand, settle it now.
      const owed = this.acting.inventory.items.filter((it) => it.unpaid);
      const k = this.shopkeeper();
      if (owed.length && k && k.peaceful) {
        const total = owed.reduce((n, it) => n + (it.unpaid ?? 0), 0);
        if (this.acting.gold < total) { this.log.add(`Your bill is ${total} gold — you hold only ${this.acting.gold}.`, "bad"); return; }
        this.acting.gold -= total; for (const it of owed) it.unpaid = undefined;
        this.breakConduct(this.acting, "bankless");
        this.log.add(`${this.sub(this.acting)} ${this.verbS(this.acting, "settle")} the bill — ${total} gold for ${owed.length} ware(s). (${this.acting.gold} left)`, "good");
        this.draw(); return;
      }
      this.log.add("There is nothing for sale here.", "dim"); return;
    }

    // Standard wares are bought with in-game gold — instant, no wallet. Works in co-op too:
    // each adventurer spends their own purse (giveItem credits the acting player).
    if (!fi.nft) {
      const p = this.acting;
      if (p.gold < fi.price) { this.log.add(`Not enough gold — ${this.ident.name(fi.type)} costs ${fi.price}, you hold ${p.gold}.`, "bad"); return; }
      p.gold -= fi.price;
      this.breakConduct(p, "bankless");
      this.giveItem(fi.type, { enchant: fi.enchant, relic: fi.relic, buc: fi.buc, bucKnown: fi.bucKnown });
      this.level.items = this.level.items.filter((i) => i !== fi);
      this.log.add(`${this.sub(p)} ${this.verbS(p, "buy")} ${this.ident.name(fi.type)} for ${fi.price} gold. (${p.gold} left)`, "good");
      this.draw();
      return;
    }

    // NFT gear — a real wallet transaction, like an NFT trade/mint. Solo-only for now (one wallet).
    if (this.coop) { this.log.add("NFT relics are a solo-only purchase for now — but standard wares take gold.", "dim"); return; }
    if (!this.wallet) { this.log.add("That's an NFT relic — connect a wallet (button above) to mint-buy it.", "bad"); return; }
    if (this.player.pas < fi.price) { this.log.add(`Not enough PAS — ${this.ident.name(fi.type)} costs ${fi.price}, your wallet holds ${this.player.pas.toFixed(1)}.`, "bad"); return; }

    // A direct wallet transaction — the game halts until it confirms on-chain.
    this.busy = true;
    this.log.add(`The Marketmaker slides a terminal across the counter. Confirm ${fi.price} PAS in your wallet…`, "sys"); this.draw();
    const r = await buyDirect(this.wallet.provider, fi.price, (hash) => {
      this.log.add(`Payment broadcast (${hash.slice(0, 10)}…). Settling on the chain — hold fast…`, "dim"); this.draw();
    });
    if (!r.ok) { this.busy = false; this.log.add(`The deal falls through — ${r.error}.`, "bad"); this.draw(); return; }

    this.breakConduct(this.acting, "bankless"); // a purchase ends Bankless
    this.giveItem(fi.type, { enchant: fi.enchant, relic: fi.relic, buc: fi.buc, bucKnown: fi.bucKnown });
    this.level.items = this.level.items.filter((i) => i !== fi);
    this.player.pas = await walletBalancePas(this.wallet.address);
    this.onWallet?.(this.wallet.address, this.player.pas);
    const tag = fi.relic ? ` +${fi.enchant ?? 0} ✦` : "";
    this.log.add(`Settled on-chain. You buy ${this.ident.name(fi.type)}${tag} for ${fi.price} PAS. Wallet: ${this.player.pas.toFixed(1)}.`, "good");
    if (fi.enchant && isGear(fi.type)) this.log.add("A fine piece — forge it (F) into a tradeable NFT relic when you like.", "dim");
    this.busy = false;
    this.draw();
  }

  private kill(d: Entity): void {
    if (d instanceof Player) { this.downPlayer(d); return; }
    if (d === this.pet) { this.log.add("Your nominator falls. You descend alone.", "bad"); this.scheduler.remove(this.pet); return; }
    const m = d as Monster;
    for (const pl of this.allPlayers()) if (pl.engulfedBy === m) pl.engulfedBy = null; // a slain trapper releases its victim
    if (m.def.keeper) for (const pl of this.allPlayers()) for (const it of pl.inventory.items) it.unpaid = undefined; // the till's unguarded — your bill is voided
    const mi = this.monsters.indexOf(m); // splice in place — the array identity is the persisted level's monster list
    if (mi >= 0) this.monsters.splice(mi, 1);
    this.scheduler.remove(m);
    if (m.def.weight > 0 && !m.def.keeper && !m.def.priest) this.dropGold(m.x, m.y); // ordinary foes may scatter a few coins
    // Slay the resurrected Censor while it holds the JAM and you wrest it back.
    if (m.isHunter && this.jamStolen) {
      this.jamStolen = false;
      const recip = this.nearestPlayer(m.x, m.y);
      recip.hasJam = true;
      this.log.add("You tear the JAM from the Censor's ribs — it is yours again. Climb on.", "good", recip);
    }
    // A slain thief disgorges whatever it stole — reclaim it where it fell.
    if (m.stolen && !this.level.itemAt(m.x, m.y)) {
      this.level.items.push({ x: m.x, y: m.y, type: m.stolen.type, enchant: m.stolen.enchant, relic: m.stolen.relic, buc: m.stolen.buc, bucKnown: m.stolen.bucKnown });
      this.log.add(`${cap(m.name)} drops ${this.ident.name(m.stolen.type)} as it dies.`, "good");
      m.stolen = null;
    }
    // A slain airdrop farmer disgorges the gold it grabbed.
    if (m.stoleGold > 0) {
      const spot = this.level.itemAt(m.x, m.y) ? this.adjacentFreeFloor(m.x, m.y) : { x: m.x, y: m.y };
      if (spot) this.level.items.push({ x: spot.x, y: spot.y, type: GOLD, coins: m.stoleGold });
      this.log.add(`${cap(m.name)} spills ${m.stoleGold} gold as it dies.`, "good");
      m.stoleGold = 0;
    }
    if (m.def.boss) {
      this.defeatedBosses.add(this.player.depth);
      if (ROT.RNG.getUniform() < 0.05 && !this.level.itemAt(m.x, m.y)) {
        // vanishingly rare: a boss's ash yields the wand of wishing — the ultimate prize.
        this.level.items.push({ x: m.x, y: m.y, type: itemById("wand_wish")!, buc: "blessed", bucKnown: true });
        this.log.add(`${cap(m.name)} falls — and from its ash rises a wand of wishing. Vanishingly rare. Take it.`, "good");
      } else {
        // A boss drops a relic-grade prize: an enchanted piece of equipment.
        const goodies = ITEMS.filter((i) => isGear(i));
        const prize = ROT.RNG.getItem(goodies)!;
        const enchant = ROT.RNG.getUniformInt(1, 3);
        if (!this.level.itemAt(m.x, m.y)) this.level.items.push({ x: m.x, y: m.y, type: prize, enchant, buc: "blessed", bucKnown: true });
        this.log.add(`${cap(m.name)} falls! It leaves a prize — ${prize.name} +${enchant}. Forge it (F) into a tradeable NFT relic.`, "good");
      }
    } else {
      this.log.add(`${cap(m.name)} is destroyed.`, "good");
    }
    // It leaves a corpse — food, but eat with care (poison / petrify / rot).
    if (!m.def.boss && !m.def.keeper && !m.def.priest && !m.def.seer && !m.def.guard && !m.def.mimic && ROT.RNG.getUniform() < 0.55 && !this.level.itemAt(m.x, m.y)) {
      this.level.items.push({ x: m.x, y: m.y, type: CORPSE, corpse: { def: m.def, born: this.turn } });
    }
  }

  // ── spawns ─────────────────────────────────────────────────────────────────
  private spawnMonsters(): void {
    const diff = this.currentChain?.difficulty ?? 1;
    // A chain's difficulty shifts the monster pool deeper/shallower and scales the count.
    const poolDepth = Math.max(1, this.player.depth + Math.round((diff - 1) * 4));
    // Phase 18: fewer-but-tougher — the per-depth coefficient is gentler (1.5→1.2) and the cap
    // lower (44→40) now that monster HP/damage scale with depth, so deep floors press without grinding.
    const count = Math.min(40, Math.round((4 + this.player.depth * 1.2) * diff) + (this.player.depth >= 18 ? 4 : 0) + (this.level.kind === "bigroom" ? 12 : 0));
    for (let i = 0; i < count; i++) {
      const def = this.pickMonster(poolDepth);
      let pos = this.level.randomFloor();
      let tries = 0;
      while (
        tries < 60 &&
        (this.monsterAt(pos.x, pos.y) ||
          (pos.x === this.player.x && pos.y === this.player.y) ||
          this.level.inVault(pos.x, pos.y) || // the sealed Treasury holds no random foes — only its Guard
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

  /** A sybil replicates into an adjacent free cell — bounded by a per-level sybil cap and
   *  the parent's split budget (the child inherits one fewer), so it can't runaway-swarm. */
  spawnSybilNear(parent: Monster): boolean {
    if (this.monsters.length >= 30) return false;
    const sybils = this.monsters.reduce((n, m) => n + (m.alive && m.def.splits ? 1 : 0), 0);
    if (sybils >= 8) return false; // hard cap on the swarm size
    const offs = ROT.RNG.shuffle([[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]] as [number, number][]);
    for (const [dx, dy] of offs) {
      const nx = parent.x + dx, ny = parent.y + dy;
      if (this.level.isPassable(nx, ny) && !this.monsterAt(nx, ny) && !this.playerAt(nx, ny)) {
        const m = new Monster(this, MONSTERS[0], nx, ny);
        m.splitsLeft = Math.max(0, parent.splitsLeft - 1); // children replicate less; grandchildren not at all
        this.monsters.push(m);
        this.scheduler.add(m, true);
        return true;
      }
    }
    return false;
  }

  private spawnTraps(): void {
    const count = 2 + Math.floor(this.player.depth * 0.8);
    const kinds: TrapKind[] = ["gas", "slash", "reorg", "fork", "web", "dart", "antimagic", "statue"];
    // trapdoors drop you a floor — only on the main relay descent, never where there's no floor below
    if (!this.currentChain && !this.branch && this.player.depth < MAX_DEPTH) kinds.push("trapdoor");
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
    const p = this.acting;
    switch (trap.kind) {
      case "gas": { const d = ROT.RNG.getUniformInt(3, 7); p.hp -= d; this.log.add(`A gas-fee trap drains ${d} from you!`, "bad"); break; }
      case "slash": { const d = ROT.RNG.getUniformInt(6, 12); p.hp -= d; this.log.add(`A slashing trap bites for ${d}!`, "bad"); break; }
      case "reorg": {
        let pos = this.level.randomFloor(), t = 0;
        while (t < 40 && (this.monsterAt(pos.x, pos.y) || this.level.tileAt(pos.x, pos.y) === "stairsDown")) { pos = this.level.randomFloor(); t++; }
        p.x = pos.x; p.y = pos.y; this.recomputeFOV();
        this.log.add("A reorg trap flings you across the level!", "bad"); break;
      }
      case "fork": { this.log.add("A fork trap! Reality splits around you —", "bad"); this.polySelf(p); break; }
      case "web": {
        if (p.webbed > 0) { this.log.add("You're already tangled in the honeypot web.", "dim"); break; }
        p.webbed = ROT.RNG.getUniformInt(3, 6);
        this.log.add("A honeypot web snares you fast — you're stuck! (move to struggle free)", "bad"); break;
      }
      case "dart": {
        const d = ROT.RNG.getUniformInt(2, 6); p.hp -= d;
        this.log.add(`A front-running dart darts out ahead of you and stings for ${d}!`, "bad");
        // an unlucky few are tainted with a poison payload
        if (!p.ringPoisonRes && !p.intrinsics.has("poisonResist") && ROT.RNG.getUniform() < 0.25) {
          p.poison += ROT.RNG.getUniformInt(3, 5); this.log.add("The dart was tainted — poison courses through you!", "bad");
        }
        break;
      }
      case "antimagic": {
        if (p.energy > 0) {
          const drained = Math.min(p.energy, ROT.RNG.getUniformInt(3, 8)); p.energy -= drained;
          this.log.add(`An anti-magic field crackles — ${drained} energy bleeds out of you!`, "bad");
        } else this.log.add("An anti-magic field crackles around you, but you've no energy to lose.", "dim");
        break;
      }
      case "statue": {
        const spot = this.adjacentFree(p.x, p.y);
        if (spot) {
          const m = new Monster(this, this.pickMonster(p.depth), spot.x, spot.y);
          this.monsters.push(m); this.scheduler.add(m, true);
          this.log.add(`A statue trap! A frozen ${m.def.name.replace(/^an? /, "")} shudders to life and lunges!`, "bad");
        } else this.log.add("A statue trap fires, but there's no room for it to animate.", "dim");
        break;
      }
      case "trapdoor": {
        const d = ROT.RNG.getUniformInt(2, 6);
        p.hp -= d;
        this.log.add(`A trapdoor yawns open beneath you — you plunge through, landing hard for ${d}!`, "bad");
        if (p.hp <= 0) { this.killPlayer(p); return; }
        this.descend(); // fall to the floor below (it draws + recomputes FOV itself)
        return;
      }
    }
    if (p.hp <= 0) this.killPlayer(p);
  }

  // ── co-op session (peer-authoritative, deterministic lockstep over WebRTC) ───────────────────────
  // Both peers run the FULL simulation from a shared seed and exchange only keystrokes; each renders
  // its own player's view locally. No host/guest authority asymmetry beyond who picks the seed.
  /** Host: pick the shared seed, send it, and build the world. */
  startCoopHost(peer: Peer, mode: CoopMode): void {
    this.netRole = "host"; this.peer = peer; this.coopMode = mode; this.coop = true;
    this.wireCoopPeer(peer);
    this.wireCoopLog();
    this.showChatBar(true);
    const seed = this.freshSeed();
    peer.send({ t: "start", mode, seed, archetype: this.archetypeId }); // share the seed + the Host's class so both build it identically
    this.log.add("Co-op hosted — you are the cream @ (Host); your partner is the teal @ (Guest).", "sys", "both");
    this.newGame(seed); // both peers build the identical world from this seed
  }

  /** Guest: join, then build the identical world when the host's `start` (with seed) arrives. */
  startCoopGuest(peer: Peer): void {
    this.netRole = "guest"; this.peer = peer; this.coop = true;
    this.wireCoopPeer(peer);
    this.wireCoopLog();
    this.showChatBar(true);
    this.log.add("Linked as Guest — waiting for the host's dungeon…", "sys", "both");
  }

  private freshSeed(): number { return (Math.random() * 0x7fffffff) | 0; }

  /** Common peer wiring for both roles: apply the partner's keystrokes; rebuild on start/restart. */
  private wireCoopPeer(peer: Peer): void {
    peer.onMessage((m: NetMsg) => {
      if (m?.t === "start") { this.coopMode = m.mode; this.archetypeId = m.archetype; this.newGame(m.seed); }   // build the shared world (Host's class)
      else if (m?.t === "restart") { this.archetypeId = m.archetype; this.newGame(m.seed); }                    // reseeded new run
      else if (m?.t === "input" && typeof m.key === "string") this.remoteInput(m.key);
      else if (m?.t === "chat" && typeof m.text === "string") this.receiveChat(m.text, m.power ?? "say");
    });
    peer.onState((open) => {
      if (open) return;
      this.log.add("Partner disconnected — playing on alone.", "bad", "both");
      this.showChatBar(false);
      const r = this.remotePlayer;
      if (r) { r.cancelTurn(); this.scheduler.remove(r); if (r === this.coPlayer) this.coPlayer = null; this.draw(); } // unstick the clock
    });
  }

  /** Each client paints only the log lines its LOCAL adventurer is the audience for (both sims agree). */
  private wireCoopLog(): void {
    this.log.audience = (who) => {
      const lp = this.localPlayer;
      return who === "both" || (who ? who === lp : this.acting === lp);
    };
  }

  /** Co-op lockstep: when the LOCAL player consumes (executes) a queued action, broadcast it so the
   *  peer replays the same turn. Keys that arrived from the peer (remote player) aren't re-sent, and
   *  queued-but-unexecuted actions are never sent — so a local LIFO undo needs no network sync. */
  onLocalConsume(player: Player, key: string): void {
    if (this.coop && this.netRole !== "solo" && player === this.localPlayer) this.peer?.send({ t: "input", key });
  }

  /** Apply a keystroke the partner broadcast for THEIR avatar (the remote player on this client).
   *  Never gated on `this.busy` — that's a local-UI flag; dropping a remote key would desync the
   *  shared sim. feed() just queues; the engine consumes it on the remote player's own turn. */
  private remoteInput(key: string): void {
    if (this.over) { if ((key === "r" || key === "R") && this.netRole === "host") this.restartRun(); return; }
    const r = this.remotePlayer;
    if (r && r.alive) r.feed(key);
  }

  /** Restart: the host reseeds + tells the guest; solo just rerolls. */
  private restartRun(): void {
    if (this.netRole === "host") { const seed = this.freshSeed(); this.peer?.send({ t: "restart", seed, archetype: this.archetypeId }); this.newGame(seed); }
    else this.newGame();
  }

  // ── input + render ───────────────────────────────────────────────────────
  // ═══ DEBUG / GOD MODE — developer testing only; remove this whole block for release ═══════
  /** Intercept a key as a debug command (backtick = prefix, then one command key). */
  private debugIntercept(key: string): boolean {
    if (this.debugPending) { this.debugPending = false; this.debugCommand(key); return true; }
    if (key === "`") {
      this.debugPending = true;
      this.log.add(`[DEBUG] cmd? d/u down/up · 1-9 warp · 0 →d${MAX_DEPTH} square · m Mines · v Vault · x XCM · Q quest · g Gehennom · F Fort@16 · J JAM@${GEHENNOM_BOTTOM} · P Planes · r reveal · h heal · G god · k mob · K kit · T/t →stair`, "sys");
      this.draw();
      return true;
    }
    return false;
  }

  private debugCommand(key: string): void {
    const p = this.player;
    if (key === "0") { this.debugWarp(MAX_DEPTH); this.log.add(`[DEBUG] warp → depth ${MAX_DEPTH} (the vibrating square).`, "sys"); return; }
    if (key >= "1" && key <= "9") { this.debugWarp(Number(key)); this.log.add(`[DEBUG] warp → depth ${key}.`, "sys"); return; }
    switch (key) {
      case "d": this.log.add("[DEBUG] force descend.", "sys"); this.descend(); break;
      case "u": this.log.add("[DEBUG] force ascend.", "sys"); this.ascend(); break;
      case "m": { const b = branchById("mines"); if (b) this.enterBranch(b); break; }
      case "v": { const b = branchById("vault"); if (b) this.enterBranch(b); else this.log.add("[DEBUG] no Vault branch defined.", "dim"); break; }
      case "t": { const b = branchById("tower"); if (b) this.enterBranch(b); else this.log.add("[DEBUG] no Tower branch defined.", "dim"); break; }
      case "w": { this.acting = p; this.giveItem(itemById("wand_wish")!, { buc: "blessed", bucKnown: true }); this.log.add("[DEBUG] a wand of wishing drops into your pack (z to wish).", "sys"); this.draw(); break; }
      case "x": { const c = ROT.RNG.getItem(CHAINS)!; if (!this.level.portalAt(p.x, p.y)) this.level.portals.push({ x: p.x, y: p.y, chain: c }); this.level.tiles[p.y][p.x] = "portal"; this.recomputeFOV(); this.draw(); this.log.add(`[DEBUG] XCM portal to ${c.name} under you — press > to enter.`, "sys"); break; }
      case "Q": { if (!this.level.portalAt(p.x, p.y)) this.level.portals.push({ x: p.x, y: p.y, chain: CHAINS[0], quest: true }); this.level.tiles[p.y][p.x] = "portal"; this.recomputeFOV(); this.draw(); this.log.add("[DEBUG] quest portal under you — press > to enter.", "sys"); break; }
      case "g": this.gehennomOpen = true; this.debugWarp(MAX_DEPTH + 1); this.log.add(`[DEBUG] Gehennom opened, warped to depth ${MAX_DEPTH + 1}.`, "sys"); break;
      case "F": this.gehennomOpen = true; this.debugWarp(36); this.log.add("[DEBUG] warped to the Council Fort (d36).", "sys"); break;
      case "J": this.gehennomOpen = true; this.debugWarp(GEHENNOM_BOTTOM); this.log.add("[DEBUG] warped to the JAM floor (Moloch).", "sys"); break;
      case "P": this.player.hasJam = true; this.enterPlane(1); this.log.add("[DEBUG] → the Planes (JAM granted; < to climb).", "sys"); break;
      case "r": this.level.revealAll(); this.recomputeFOV(); this.draw(); this.log.add("[DEBUG] level revealed.", "sys"); break;
      case "h": this.debugHeal(p); if (this.coPlayer) this.debugHeal(this.coPlayer); this.draw(); this.log.add("[DEBUG] fully healed.", "sys"); break;
      case "G": this.godMode = !this.godMode; this.log.add(`[DEBUG] god mode ${this.godMode ? "ON" : "off"}.`, "sys"); break;
      case "k": this.debugSpawnMob(); break;
      case "K": this.debugKit(p); this.draw(); break;
      case "T": { const s = this.level.stairs; p.x = s.x; p.y = s.y; this.recomputeFOV(); this.draw(); this.log.add("[DEBUG] → down-stair.", "sys"); break; }
      case "t": { const s = this.level.start; p.x = s.x; p.y = s.y; this.recomputeFOV(); this.draw(); this.log.add("[DEBUG] → up-stair.", "sys"); break; }
      default: this.log.add(`[DEBUG] unknown command '${key}'.`, "dim"); break;
    }
  }

  /** DEBUG: free warp to a main-dungeon depth (drops any branch/chain/quest/plane). */
  private debugWarp(depth: number): void {
    this.currentChain = null; this.branchFloor = 0; this.inQuest = false; this.plane = 0;
    this.player.depth = depth;
    this.player.maxDepthReached = Math.max(this.player.maxDepthReached, depth);
    const restored = this.beginLevel(this.levelKey(), this.levelKindFor(depth));
    this.player.x = this.level.start.x; this.player.y = this.level.start.y;
    if (restored) this.restoreEnter();
    else { if (depth > 1) this.placeUpStair(); this.enterLevel(); this.saveActive(); }
    this.draw();
  }

  private debugHeal(p: Player): void {
    p.hp = p.maxHp; p.energy = p.maxEnergy;
    p.poison = 0; p.confused = 0; p.stoning = 0; p.illness = 0; p.blind = 0; p.silenced = 0; p.paralyzed = 0;
    p.nutrition = Math.max(p.nutrition, 900);
  }

  private debugSpawnMob(): void {
    const spot = this.adjacentFree(this.player.x, this.player.y);
    if (!spot) { this.log.add("[DEBUG] no room to spawn.", "dim"); return; }
    const def = this.pickMonster(Math.max(1, this.player.depth));
    const m = new Monster(this, def, spot.x, spot.y);
    this.monsters.push(m); this.scheduler.add(m, true);
    this.log.add(`[DEBUG] spawned ${def.name}.`, "sys"); this.draw();
  }

  private debugKit(p: Player): void {
    for (const id of ["bell", "candelabrum", "graybook", "vault", "hodlstone", "pickaxe", "wand_dig", "heal", "heal", "tele", "tele"]) {
      const t = itemById(id);
      if (t && !p.inventory.full) this.giveItem(t, { buc: "blessed", bucKnown: true });
    }
    this.log.add("[DEBUG] kit granted (3 relics, bag, luckstone, pickaxe, dig wand, potions, scrolls).", "sys");
  }

  /** DEBUG: a touch-friendly floating menu (mobile has no keyboard for the backtick commands). */
  private installMobileDebug(): void {
    if (typeof document === "undefined" || document.getElementById("debug-menu")) return;
    const wrap = document.createElement("div");
    wrap.id = "debug-menu";
    wrap.style.cssText = "position:fixed;left:6px;top:6px;z-index:99999;font:12px monospace;user-select:none;";
    const toggle = document.createElement("button");
    toggle.textContent = "🐞";
    toggle.style.cssText = "font-size:18px;line-height:1;padding:4px 8px;background:#15151a;color:#e0b94d;border:1px solid #c07a30;border-radius:6px;cursor:pointer;";
    const panel = document.createElement("div");
    panel.style.cssText = "display:none;flex-wrap:wrap;gap:4px;max-width:300px;margin-top:4px;background:#0c0c10f2;padding:6px;border:1px solid #c07a30;border-radius:6px;";
    toggle.onclick = () => { panel.style.display = panel.style.display === "none" ? "flex" : "none"; };
    const cmds: [string, () => void][] = [
      ["↓ down", () => this.debugCommand("d")], ["↑ up", () => this.debugCommand("u")],
      ["→ >stair", () => this.debugCommand("T")], ["→ <stair", () => this.debugCommand("t")],
      ["reveal", () => this.debugCommand("r")], ["heal", () => this.debugCommand("h")],
      ["god", () => this.debugCommand("G")], ["kit", () => this.debugCommand("K")], ["mob", () => this.debugCommand("k")],
      ["Mines", () => this.debugCommand("m")], ["Vault", () => this.debugCommand("v")],
      ["XCM", () => this.debugCommand("x")], ["Quest", () => this.debugCommand("Q")], ["Planes", () => this.debugCommand("P")],
      ["d3", () => this.debugWarp(3)], ["d6", () => this.debugWarp(6)], ["d9", () => this.debugWarp(9)],
      [`sqr d${MAX_DEPTH}`, () => this.debugWarp(MAX_DEPTH)], ["Gehnm", () => this.debugCommand("g")],
      ["Fort16", () => this.debugCommand("F")], ["JAM", () => this.debugCommand("J")],
    ];
    for (const [label, fn] of cmds) {
      const b = document.createElement("button");
      b.textContent = label;
      b.style.cssText = "padding:7px 8px;background:#1a1a20;color:#cfcf9a;border:1px solid #555;border-radius:4px;min-width:56px;cursor:pointer;";
      b.onclick = (e) => { e.preventDefault(); fn(); };
      panel.appendChild(b);
    }
    wrap.appendChild(toggle); wrap.appendChild(panel);
    document.body.appendChild(wrap);
  }
  // ═══ end DEBUG block ═══════════════════════════════════════════════════════

  private static readonly KONAMI = ["ArrowUp", "ArrowUp", "ArrowDown", "ArrowDown", "ArrowLeft", "ArrowRight", "ArrowLeft", "ArrowRight", "b", "a"];
  /** Track recent keys; on the full Konami code, toggle flavor. Returns true only on completion (consumes the key). */
  private konamiCheck(key: string): boolean {
    this.konami.push(key);
    if (this.konami.length > Game.KONAMI.length) this.konami.shift();
    if (this.konami.length === Game.KONAMI.length && Game.KONAMI.every((k, i) => k === this.konami[i])) {
      this.konami = [];
      this.toggleFlavorMode();
      return true;
    }
    return false;
  }

  /** Flip the whole game between the fantasy skin and the Polkadot skin, live. */
  private toggleFlavorMode(): void {
    const f = toggleFlavor();
    for (const slot of this.slots.values()) for (const m of slot.monsters) m.name = monName(m.def);
    for (const m of this.monsters) m.name = monName(m.def);
    if (this.pet) this.pet.name = fp("your hound", "your nominator");
    this.log.add(f === "fantasy"
      ? "✦ The chains fade — a classic dungeon of fantasy reveals itself."
      : "✦ The veil lifts — the Polkadot truth shows through.", "good");
    this.recomputeFOV();
    this.draw();
  }

  private onKey(e: KeyboardEvent): void {
    if (e.ctrlKey || e.metaKey || e.altKey) return; // let browser shortcuts (refresh, copy, devtools) through
    const ae = document.activeElement; // typing in a text field (chat box, lobby paste) must not drive the game
    if (ae && (ae.tagName === "INPUT" || ae.tagName === "TEXTAREA")) return;
    if (this.coop && this.netRole !== "solo" && (e.key === "\"" || e.key === "'")) { this.focusChat(); e.preventDefault(); return; } // open the chat box
    if (this.busy) { e.preventDefault(); return; } // frozen while a wallet tx settles
    if (this.over) {
      if (e.key === "r" || e.key === "R") {
        if (this.netRole === "guest") this.peer?.send({ t: "input", key: e.key }); // ask the host to reseed
        else this.restartRun();
      }
      e.preventDefault(); return;
    }
    if (this.coop && !this.localPlayer.alive) { e.preventDefault(); return; } // you're downed — spectate
    // Backspace = LIFO undo of the last queued action. Purely local: queued keys aren't broadcast
    // until they EXECUTE (see onLocalConsume), so an unexecuted action can be dropped with no sync.
    if (e.key === "Backspace") {
      this.localPlayer.popInput();
      this.renderQueue();
      e.preventDefault(); return;
    }
    if (this.konamiCheck(e.key)) { e.preventDefault(); return; } // cosmetic skin toggle — fully local, never fed/broadcast
    if (DEBUG && this.netRole === "solo" && this.debugIntercept(e.key)) { e.preventDefault(); return; } // debug: solo only (warps would desync co-op)
    this.localPlayer.feed(e.key); // queue locally; each action is broadcast as it executes (lockstep)
    this.renderQueue();
    e.preventDefault();
  }

  /** Build the renderable map as a flat cell list, from one viewer's fog of war.
   *  viewer 0 = host/solo, 1 = the co-op companion (each has separate sight + memory). */
  private buildCells(viewer = 0): Cell[] {
    const cells: Cell[] = [];
    const me = viewer === 1 ? this.coPlayer : this.player; // whose eyes we render through
    // co-op: render the viewer's OWN floor (it may differ from whatever floor is active)
    const onFloor = me ? me.floorKey : this.activeKey;
    const lvl = (onFloor === this.activeKey ? this.level : this.slots.get(onFloor)?.level) ?? this.level;
    const mons = (onFloor === this.activeKey ? this.monsters : this.slots.get(onFloor)?.monsters) ?? this.monsters;
    const vis = viewer === 1 ? (x: number, y: number) => lvl.isVisibleCo(x, y) : (x: number, y: number) => lvl.isVisible(x, y);
    const explored = viewer === 1 ? lvl.exploredCo : lvl.explored;
    for (let y = 0; y < MAP_H; y++) {
      for (let x = 0; x < W; x++) {
        const t = lvl.tileAt(x, y);
        if (!t) continue;
        const g = TILE_GLYPH[t];
        if (vis(x, y)) cells.push([x, y, g.ch, g.fg]);
        else if (explored[y][x]) cells.push([x, y, g.ch, g.fgDim]);
      }
    }
    for (const g of lvl.graves) if (vis(g.x, g.y)) cells.push([g.x, g.y, "‡", "#b0a890"]);
    for (const t of lvl.traps) {
      if (t.revealed && vis(t.x, t.y)) cells.push([t.x, t.y, "^", "#d06060"]);
      else if (t.detected) cells.push([t.x, t.y, "^", "#7a4040"]); // sensed by trap detection — dim, out of sight
    }
    for (const pr of lvl.portals) if (vis(pr.x, pr.y)) cells.push([pr.x, pr.y, "Ω", pr.chain.color]);
    for (const e of lvl.engravings) if (vis(e.x, e.y)) cells.push([e.x, e.y, "§", "#b0a060"]);
    for (const fi of lvl.items) {
      if (vis(fi.x, fi.y)) cells.push([fi.x, fi.y, fi.type.ch, fi.type.fg]);
      else if (fi.detected) cells.push([fi.x, fi.y, fi.type.ch, "#6c6a60"]); // sensed by treasure detection — dim
    }
    for (const b of lvl.boulders) if (vis(b.x, b.y)) cells.push([b.x, b.y, "0", "#9a8a6a"]);
    // Sense minds: only THIS viewer's blindness-telepathy or sense-minds spell reveals out-of-sight foes.
    const sensed = !!me && ((me.blind > 0 && me.intrinsics.has("telepathy")) || me.senseTurns > 0);
    const warn = !!me && me.warning; // a ring of warning shows nearby foes through walls
    for (const m of mons) {
      const near = warn && Math.max(Math.abs(m.x - me!.x), Math.abs(m.y - me!.y)) <= 5;
      if (!m.alive || !(vis(m.x, m.y) || sensed || near)) continue;
      if (m.invisible && !sensed && !near) continue; // cloaked — only ESP (sense minds / telepathy) or warning reveals it
      const dormant = m.def.mimic && !m.revealed && !near; // warning reveals a mimic for what it is
      cells.push([m.x, m.y, dormant ? m.disguiseCh : m.ch, dormant ? m.disguiseFg : m.fg]);
    }
    if (this.pet && this.pet.alive && this.pet.floorKey === onFloor && vis(this.pet.x, this.pet.y)) cells.push([this.pet.x, this.pet.y, this.pet.ch, this.pet.fg]);
    for (const pl of this.allPlayers()) {
      if (!pl.alive || pl.floorKey !== onFloor) continue; // only adventurers standing on this viewer's floor
      if (pl !== me && !(vis(pl.x, pl.y) || sensed)) continue; // you always see yourself; your partner only when in sight
      const ch = pl.polyForm ? pl.polyForm.ch : "@"; // you wear your fork's shape
      const fg = pl.polyForm ? pl.polyForm.fg : pl === this.player ? pl.fg : PARTNER_FG;
      cells.push([pl.x, pl.y, ch, fg]);
    }
    return cells;
  }

  private buildHud(p: Player): string {
    const hpCol = p.hp <= p.maxHp * 0.3 ? COLORS.bad : COLORS.good;
    const hunger = p.hungerWord();
    const ctx = this.contextOf(p.floorKey); // each adventurer's location, from its own floor
    return (
      `%c{${COLORS.dim}}HP %c{${hpCol}}${p.hp}%c{${COLORS.dim}}/${p.maxHp}  Lv %c{${COLORS.good}}${p.level}%c{${COLORS.dim}}  ` +
      (ctx.plane > 0
        ? `%c{#ff60ff}${PLANES[ctx.plane - 1].name}`
        : `Depth %c{${COLORS.gold}}${p.depth}` +
          (ctx.inQuest ? `%c{${COLORS.dim}} @%c{#e0c040}Quest` : ctx.chain ? `%c{${COLORS.dim}} @%c{${ctx.chain.color}}${ctx.chain.name}` : `%c{${COLORS.dim}} @%c{${COLORS.dim}}Relay`)) +
      `%c{${COLORS.dim}}  AC %c{${COLORS.good}}${p.ac}` +
      (p.maxEnergy > 5 || p.spells.size ? `%c{${COLORS.dim}}  En %c{#7aa0e0}${p.energy}%c{${COLORS.dim}}/${p.maxEnergy}` : "") +
      (this.luckOf(p) !== 0 ? `%c{${COLORS.dim}}  Luck %c{${this.luckOf(p) > 0 ? COLORS.good : COLORS.bad}}${this.luckOf(p) > 0 ? "+" : ""}${this.luckOf(p)}` : "") +
      (p.polyForm ? `%c{${COLORS.dim}}  %c{#d070d0}Fork:${p.polyForm.name.replace(/^an? /, "")} ${p.polyTurns}` : "") +
      `%c{${COLORS.dim}}  Gold %c{${COLORS.gold}}${p.gold}` +
      (this.wallet && !this.coop ? `%c{${COLORS.dim}}  PAS %c{${COLORS.gold}}${p.pas.toFixed(1)}` : "") +
      (hunger ? `%c{${COLORS.dim}}  %c{${COLORS.bad}}${hunger}` : "") +
      (p.paralyzed > 0 ? `%c{${COLORS.dim}}  %c{${COLORS.bad}}Para${p.paralyzed}` : "") +
      (p.engulfedBy ? `%c{${COLORS.dim}}  %c{${COLORS.bad}}Swallowed` : "") +
      (p.webbed > 0 ? `%c{${COLORS.dim}}  %c{${COLORS.bad}}Webbed${p.webbed}` : "") +
      (p.poison > 0 ? `%c{${COLORS.dim}}  %c{${COLORS.bad}}Psn` : "") +
      (p.confused > 0 ? `%c{${COLORS.dim}}  %c{${COLORS.bad}}Cfz` : "") +
      (p.stoning > 0 ? `%c{${COLORS.dim}}  %c{${COLORS.bad}}Ston${p.stoning}` : "") +
      (p.illness > 0 ? `%c{${COLORS.dim}}  %c{${COLORS.bad}}Ill${p.illness}` : "") +
      (p.blind > 0 ? `%c{${COLORS.dim}}  %c{${COLORS.bad}}Blind` : "") +
      (p.silenced > 0 ? `%c{${COLORS.dim}}  %c{${COLORS.bad}}Silent` : "") +
      (p.lycanthrope ? `%c{${COLORS.dim}}  %c{${COLORS.bad}}Lycan` : "") +
      (p.intrinsics.has("fast") ? `%c{${COLORS.dim}}  %c{${COLORS.good}}Fast` : "") +
      (this.hasLight(p) ? `%c{${COLORS.dim}}  %c{${COLORS.gold}}Lit` : "") +
      (p.hasJam ? `%c{${COLORS.dim}}  %c{${COLORS.gold}}✦JAM — ASCEND (<)` : this.jamStolen ? `%c{${COLORS.dim}}  %c{${COLORS.bad}}JAM STOLEN — slay the Censor!` : `%c{${COLORS.dim}}  ${this.gehennomOpen ? `JAM: depth ${GEHENNOM_BOTTOM}` : `Invoke @ depth ${MAX_DEPTH}`}`)
    );
  }

  private buildHuds(): [string, string] {
    return [skin(this.buildHud(this.player)), this.coPlayer ? skin(this.buildHud(this.coPlayer)) : ""];
  }

  draw(): void {
    if (!this.player) return;
    const lp = this.localPlayer;
    // Anchor music + my view to MY floor, then restore the acting context so draw() stays
    // side-effect-free for callers that keep working on the active floor afterwards.
    const resume = this.activeKey;
    if (lp.alive) this.setActive(lp.floorKey);
    this.music.setContext(this.musicContext()); // threat, danger, and reactions — for MY floor
    const huds = this.buildHuds();
    // my own fog; if I'm downed, spectate my partner's view
    const view = lp.alive ? this.localViewer : (this.localViewer === 0 ? 1 : 0);
    const cells = this.buildCells(view);
    this.display.clear();
    for (const [x, y, ch, fg] of cells) this.display.draw(x, y, ch, fg, COLORS.bg);
    this.display.drawText(1, MAP_H + 1, huds[view] || huds[0]);
    if (this.activeKey !== resume) this.setActive(resume); // restore the acting floor
    this.renderQueue(); // keep the queued-action badge current as turns consume
  }
}
