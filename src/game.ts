import * as ROT from "rot-js";
import { Level, Trap, TrapKind, LevelKind } from "./level";
import { Entity, Player, Monster, Pet } from "./entities";
import { Item } from "./inventory";
import { Log } from "./log";
import {
  COLORS, TILE_GLYPH, TileType, MONSTERS, MonsterDef, deaths, greetings,
  MAX_DEPTH, CENSOR, MOLOCH, MINIBOSSES, HONEYPOT, SHOPKEEPER, PRIEST, realmName, grayPaper, ChainDef, CHAINS, BranchDef, BRANCHES, branchById, questFor,
  abilityMod, archetypeById, ATTRS, ATTR_LABEL, spellById, Ethos,
  monName, questHomeland, archetypeName, ethosName, spellName, chainName, branchEnd, branchEntryFlavor,
} from "./data";
import { fp, skin, toggleFlavor } from "./flavor";
import { Idents, ITEMS, JAM, CORPSE, CHEST, WRITABLE_SCROLLS, pickItemType, ItemType, EffectId, itemById, isGear, Buc, rollBuc, bucDelta } from "./items";
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

const PRICE: Record<string, number> = { weapon: 6, armor: 5, potion: 4, scroll: 4, food: 2 };

const W = 80;
const MAP_H = 30;
const H = MAP_H + 2; // + a blank row + the status line
const MEMPOOL_DEPTH = 8; // the Big Room special level — "the Mempool"
const GEHENNOM_BOTTOM = 20; // after the Invocation the dungeon opens to here — Moloch + the JAM (Gehennom spans MAX_DEPTH+1 .. here)
const PLANES = [ // the ascent above the surface — climb them with the JAM to the Genesis altar
  { name: "the Plane of Consensus", flavor: "The ground itself votes; agreement hums beneath your feet." },
  { name: "the Plane of Finality", flavor: "Nothing here can be undone — every step is irreversible." },
  { name: "the Plane of Light Clients", flavor: "Proofs drift like motes of dust; the whole sky is one header." },
  { name: "the Genesis Plane", flavor: "The first block hangs frozen above an altar of pure intent. Offer the JAM (O)." },
];
const RELIC_DEPTH: Record<number, string> = { 7: "bell", 9: "candelabrum", 11: "graybook" }; // the three Invocation relics, spread across the back half of the relay descent (all before MAX_DEPTH)
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
  ident!: Idents;
  monsters: Monster[] = [];
  pet: Pet | null = null;
  // Phase 15 — persistence: each visited level is generated once and stored, so revisiting
  // returns the *same* layout with its dropped items, bones, traps, and monsters' state.
  // Keyed by branch+depth ("dungeon:7", "kusama:1", "quest"). Planes are excluded — the ascent
  // only ever climbs up, so a plane is never revisited.
  private slots = new Map<string, { level: Level; monsters: Monster[] }>();
  private activeKey = "dungeon:1"; // the key of the level currently in this.level
  private currentChain: ChainDef | null = null; // null = the main relay-chain dungeon; a BranchDef when in a sub-dungeon (the Mines)
  private branchFloor = 0;        // 1-based floor within the current branch (0 = not in a branch)
  private branchReturnDepth = 0;  // the main-dungeon depth to restore on leaving the branch
  private defeatedBosses = new Set<number>();    // relay depths whose mini-boss is slain
  private gehennomOpen = false;                  // the Invocation has been performed — the Dark Forest lies below
  private plane = 0;                              // 0 = the dungeon; 1..PLANES.length = the ascent above the surface
  private genesisAltars: { x: number; y: number; ethos: Ethos }[] = []; // the three Astral altars — only your aligned one ascends
  private jamStolen = false;                     // THE CENSOR has snatched the JAM — slay the hunter to reclaim it
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
  coopMode: CoopMode = "coop";
  private coop = false;        // this game session has two players
  private peer: Peer | null = null;
  private downed = new Set<Player>(); // players who have fallen this run
  archetypeId = "validator";   // the local player's chosen archetype (applied on newGame)
  turn = 0;                    // global turn clock (drives corpse rot)

  constructor(screen: HTMLElement, logEl: HTMLElement) {
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
  newGame(): void {
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
    this.branchReturnDepth = 0;
    this.slots.clear();
    this.activeKey = "dungeon:1";
    this.ident = new Idents();
    this.level = new Level(W, MAP_H);
    this.player = new Player(this, this.level.start.x, this.level.start.y);
    this.acting = this.player;
    this.giveStartingKit(this.player);
    this.applyArchetype(this.player, this.archetypeId);
    if (this.coop) {
      // Two adventurers descend together; perspective-neutral names for the shared log.
      this.player.name = "Host";
      const spot = this.adjacentFree(this.level.start.x, this.level.start.y) ?? this.level.start;
      this.coPlayer = new Player(this, spot.x, spot.y);
      this.coPlayer.name = "Guest";
      this.giveStartingKit(this.coPlayer);
      this.applyArchetype(this.coPlayer, "nominator"); // the partner runs as a Nominator in co-op v1
      this.pet = null; // no nominators in co-op v1
    } else {
      this.coPlayer = null;
      this.pet = new Pet(this, this.level.start.x, this.level.start.y);
    }
    this.enterLevel();
    this.saveActive(); // register depth 1 in the level store
    this.log.add(ROT.RNG.getItem(greetings())!, "sys");
    for (const line of grayPaper()) this.log.add(line, "dim");
    if (this.coop) this.log.add(`Co-op (${this.coopMode}) — Host and Guest share this dungeon. Find the JAM together.`, "sys");
    else this.log.add("Your nominator (d) pads at your heels — it backs you, and bites for you.", "dim");
    this.log.add("Keys: move · , pick up · o open chest · @ sheet · p buy · F forge · P pray · O offer · q faucet · s search/sit · z zap · Z cast · t throw · a apply · E engrave · < > stairs · i/w/W/q/r/e/d items.", "dim");
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
    const deed = await readDeed(this.wallet.address);
    if (deed) this.log.add(`✦ This wallet bears a soulbound Deed of Ascension (#${deed.tokenId}, depth ${deed.depth}) — you have ascended before.`, "good");
  }

  /** Forge a held piece of gear into a tradeable NFT relic — a direct wallet tx.
   *  The contract rolls rarity on-chain (Common→Legendary), which lifts the enchant. */
  async forge(item: Item): Promise<void> {
    if (this.busy) return;
    if (this.coop) { this.log.add("Shops & forging are solo-only in co-op for now.", "dim"); return; }
    if (!this.wallet) { this.log.add("Connect a wallet to forge a relic.", "bad"); return; }
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

  showCharSheet(): void {
    const p = this.acting;
    this.log.add(`— ${p.name === "you" ? "You" : p.name}, ${p.title ? p.title + " " : ""}${archetypeName(archetypeById(p.archetype))} · ${ethosName(p.ethos)} · epoch ${p.level} —`, "sys");
    this.log.add(`  ${ATTRS.map((a) => `${ATTR_LABEL[a]} ${p[a]}`).join("  ")}`, "dim");
    this.log.add(`  HP ${p.hp}/${p.maxHp}  AC ${p.ac}  Fortune ${this.luckOf(p) >= 0 ? "+" : ""}${this.luckOf(p)}  XP ${p.xp}/${this.xpForLevel(p.level + 1)}`, "dim");
    const intr = [...p.intrinsics].map((i) => ({ poisonResist: "poison resist", petrifyResist: "petrify resist", fast: "fast", telepathy: "telepathy" } as Record<string, string>)[i] ?? i);
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
    this.log.add(`— ${fp("Character record", "Audit report")}: ${p.name === "you" ? "you" : p.name}, ${p.title ? p.title + " " : ""}${archetypeName(archetypeById(p.archetype))} —`, "sys");
    this.log.add(`  ${ethosName(p.ethos)} · epoch ${p.level} · XP ${p.xp}/${this.xpForLevel(p.level + 1)}${p.crowned ? ` · ${fp("Knighted", "Technical Fellowship")} ${p.title}` : ""}.`, "dim");
    this.log.add(`  ${ATTRS.map((a) => `${ATTR_LABEL[a]} ${p[a]}`).join("  ")}`, "dim");
    this.log.add(`  HP ${p.hp}/${p.maxHp}  AC ${p.ac}  En ${p.energy}/${p.maxEnergy}  Speed ${p.getSpeed()}  Fortune ${this.luckOf(p) >= 0 ? "+" : ""}${this.luckOf(p)}.`, "dim");
    // weapon skills
    const skills = Object.keys(p.skillXp);
    if (skills.length) this.log.add(`  Skills: ${skills.map((c) => `${SKILL_LABEL[c] ?? c} ${SKILL_RANKS[p.skillRank[c] ?? 0]}`).join(", ")}.`, "dim");
    // intrinsics + spells
    const intr = [...p.intrinsics].map((i) => ({ poisonResist: "poison resist", petrifyResist: "petrify resist", fast: "fast", telepathy: "telepathy" } as Record<string, string>)[i] ?? i);
    if (intr.length) this.log.add(`  Intrinsics: ${intr.join(", ")}.`, "good");
    if (p.spells.size) this.log.add(`  Extrinsics: ${[...p.spells].map((id) => spellById(id)?.name ?? id).join(", ")}.`, "dim");
    // active afflictions / timeouts
    const fx: string[] = [];
    if (p.poison > 0) fx.push(`poisoned ${p.poison}`);
    if (p.confused > 0) fx.push(`confused ${p.confused}`);
    if (p.blind > 0) fx.push(`blind ${p.blind}`);
    if (p.stoning > 0) fx.push(`STONING ${p.stoning}`);
    if (p.illness > 0) fx.push(`ill ${p.illness}`);
    if (p.hasteTurns > 0) fx.push(`hasted ${p.hasteTurns}`);
    if (p.senseTurns > 0) fx.push(`mind-sense ${p.senseTurns}`);
    if (p.polyForm) fx.push(`forked → ${p.polyForm.name.replace(/^an? /, "")} ${p.polyTurns}`);
    this.log.add(`  Status: ${fx.length ? fx.join(", ") : "clear"}.`, fx.some((s) => /STONING|ill|poison/.test(s)) ? "bad" : "dim");
    // progress + the endgame
    const relics = ["bell", "candelabrum", "graybook"].filter((id) => p.inventory.items.some((it) => it.type.id === id)).map((id) => itemById(id)!.name);
    this.log.add(`  Depth ${p.depth} (deepest ${p.maxDepthReached})${this.gehennomOpen ? " · Gehennom open" : ""}${p.hasJam ? " · BEARS THE JAM" : this.jamStolen ? " · JAM stolen" : ""}.`, "dim");
    this.log.add(`  Invocation relics held: ${relics.length ? relics.join(", ") : "none"}.`, relics.length === 3 ? "good" : "dim");
    // conducts
    const kept = CONDUCTS.filter((c) => p.conducts.has(c.id));
    this.log.add(`  Vows kept: ${kept.length ? kept.map((c) => c.label).join(", ") : "none"}.`, kept.length ? "good" : "dim");
    // on-chain
    if (this.wallet) this.log.add(`  Wallet ${this.wallet.address.slice(0, 6)}…${this.wallet.address.slice(-4)} · ${p.pas.toFixed(1)} PAS · ${this.loadedRelics.size} relic(s) loaded.`, "sys");
    else this.log.add("  Off-chain (no wallet connected).", "dim");
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
    if (this.currentChain) return `${this.currentChain.id}:${this.player.depth}`;
    return `dungeon:${this.player.depth}`;
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

  /** Re-enter an already-generated level: re-place the party beside the arriving player and
   *  rebuild the schedule from the stored (frozen) actors. No respawn, no new loot. */
  private restoreEnter(): void {
    // a monster may have frozen on the very stair we arrive at — step the player to a free neighbour
    if (this.monsterAt(this.player.x, this.player.y)) {
      const spot = this.adjacentFree(this.player.x, this.player.y);
      if (spot) { this.player.x = spot.x; this.player.y = spot.y; }
    }
    this.placeParty();
    this.scheduleParty();
  }

  /** Populate a freshly generated level, then place the party and build the schedule. */
  private enterLevel(): void {
    this.monsters = [];
    if (this.plane > 0) {
      this.setupPlane();
    } else {
      const cozy = this.level.kind !== "maze"; // Gehennom's mazes have no shops, faucets, thrones, or chests
      this.spawnMonsters();
      this.spawnItems();
      if (cozy) {
        this.spawnShop();
        this.placeAltar();
        this.placeFeature("faucet", 0.3);
        this.placeFeature("throne", 0.16);
        this.placeChest(0.35);
        this.placeBoulders();
        this.placeSpecialRoom();
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
    this.placeParty();
    this.scheduleParty();
  }

  /** Place the co-op partner and the pet beside the arriving player (the party travels together). */
  private placeParty(): void {
    if (this.coPlayer && this.coPlayer.alive) {
      const spot = this.adjacentFree(this.player.x, this.player.y);
      if (spot) { this.coPlayer.x = spot.x; this.coPlayer.y = spot.y; }
      else { this.coPlayer.x = this.player.x; this.coPlayer.y = this.player.y; }
      this.coPlayer.depth = this.player.depth; // shared depth for the HUD
    }
    if (this.pet && this.pet.alive) {
      const spot = this.adjacentFree(this.player.x, this.player.y);
      if (spot) { this.pet.x = spot.x; this.pet.y = spot.y; }
    }
  }

  /** Rebuild the turn scheduler around the active level's actors (only the active level runs). */
  private scheduleParty(): void {
    this.scheduler.clear();
    this.scheduler.add(this.player, true);
    if (this.coPlayer && this.coPlayer.alive) this.scheduler.add(this.coPlayer, true);
    for (const m of this.monsters) if (m.alive) this.scheduler.add(m, true);
    if (this.pet && this.pet.alive) this.scheduler.add(this.pet, true);
    this.recomputeFOV();
    this.music.setArea(this.currentAreaId()); // crossfade to this area's soundtrack
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
  livingPlayers(): Player[] { return this.allPlayers().filter((p) => p.alive); }
  playerAt(x: number, y: number): Player | undefined { return this.allPlayers().find((p) => p.alive && p.x === x && p.y === y); }
  otherPlayerAt(self: Player, x: number, y: number): Player | undefined {
    return this.allPlayers().find((p) => p !== self && p.alive && p.x === x && p.y === y);
  }
  /** The living party member closest (Chebyshev) to a point — whom a monster targets. */
  nearestPlayer(x: number, y: number): Player {
    const live = this.livingPlayers();
    if (live.length === 0) return this.player;
    const d = (p: Player) => Math.max(Math.abs(p.x - x), Math.abs(p.y - y));
    return live.reduce((a, b) => (d(b) < d(a) ? b : a));
  }
  /** Union field-of-view over the whole living party (shared vision). */
  recomputeFOV(): void {
    const list = this.livingPlayers().length ? this.livingPlayers() : [this.player];
    list.forEach((p, i) => {
      const r = p.blind > 0 ? 1 : 8; // blindness shrinks your sight to arm's reach
      if (i === 0) this.level.computeFOV(p.x, p.y, r);
      else this.level.addFOV(p.x, p.y, r);
    });
  }

  descend(): void {
    if (this.branch) { this.descendBranch(); return; } // floor-by-floor within a sub-dungeon
    this.player.depth++;
    this.player.maxDepthReached = Math.max(this.player.maxDepthReached, this.player.depth);
    const kind = this.currentChain ? "normal" : this.levelKindFor(this.player.depth);
    const restored = this.beginLevel(this.levelKey(), kind);
    this.player.x = this.level.start.x; // arrive at this level's up-stair (its start)
    this.player.y = this.level.start.y;
    if (restored) {
      this.restoreEnter();
    } else {
      this.placeUpStair();
      this.enterLevel();
      this.saveActive();
    }
    if (this.level.kind === "bigroom") this.log.add("You descend into THE MEMPOOL — a vast open churn of pending chaos. Loot, and a swarm.", "bad");
    else if (this.level.kind === "maze") this.log.add(`You descend into the maze of ${realmName(this.player.depth)} — narrow, lightless, and patient.`, "bad");
    else this.log.add(`You descend to depth ${this.player.depth} — ${realmName(this.player.depth)}.`, this.player.depth >= 9 ? "bad" : "sys");
    if (this.player.depth >= 9 && this.player.depth < MAX_DEPTH) this.log.add("Chaos thickens. Expect Kusama.", "bad");
    if (this.player.depth === MAX_DEPTH && !this.gehennomOpen) this.log.add("The foot of the relay. The vibrating square (≈) hums — perform the Invocation (I) with all three relics.", "bad");
    else if (this.player.depth === MAX_DEPTH) this.log.add("The foot of the relay — the gate to the Dark Forest stands open below. (>)", "bad");
    else if (this.player.depth > MAX_DEPTH && this.player.depth < GEHENNOM_BOTTOM) this.log.add("You sink into the Dark Forest — Gehennom. Censorship weeps from the walls.", "bad");
    else if (this.player.depth >= GEHENNOM_BOTTOM) this.log.add("The bottom of all things. MOLOCH, the Central Planner, hoards the JAM here.", "bad");
    this.draw();
  }

  // ── XCM: parachain side-branches (each scales difficulty × loot) ────────────
  private placePortals(): void {
    if (this.currentChain || this.player.depth < 2 || this.player.depth >= MAX_DEPTH) return; // XCM branches off the relay descent (d2 .. foot of the relay), not Gehennom
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
    const restored = this.beginLevel(this.levelKey(), (chain.layout as LevelKind) ?? "normal"); // each parachain has a signature layout
    this.player.x = this.level.start.x;
    this.player.y = this.level.start.y;
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
    this.player.x = this.level.stairs.x; // back on the relay, at its down-stair
    this.player.y = this.level.stairs.y;
    if (restored) {
      this.restoreEnter();
    } else {
      if (this.player.depth > 1) this.placeUpStair();
      this.enterLevel();
      this.saveActive();
    }
    this.log.add(`XCM ← you return from ${from} to the relay at depth ${this.player.depth}.`, "sys");
    this.draw();
  }

  // ── Phase 16: sub-dungeon branches (the Mines) ──────────────────────────────
  /** Drop a branch-stair onto its host depth on the main descent (the Mines entrance). */
  private placeBranchEntrance(): void {
    if (this.currentChain) return; // branches root in the main dungeon only
    for (const b of BRANCHES) {
      if (this.player.depth !== b.entryDepth) continue;
      if (this.level.branchEntries.some((e) => e.branchId === b.id)) continue;
      const centers = this.level.roomCenters.filter(
        (c) => this.level.tileAt(c.x, c.y) === "floor" && !(c.x === this.player.x && c.y === this.player.y) && !this.level.portalAt(c.x, c.y),
      );
      const c = centers.length ? ROT.RNG.getItem(centers)! : this.level.randomFloor();
      this.level.tiles[c.y][c.x] = "branchDown";
      this.level.branchEntries.push({ x: c.x, y: c.y, branchId: b.id });
      this.log.add(`A craggy side-stair (a copper >) plunges off this floor toward ${b.name} — treasure caverns, with ${itemById(b.prizeId)!.name} at their End.`, "good");
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
    this.branchReturnDepth = this.player.depth;
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
      atEnd ? `You reach ${branchEnd(def)}. ${this.ident.name(itemById(def.prizeId)!)} gleams in the dark — and something guards it.`
            : `You press deeper into ${chainName(def)} — floor ${this.branchFloor} of ${def.floors}.`,
      "bad",
    );
    this.draw();
  }

  /** Climb up within the active branch; at its top, step back out onto the host relay depth. */
  private ascendBranch(): void {
    const def = this.branch!;
    if (this.branchFloor > 1) {
      this.enterBranchFloor(def, this.branchFloor - 1, "up");
      this.log.add(`You climb back up ${chainName(def)} — floor ${this.branchFloor} of ${def.floors}.`, "sys");
      this.draw();
      return;
    }
    // top floor → leave the branch, back onto the host relay level at the branch-stair
    this.currentChain = null;
    this.branchFloor = 0;
    this.player.depth = this.branchReturnDepth;
    const restored = this.beginLevel(this.levelKey(), this.levelKindFor(this.player.depth));
    const entry = this.level.branchEntries.find((e) => e.branchId === def.id);
    const at = entry ?? this.level.start;
    this.player.x = at.x; this.player.y = at.y;
    if (restored) {
      this.restoreEnter();
    } else {
      if (this.player.depth > 1) this.placeUpStair();
      this.enterLevel();
      this.saveActive();
    }
    this.log.add(`You climb out of ${def.name}, back onto the relay at depth ${this.player.depth}.`, "sys");
    this.draw();
  }

  /** Shared branch-floor entry: set state + effective depth, restore-or-generate, place the End prize. */
  private enterBranchFloor(def: BranchDef, floor: number, dir: "up" | "down"): void {
    this.currentChain = def;
    this.branchFloor = floor;
    this.player.depth = def.entryDepth + floor; // effective depth scales spawns/loot
    this.player.maxDepthReached = Math.max(this.player.maxDepthReached, this.player.depth);
    const restored = this.beginLevel(this.levelKey(), def.sokoban ? "sokoban" : (def.layout as LevelKind));
    if (!restored && def.sokoban) this.buildSokobanFloor(def, floor); // stamp the prefab (sets start/stairs) before we read them
    const arrive = dir === "down" ? this.level.start : this.level.stairs; // down→up-stair, up→down-stair
    this.player.x = arrive.x; this.player.y = arrive.y;
    if (restored) {
      this.restoreEnter();
    } else if (def.sokoban) {
      this.placeParty(); this.scheduleParty(); // a hand-built floor is fully populated by buildSokobanFloor — no procedural spawn
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
    if (prize && !this.level.itemAt(s.x, s.y)) this.level.items.push({ x: s.x, y: s.y, type: prize, buc: "blessed", bucKnown: true });
    const guard = MONSTERS.find((m) => m.ch === "O") ?? MONSTERS[MONSTERS.length - 1]; // a whale wards the hoard
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]] as [number, number][]) {
      const x = s.x + dx, y = s.y + dy;
      if (this.level.isPassable(x, y) && !this.monsterAt(x, y) && !(x === this.player.x && y === this.player.y)) {
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
    const q = questFor(this.player.archetype);
    if (this.player.depth !== q.portalDepth) return;
    const centers = this.level.roomCenters.filter((c) => this.level.tileAt(c.x, c.y) === "floor" && !this.level.portalAt(c.x, c.y) && !(c.x === this.player.x && c.y === this.player.y));
    const c = centers.length ? ROT.RNG.getItem(centers)! : this.level.randomFloor();
    this.level.tiles[c.y][c.x] = "portal";
    this.level.portals.push({ x: c.x, y: c.y, chain: CHAINS[0], quest: true });
    this.log.add(`A portal pulses with your homeland's sigil — your Quest awaits in ${questHomeland(q)} (Ω, > to enter). Slay your nemesis, claim your artifact.`, "good");
  }

  /** Enter the Quest homeland: your nemesis guards your signature artifact. */
  enterQuest(): void {
    const q = questFor(this.player.archetype);
    if (this.questDone) {
      // the homeland portal persists on the relay level now — spend it once the Quest is fulfilled
      this.level.tiles[this.player.y][this.player.x] = "floor";
      const pi = this.level.portals.findIndex((p) => p.x === this.player.x && p.y === this.player.y);
      if (pi >= 0) this.level.portals.splice(pi, 1);
      this.log.add("Your Quest is fulfilled — the homeland portal has gone dark.", "dim");
      this.recomputeFOV(); this.draw();
      return;
    }
    this.inQuest = true;
    this.currentChain = null;
    const restored = this.beginLevel(this.levelKey(), "normal");
    this.player.x = this.level.start.x;
    this.player.y = this.level.start.y;
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
    this.player.x = this.level.stairs.x;
    this.player.y = this.level.stairs.y;
    if (restored) {
      this.restoreEnter();
    } else {
      if (this.player.depth > 1) this.placeUpStair();
      this.enterLevel();
      this.saveActive();
    }
    this.log.add(`You return from your Quest to the relay at depth ${this.player.depth}.`, "sys");
    this.draw();
  }

  ascend(): void {
    if (this.inQuest) { this.exitQuest(); return; }
    if (this.branch) { this.ascendBranch(); return; } // climb within / out of a sub-dungeon
    if (this.currentChain) { this.exitChain(); return; }
    if (this.plane > 0) { this.enterPlane(this.plane + 1); return; } // climb higher through the Planes
    const holder = this.allPlayers().find((p) => p.hasJam);
    const newDepth = this.player.depth - 1;
    if (newDepth < 1) {
      // at the surface: the JAM drags you UPWARD into the Planes; without it, the world ends here
      if (holder) this.enterPlane(1);
      return;
    }
    this.player.depth = newDepth;
    const restored = this.beginLevel(this.levelKey(), this.levelKindFor(newDepth));
    this.player.x = this.level.stairs.x; // you climb up INTO the down-stairs of the level above
    this.player.y = this.level.stairs.y;
    if (restored) {
      this.restoreEnter();
    } else {
      if (newDepth > 1) this.placeUpStair();
      this.enterLevel();
      this.saveActive();
    }
    // with the JAM at the surface, a stair beyond the world opens upward into the Planes
    if (newDepth === 1 && holder) this.level.tiles[this.player.y][this.player.x] = "stairsUp";
    this.log.add(`You climb to depth ${newDepth} — ${realmName(newDepth)}.`, "sys");
    if (newDepth === 1 && holder) this.log.add("The surface is near — but the JAM hauls you UPWARD, past the world itself. Climb (<) into the Planes.", "good");
    this.draw();
  }

  /** Enter the n-th Plane of the ascent (1..PLANES.length). The last is the Genesis Plane. */
  private enterPlane(n: number): void {
    if (n > PLANES.length) return; // already atop the Genesis Plane — offer the JAM, don't climb
    this.saveActive(); // persist the dungeon level being left (planes themselves aren't stored — no path back down)
    this.plane = n;
    this.currentChain = null;
    this.level = new Level(W, MAP_H, PLANE_KINDS[n - 1] ?? "normal"); // each Plane its own layout
    this.player.x = this.level.start.x;
    this.player.y = this.level.start.y;
    this.enterLevel(); // routes through setupPlane() since plane > 0
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
    const hunting = this.allPlayers().some((q) => q.alive && q.hasJam) || this.jamStolen;
    if (!hunting) return;
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
    this.log.add("The air curdles and tears — THE CENSOR rises again. It will not let the JAM leave.", "bad");
    this.draw();
  }

  /** The hunting Censor snatches the JAM and level-blinks away — reclaim it by slaying it. */
  censorSteal(censor: Monster, holder: Player): void {
    holder.hasJam = false;
    this.jamStolen = true;
    this.log.add("THE CENSOR's hand closes on the JAM — it BLINKS away with your prize! Hunt it down.", "bad");
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
    const d = this.player.depth;
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
    const near = (m: Monster) => this.livingPlayers().some((p) => Math.max(Math.abs(m.x - p.x), Math.abs(m.y - p.y)) <= 1);
    for (const m of this.monsters) {
      if (!m.alive || m.peaceful) continue;
      if (near(m)) danger = Math.max(danger, 0.55);
      if ((m.def.boss || m.isHunter || m.def === MOLOCH || m.def === CENSOR) && this.level.isVisible(m.x, m.y)) danger = Math.max(danger, 0.9);
    }
    if (this.jamStolen) danger = Math.max(danger, 0.5);
    return danger;
  }

  /** The per-frame snapshot the music engine reacts to: distress, density, and nearby context. */
  private musicContext(): MusicContext {
    const p = this.player;
    // depth fraction across the descent; the Planes stay uneasy (a held undercurrent)
    const depthFrac = this.plane > 0 ? 0.62 : Math.min(1, (p.depth - 1) / (GEHENNOM_BOTTOM - 1));
    // peril: low HP, afflictions, being hunted
    let peril = 0;
    if (p.hp < p.maxHp * 0.4) peril = Math.max(peril, 1 - p.hp / (p.maxHp * 0.4));
    if (p.stoning > 0 || p.illness > 0) peril = Math.max(peril, 0.7);
    if (p.poison > 0) peril = Math.max(peril, 0.4);
    if (this.jamStolen || this.monsters.some((m) => m.alive && m.isHunter)) peril = Math.max(peril, 0.55);
    const distress = Math.min(1, depthFrac * 0.8 + peril * 0.45);
    const presence = Math.max(0.18, 1 - depthFrac * 0.7); // fuller shallow, sparser deep
    const vis = (m: Monster) => this.level.isVisible(m.x, m.y);
    const bossNear = this.monsters.some((m) => m.alive && (m.def.boss || m.isHunter || m.def === MOLOCH || m.def === CENSOR) && vis(m));
    const crowd = Math.min(1, this.monsters.filter((m) => m.alive && !m.peaceful && vis(m)).length / 6);
    const jamNear = this.allPlayers().some((q) => q.hasJam) || this.jamStolen || this.level.items.some((i) => i.type.id === "jam");
    const onFeat = (tile: string) => {
      for (const [dx, dy] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]] as [number, number][]) if (this.level.tileAt(p.x + dx, p.y + dy) === tile) return true;
      return false;
    };
    return { distress, presence, danger: this.dangerLevel(), bossNear, crowd, jamNear, faucet: onFeat("faucet"), altar: onFeat("altar") };
  }

  /** Which level layout a depth uses — the descent rotates through layout zones for variety. */
  private levelKindFor(depth: number): LevelKind {
    if (depth === MEMPOOL_DEPTH) return "bigroom";                  // the Mempool (d8)
    if (depth === GEHENNOM_BOTTOM) return "concentric";             // Moloch's ringed arena (d20)
    if (depth > MAX_DEPTH && depth < GEHENNOM_BOTTOM) return depth === 16 ? "fortress" : "maze"; // the Council Fort mid-Gehennom (d16), else mazes
    switch (depth) {                                                // the relay descent (d1–12)
      case 3: return "grid";        // a rollup metropolis
      case 4: return "cave";        // organic caverns (the Mines branch off here)
      case 6: return "labyrinth";   // a winding labyrinth
      case 7: return "cave";
      case 9: return "swamp";       // the Liquidity Pools — open water + islands
      case 10: return "grid";
      case 11: return "labyrinth";  // the Kusama deeps
      default: return "normal";     // d1, 2, 5, 12 (foot of the relay) + the Sanctum (d20)
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
      const kind = ROT.RNG.getItem(["temple", "zoo", "vault"])!;
      if (kind === "temple") this.makeTemple(c, open);
      else if (kind === "zoo") this.makeZoo(open);
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
    this.log.add(dropped ? `The chest holds ${dropped} item${dropped > 1 ? "s" : ""} — they spill out. (, to pick up)` : "The chest is empty.", dropped ? "good" : "dim");
    return true;
  }

  private trapName(k: TrapKind): string {
    return ({ gas: "gas-fee trap", slash: "slashing trap", reorg: "reorg trap", fork: "fork trap" } as Record<TrapKind, string>)[k];
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

  /** `c` — chat with an adjacent monster. A free social action; lore, banter, or a taunt. */
  chat(m: Monster): void {
    const d = m.def;
    let line: string;
    if (d.keeper) {
      line = m.peaceful
        ? ROT.RNG.getItem([
            "\"Welcome, anon. Pay the bill and the goods are yours — lift them and I'll have your keys.\"",
            "\"Liquidity's deep today. Drop your PAS on the counter, no slippage.\"",
            "\"I make markets in everything but trust. That, you bring yourself.\"",
          ])!
        : "\"THIEF! You'll settle this in blood, not blocks!\"";
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
      "%": "food — or a corpse you can eat (e)", "*": "an amulet or gem",
    };
    const mons = [...MONSTERS, SHOPKEEPER, PRIEST, HONEYPOT, CENSOR, MOLOCH, ...Object.values(MINIBOSSES)].find((m) => m.ch === key);
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
    p.poison = 0; p.confused = 0;
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
    if (this.coop && this.coopMode === "race") {
      this.log.add(`✦ ${cap(w.name)} seizes the JAM and ASCENDS — ${cap(w.name)} wins the race! ✦`, "good");
    } else if (this.coop) {
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
    this.log.add(ROT.RNG.getItem(deaths())!, "bad");
    this.log.add(`You fell at depth ${this.player.depth} (deepest ${this.player.maxDepthReached}). Press R to try again.`, "sys");
    this.conductReport(this.player);
    this.music.playStinger("death");
    this.draw();
    void this.recordResult(false);
    void this.showHallOfFame();
  }

  // ── on-chain persistence (Phase 4) ─────────────────────────────────────────
  private async recordResult(won: boolean): Promise<void> {
    if (!this.wallet) { this.log.add("(connect a wallet to etch this run on-chain)", "dim"); return; }
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
      this.log.add("The Marketmaker roars \"Bad debt!\" and turns lethal.", "bad");
    }
    // Striking a peaceful priest desecrates the shrine — it abandons restraint.
    if (d instanceof Monster && d.def.priest && d.peaceful) {
      d.peaceful = false; d.fg = "#ff5030";
      this.log.add("The priest's blessing curdles to wrath — \"Sacrilege!\"", "bad");
    }
    // A d20 to-hit layer: level + DEX + enchant vs the target's dodge. Misses happen now.
    if (!this.lands(a, d)) {
      if (a instanceof Player && d instanceof Monster) this.log.add(`${this.sub(a)} ${this.verbS(a, "miss")} ${d.name}.`, "dim");
      else if (a instanceof Monster && d instanceof Player) this.log.add(`${cap(a.name)} misses ${d.name}.`, "dim");
      return;
    }
    // Fighting on a warded tile scuffs the sigil away faster.
    if (a instanceof Player) { const e = this.level.engravingAt(a.x, a.y); if (e) e.life -= 3; }
    const [lo, hi] = a.attackDmg;
    let dmg = ROT.RNG.getUniformInt(lo, hi);
    if (a instanceof Player) dmg = Math.max(1, dmg + abilityMod(a.str) + this.skillDmgBonus(a)); // Stake-weight + trained skill drive the blow
    d.hp -= dmg;
    if (a instanceof Player && d instanceof Monster) this.noteSkillHit(a); // a landed blow trains the weapon's skill
    // A rust/corrosion striker (rust bug) eats away a random worn piece on a hit.
    if (a instanceof Monster && !a.cancelled && a.def.corrodes && d instanceof Player) this.corrodeArmor(d);
    if (a instanceof Player && d instanceof Monster) this.log.add(`${this.sub(a)} ${this.verbS(a, "strike")} ${d.name} for ${dmg}.`, "good");
    else if (a instanceof Monster && d instanceof Player) {
      this.log.add(`${cap(a.name)} hits ${d.name} for ${dmg}.`, "bad");
      if (!a.cancelled && a.def.inflict && d.hp > 0 && ROT.RNG.getUniform() < 0.3) this.applyStatus(d, a.def.inflict);
    }
    else if (a instanceof Player && d instanceof Player) this.log.add(`${this.sub(a)} ${this.verbS(a, "strike")} ${d.name} for ${dmg} — friendly fire!`, "bad");
    else if (a === this.pet) this.log.add(`Your nominator savages ${d.name} for ${dmg}.`, "good");
    else if (d === this.pet) this.log.add(`${cap(a.name)} mauls ${this.pet?.name ?? fp("your hound", "your nominator")} for ${dmg}.`, "bad");
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
        this.log.add(`${this.sub(a)} ${this.verbS(a, "follow")} up with the off-hand ${this.ident.name(a.offhand.type)} for ${od}.`, "good");
        if (d.hp <= 0) { this.gainXp(a, d.maxHp); this.kill(d); }
      } else this.log.add("Your off-hand swing goes wide.", "dim");
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
    if (a instanceof Player) acc = a.level + abilityMod(a.dex) + (a.weapon?.enchant ?? 0) + this.skillAccBonus(a) - (a.blind > 0 ? 3 : 0) + Math.round(this.luckOf(a) / 3); // weapon mastery + Fortune sway the roll; blind swings miss

    else if (a instanceof Monster) acc = 2 + Math.floor(a.maxHp / 8);
    if (d instanceof Player) eva = abilityMod(d.dex) + Math.floor(d.level / 3) + Math.floor(d.ac / 2) + Math.round(this.luckOf(d) / 3); // armor is dodge now; Fortune helps you slip
    else if (d instanceof Monster) eva = d.def.speed ? Math.max(0, Math.floor((d.def.speed - 100) / 12)) : 0;
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
    if (kind === "poison" && target.intrinsics.has("poisonResist")) { this.log.add(`${target.name === "you" ? "You resist" : target.name + " resists"} the toxin.`, "dim"); return; }
    if (kind === "poison") { target.poison = Math.max(target.poison, 6); this.log.add(`${target.name === "you" ? "You are" : target.name + " is"} poisoned!`, "bad"); }
    else { target.confused = Math.max(target.confused, 5); this.log.add(`${target.name === "you" ? "Your head spins" : target.name + "'s head spins"} — confused!`, "bad"); }
  }

  /** A ranged foe zaps the nearest party member (armor half-soaks; can still inflict status). */
  rangedAttack(a: Monster): void {
    const p = this.nearestPlayer(a.x, a.y);
    const [lo, hi] = a.attackDmg;
    let dmg = ROT.RNG.getUniformInt(lo, hi);
    if (p.ac > 0) dmg = Math.max(1, dmg - Math.floor(p.ac / 2));
    p.hp -= dmg;
    this.log.add(`${cap(a.name)} zaps ${p.name} from afar for ${dmg}!`, "bad");
    if (a.def.inflict && p.hp > 0 && ROT.RNG.getUniform() < 0.3) this.applyStatus(p, a.def.inflict);
    if (p.hp <= 0) this.kill(p);
  }

  /** A dragon breathes a damaging ray down the line toward the nearest party member. */
  breathAttack(m: Monster): void {
    const p = this.nearestPlayer(m.x, m.y);
    const dx = Math.sign(p.x - m.x), dy = Math.sign(p.y - m.y);
    if (dx === 0 && dy === 0) return;
    this.log.add(`${cap(m.name)} breathes a searing gout of finality!`, "bad");
    const max = m.def.breath ?? 10;
    this.castRay(m.x, m.y, dx, dy, 6, (e) => {
      if (e === m) return;
      const d = ROT.RNG.getUniformInt(Math.floor(max / 2), max);
      e.hp -= d;
      if (e instanceof Player) { this.log.add(`The breath sears ${e.name} for ${d}!`, "bad"); if (e.hp <= 0) this.killPlayer(e); }
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
      this.log.add(`${this.sub(p)} ${this.verbS(p, "collapse")} out of the fork.`, "bad");
      if (p.hp > 0) return;
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
    this.log.add(`${cap(p.name)} falls! The other adventurer presses on — recover the JAM.`, "bad");
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
    p.inventory.remove(it);
    return it;
  }

  /** Add an item to the pack, rolling wand charges. NFT relics carry enchant + a relic mark; every item gets a BUC. */
  giveItem(type: ItemType, opts?: { enchant?: number; relic?: boolean; buc?: Buc; bucKnown?: boolean }): Item {
    const it = this.acting.inventory.add(type);
    if (type.kind === "wand") it.charges = ROT.RNG.getUniformInt(3, 6);
    if (type.id === "marker") it.charges = ROT.RNG.getUniformInt(2, 4); // a contract deployer's gas
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
      } else if (item.type.id === "wand_cancel") {
        hit.cancelled = true;
        this.log.add(`${cap(hit.name)} is nullified — its powers fail.`, "good");
      } else if (item.type.id === "wand_probe") {
        const tr = [hit.def.inflict && `inflicts ${hit.def.inflict}`, hit.def.ranged && "ranged", hit.def.steals && "thief", hit.def.splits && "splits", hit.def.corrodes && "corrodes", hit.cancelled && "nullified"].filter(Boolean).join(", ");
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
    }
    this.draw();
    return true;
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
  applyHorn(p: Player): boolean {
    if (p.poison === 0 && p.confused === 0 && p.stoning === 0 && p.illness === 0 && p.blind === 0 && p.hp >= p.maxHp) {
      this.log.add("The auditor's horn finds nothing amiss.", "dim"); return false;
    }
    p.poison = 0; p.confused = 0; p.stoning = 0; p.illness = 0; p.blind = 0;
    p.hp = Math.min(p.maxHp, p.hp + ROT.RNG.getUniformInt(2, 6));
    this.recomputeFOV();
    this.log.add(`${this.sub(p)} ${this.verbS(p, "sound")} the auditor's horn — afflictions clear.`, "good");
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
      const tr = [m.def.inflict && `inflicts ${m.def.inflict}`, m.def.ranged && "ranged", m.def.steals && "thief", m.def.splits && "splits", m.def.corrodes && "corrodes", m.cancelled && "nullified", m.sleepTurns > 0 && "asleep"].filter(Boolean).join(", ");
      this.log.add(`State-read ${m.name}: ${m.hp}/${m.maxHp} HP${tr ? " · " + tr : ""}.`, "sys");
      return true;
    }
    return false;
  }

  /** Show the contract-deployer (magic marker) scroll menu. */
  promptWrite(): void {
    const menu = WRITABLE_SCROLLS.map((id, i) => `(${i + 1}) ${itemById(id)?.name ?? id}`).join("  ");
    this.log.add(`Deploy which scroll? ${menu}  (Esc to cancel)`, "sys");
  }

  // ── #loot: the multisig vault (bag of holding) ──
  /** An item can't be stashed while it's equipped (worn/wielded/on-hand/welded). */
  private lootLocked(p: Player, it: Item): boolean {
    return p.isWelded(it) || it === p.weapon || it === p.ring || p.wornArmor.includes(it);
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
    if (fi.chest) { this.log.add("It's a chest — press o to open it.", "dim"); return false; }
    if (fi.corpse) { this.log.add(`Best eaten where it lies — press e to eat the ${monName(fi.corpse.def)} corpse.`, "dim"); return false; }
    if (fi.type.id === "jam") {
      who.hasJam = true;
      this.level.items = this.level.items.filter((i) => i !== fi);
      this.log.add(`${who.name === "you" ? "You seize" : who.name + " seizes"} the JAM! Now ASCEND — climb back to the surface (press <).`, "good");
      return true;
    }
    if (who.inventory.full) { this.log.add("Your pack is full.", "bad"); return false; }
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
      if (p.intrinsics.has("poisonResist")) this.log.add("Toxic — but you shrug it off.", "dim");
      else { this.applyStatus(p, "poison"); if (ROT.RNG.getUniform() < 0.33) { p.intrinsics.add("poisonResist"); this.log.add("Your gut hardens — poison resistance!", "good"); } }
    } else if (def.corpseEffect === "speed") {
      if (!p.intrinsics.has("fast") && ROT.RNG.getUniform() < 0.4) { p.intrinsics.add("fast"); this.log.add("You feel quick! (intrinsic speed)", "good"); }
    } else if (def.corpseEffect === "telepathy") {
      if (!p.intrinsics.has("telepathy")) { p.intrinsics.add("telepathy"); this.log.add("Your mind expands — you sense other minds while blind. (telepathy)", "good"); }
    } else if (rotten && !p.intrinsics.has("poisonResist") && ROT.RNG.getUniform() < 0.5) {
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

  dropItem(item: Item): void {
    const x = this.acting.x, y = this.acting.y;
    // A vault spills its stash onto the floor when set down, so nothing is lost.
    if (item.contents?.length) {
      for (const c of item.contents) this.level.items.push({ x, y, type: c.type, enchant: c.enchant, relic: c.relic, buc: c.buc, bucKnown: c.bucKnown });
      this.log.add(`The vault's ${item.contents.length} stashed item(s) spill out onto the floor.`, "sys");
      item.contents = [];
    }
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
    if (unknown) this.log.add(`${unknown} potion/scroll type(s) still a mystery.`, "dim");
  }

  showInventory(): void {
    const who = this.acting;
    const inv = who.inventory;
    if (inv.items.length === 0) { this.log.add("Your pack is empty.", "dim"); return; }
    this.log.add(`— ${who.name === "you" ? "Inventory" : who.name + "'s pack"} —`, "sys");
    inv.items.forEach((it, i) => {
      const welded = who.isWelded(it);
      const eq = welded ? " (welded)" : it === who.weapon ? " (wielded)" : it === who.offhand ? " (off-hand)" : who.wornArmor.includes(it) ? " (worn)" : it === who.ring ? " (on hand)" : it === who.quiver ? " (at the ready)" : "";
      const lbl = it.label ? ` named "${it.label}"` : "";
      const ch = it.charges != null ? ` [${it.charges}]` : it.type.id === "vault" ? ` {${it.contents?.length ?? 0} held}` : "";
      const relic = it.relic ? ` +${it.enchant ?? 0} ✦` : "";
      const buc = it.bucKnown && it.buc ? `${it.buc} ` : "";
      const ero = it.erosion ? (["", "rusty ", "corroded ", "very corroded "][it.erosion] ?? "") : (it.proofed ? "audited " : "");
      const tone = it.bucKnown && it.buc === "cursed" ? "bad" : it.bucKnown && it.buc === "blessed" ? "good" : it.relic ? "sys" : "dim";
      this.log.add(`  ${inv.letter(i)}) ${buc}${ero}${this.ident.name(it.type)}${relic}${ch}${lbl}${eq}`, tone);
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
      case "strength": {
        p.maxHp += 3; p.hp += 3;
        this.log.add("You feel staked. (max HP increased)", "good"); break;
      }
      case "teleport": {
        let pos = this.level.randomFloor(), t = 0;
        while (t < 40 && (this.monsterAt(pos.x, pos.y) || this.level.tileAt(pos.x, pos.y) === "stairsDown")) { pos = this.level.randomFloor(); t++; }
        p.x = pos.x; p.y = pos.y; this.recomputeFOV();
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
        if (p.poison > 0 || p.confused > 0 || p.stoning > 0 || p.illness > 0 || p.blind > 0) {
          p.poison = 0; p.confused = 0; p.stoning = 0; p.illness = 0; p.blind = 0;
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
      this.log.add(`Wallet connected: ${a.slice(0, 6)}…${a.slice(-4)} — ${this.player.pas.toFixed(1)} PAS. Shops charge your wallet directly.`, "sys");
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
    if (this.player.depth >= 5 && ROT.RNG.getUniform() < 0.5) {
      const relicTypes = ITEMS.filter((i) => isGear(i));
      const rt = ROT.RNG.getItem(relicTypes)!;
      const enchant = ROT.RNG.getUniformInt(1, 2);
      while (oi < offsets.length) {
        const [dx, dy] = offsets[oi++];
        const x = c.x + dx, y = c.y + dy;
        if (this.level.isPassable(x, y) && !this.level.itemAt(x, y) &&
            this.level.tileAt(x, y) !== "stairsDown" && !(x === this.player.x && y === this.player.y)) {
          this.level.items.push({ x, y, type: rt, price: 12 + enchant * 4, enchant, buc: "blessed", bucKnown: true });
          this.log.add("A fine enchanted ware is among the stock — forge it (F) into an NFT relic later.", "dim");
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
    if (this.busy) return;
    if (this.coop) { this.log.add("Shops & forging are solo-only in co-op for now.", "dim"); return; }
    const fi = this.level.itemAt(this.acting.x, this.acting.y);
    if (!fi || !fi.price) { this.log.add("There is nothing for sale here.", "dim"); return; }
    if (!this.wallet) { this.log.add("Connect a wallet (button above) to buy.", "bad"); return; }
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
    const mi = this.monsters.indexOf(m); // splice in place — the array identity is the persisted level's monster list
    if (mi >= 0) this.monsters.splice(mi, 1);
    this.scheduler.remove(m);
    // Slay the resurrected Censor while it holds the JAM and you wrest it back.
    if (m.isHunter && this.jamStolen) {
      this.jamStolen = false;
      const recip = this.nearestPlayer(m.x, m.y);
      recip.hasJam = true;
      this.log.add("You tear the JAM from the Censor's ribs — it is yours again. Climb on.", "good");
    }
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
      if (!this.level.itemAt(m.x, m.y)) this.level.items.push({ x: m.x, y: m.y, type: prize, enchant, buc: "blessed", bucKnown: true });
      this.log.add(`${cap(m.name)} falls! It leaves a prize — ${prize.name} +${enchant}. Forge it (F) into a tradeable NFT relic.`, "good");
    } else {
      this.log.add(`${cap(m.name)} is destroyed.`, "good");
    }
    // It leaves a corpse — food, but eat with care (poison / petrify / rot).
    if (!m.def.boss && !m.def.keeper && !m.def.mimic && ROT.RNG.getUniform() < 0.55 && !this.level.itemAt(m.x, m.y)) {
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
    const count = Math.min(40, Math.round((4 + this.player.depth * 1.2) * diff) + (this.player.depth >= 9 ? 4 : 0) + (this.level.kind === "bigroom" ? 12 : 0));
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
    const kinds: TrapKind[] = ["gas", "slash", "reorg", "fork"];
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
    }
    if (p.hp <= 0) this.killPlayer(p);
  }

  // ── co-op session (host-authoritative over WebRTC) ───────────────────────────
  /** The host runs the simulation for both players and streams frames + log to the guest. */
  startCoopHost(peer: Peer, mode: CoopMode): void {
    this.netRole = "host"; this.peer = peer; this.coopMode = mode; this.coop = true;
    peer.onMessage((m: NetMsg) => { if (m?.t === "input" && typeof m.key === "string") this.handleRemoteInput(m.key); });
    peer.onState((open) => {
      if (open) return;
      this.log.add("Partner disconnected — finishing solo.", "bad");
      const c = this.coPlayer;
      if (c) { c.cancelTurn(); this.scheduler.remove(c); this.coPlayer = null; this.draw(); } // unstick the shared clock
    });
    this.log.onAdd = (text, cls) => peer.send({ t: "log", text, cls }); // mirror the shared log
    peer.send({ t: "start", mode });
    this.log.add("Co-op hosted — you are the cream @ (Host); your partner is the teal @ (Guest).", "sys");
    this.newGame(); // a fresh shared dungeon with two adventurers
  }

  /** The guest is a thin terminal: it forwards keys and renders the host's frames. */
  startCoopGuest(peer: Peer): void {
    this.netRole = "guest"; this.peer = peer; this.coop = true;
    peer.onMessage((m: NetMsg) => this.onGuestMessage(m));
    peer.onState((open) => { if (!open) this.log.add("Host disconnected — co-op ended.", "bad"); });
    this.log.add("Linked as Guest — waiting for the host's dungeon…", "sys");
  }

  private handleRemoteInput(key: string): void {
    if (this.over) { if (key === "r" || key === "R") this.newGame(); return; }
    if (this.busy) return;
    if (this.coPlayer && this.coPlayer.alive) this.coPlayer.feed(key);
  }

  private onGuestMessage(m: NetMsg): void {
    if (m?.t === "start") this.log.add(`Shared dungeon started (${m.mode}). You are the teal @ (Guest).`, "sys");
    else if (m?.t === "frame") this.renderFrame(m.cells, m.huds);
    else if (m?.t === "log") this.log.paint(m.text, (m.cls ?? "") as "" | "good" | "bad" | "sys" | "dim");
  }

  /** Guest-side render of a host frame: paint the cells + this side's HUD. */
  private renderFrame(cells: Cell[], huds: [string, string]): void {
    this.display.clear();
    for (const [x, y, ch, fg] of cells) this.display.draw(x, y, ch, fg, COLORS.bg);
    this.display.drawText(1, MAP_H + 1, huds[1] || huds[0]);
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
      case "x": { const c = ROT.RNG.getItem(CHAINS)!; if (!this.level.portalAt(p.x, p.y)) this.level.portals.push({ x: p.x, y: p.y, chain: c }); this.level.tiles[p.y][p.x] = "portal"; this.recomputeFOV(); this.draw(); this.log.add(`[DEBUG] XCM portal to ${c.name} under you — press > to enter.`, "sys"); break; }
      case "Q": { if (!this.level.portalAt(p.x, p.y)) this.level.portals.push({ x: p.x, y: p.y, chain: CHAINS[0], quest: true }); this.level.tiles[p.y][p.x] = "portal"; this.recomputeFOV(); this.draw(); this.log.add("[DEBUG] quest portal under you — press > to enter.", "sys"); break; }
      case "g": this.gehennomOpen = true; this.debugWarp(MAX_DEPTH + 1); this.log.add(`[DEBUG] Gehennom opened, warped to depth ${MAX_DEPTH + 1}.`, "sys"); break;
      case "F": this.gehennomOpen = true; this.debugWarp(16); this.log.add("[DEBUG] warped to the Council Fort (d16).", "sys"); break;
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
    p.poison = 0; p.confused = 0; p.stoning = 0; p.illness = 0; p.blind = 0;
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
    if (this.netRole === "guest") { this.peer?.send({ t: "input", key: e.key }); e.preventDefault(); return; }
    if (this.busy) { e.preventDefault(); return; } // frozen while a wallet tx settles
    if (this.over) {
      if (e.key === "r" || e.key === "R") this.newGame();
      return;
    }
    if (this.coop && !this.player.alive) { e.preventDefault(); return; } // host downed — spectate
    if (this.konamiCheck(e.key)) { e.preventDefault(); return; } // the Konami code toggles fantasy ⇄ polkadot flavor
    if (DEBUG && this.debugIntercept(e.key)) { e.preventDefault(); return; } // ── DEBUG hook (remove for release) ──
    this.player.feed(e.key);
    e.preventDefault();
  }

  /** Build the renderable map as a flat cell list (shared by local paint + the co-op stream). */
  private buildCells(): Cell[] {
    const cells: Cell[] = [];
    const vis = (x: number, y: number) => this.level.isVisible(x, y);
    for (let y = 0; y < MAP_H; y++) {
      for (let x = 0; x < W; x++) {
        const t = this.level.tileAt(x, y);
        if (!t) continue;
        const g = TILE_GLYPH[t];
        if (vis(x, y)) cells.push([x, y, g.ch, g.fg]);
        else if (this.level.explored[y][x]) cells.push([x, y, g.ch, g.fgDim]);
      }
    }
    for (const g of this.level.graves) if (vis(g.x, g.y)) cells.push([g.x, g.y, "‡", "#b0a890"]);
    for (const t of this.level.traps) if (t.revealed && vis(t.x, t.y)) cells.push([t.x, t.y, "^", "#d06060"]);
    for (const pr of this.level.portals) if (vis(pr.x, pr.y)) cells.push([pr.x, pr.y, "Ω", pr.chain.color]);
    for (const e of this.level.engravings) if (vis(e.x, e.y)) cells.push([e.x, e.y, "§", "#b0a060"]);
    for (const fi of this.level.items) if (vis(fi.x, fi.y)) cells.push([fi.x, fi.y, fi.type.ch, fi.type.fg]);
    for (const b of this.level.boulders) if (vis(b.x, b.y)) cells.push([b.x, b.y, "0", "#9a8a6a"]);
    // Sense minds: blind+telepathy, or the sense-minds spell, reveals monsters out of sight.
    const sensed = this.livingPlayers().some((p) => (p.blind > 0 && p.intrinsics.has("telepathy")) || p.senseTurns > 0);
    for (const m of this.monsters) {
      if (!m.alive || !(vis(m.x, m.y) || sensed)) continue;
      const dormant = m.def.mimic && !m.revealed;
      cells.push([m.x, m.y, dormant ? m.disguiseCh : m.ch, dormant ? m.disguiseFg : m.fg]);
    }
    if (this.pet && this.pet.alive && vis(this.pet.x, this.pet.y)) cells.push([this.pet.x, this.pet.y, this.pet.ch, this.pet.fg]);
    for (const pl of this.allPlayers()) {
      if (!pl.alive) continue;
      const ch = pl.polyForm ? pl.polyForm.ch : "@"; // you wear your fork's shape
      const fg = pl.polyForm ? pl.polyForm.fg : pl === this.player ? pl.fg : PARTNER_FG;
      cells.push([pl.x, pl.y, ch, fg]);
    }
    return cells;
  }

  private buildHud(p: Player): string {
    const hpCol = p.hp <= p.maxHp * 0.3 ? COLORS.bad : COLORS.good;
    const hunger = p.hungerWord();
    return (
      `%c{${COLORS.dim}}HP %c{${hpCol}}${p.hp}%c{${COLORS.dim}}/${p.maxHp}  Lv %c{${COLORS.good}}${p.level}%c{${COLORS.dim}}  ` +
      (this.plane > 0
        ? `%c{#ff60ff}${PLANES[this.plane - 1].name}`
        : `Depth %c{${COLORS.gold}}${p.depth}` +
          (this.inQuest ? `%c{${COLORS.dim}} @%c{#e0c040}Quest` : this.currentChain ? `%c{${COLORS.dim}} @%c{${this.currentChain.color}}${this.currentChain.name}` : `%c{${COLORS.dim}} @%c{${COLORS.dim}}Relay`)) +
      `%c{${COLORS.dim}}  AC %c{${COLORS.good}}${p.ac}` +
      (p.maxEnergy > 5 || p.spells.size ? `%c{${COLORS.dim}}  En %c{#7aa0e0}${p.energy}%c{${COLORS.dim}}/${p.maxEnergy}` : "") +
      (this.luckOf(p) !== 0 ? `%c{${COLORS.dim}}  Luck %c{${this.luckOf(p) > 0 ? COLORS.good : COLORS.bad}}${this.luckOf(p) > 0 ? "+" : ""}${this.luckOf(p)}` : "") +
      (p.polyForm ? `%c{${COLORS.dim}}  %c{#d070d0}Fork:${p.polyForm.name.replace(/^an? /, "")} ${p.polyTurns}` : "") +
      (this.coop ? "" : `%c{${COLORS.dim}}  PAS %c{${COLORS.gold}}${p.pas.toFixed(1)}`) +
      (hunger ? `%c{${COLORS.dim}}  %c{${COLORS.bad}}${hunger}` : "") +
      (p.poison > 0 ? `%c{${COLORS.dim}}  %c{${COLORS.bad}}Psn` : "") +
      (p.confused > 0 ? `%c{${COLORS.dim}}  %c{${COLORS.bad}}Cfz` : "") +
      (p.stoning > 0 ? `%c{${COLORS.dim}}  %c{${COLORS.bad}}Ston${p.stoning}` : "") +
      (p.illness > 0 ? `%c{${COLORS.dim}}  %c{${COLORS.bad}}Ill${p.illness}` : "") +
      (p.blind > 0 ? `%c{${COLORS.dim}}  %c{${COLORS.bad}}Blind` : "") +
      (p.intrinsics.has("fast") ? `%c{${COLORS.dim}}  %c{${COLORS.good}}Fast` : "") +
      (p.hasJam ? `%c{${COLORS.dim}}  %c{${COLORS.gold}}✦JAM — ASCEND (<)` : this.jamStolen ? `%c{${COLORS.dim}}  %c{${COLORS.bad}}JAM STOLEN — slay the Censor!` : `%c{${COLORS.dim}}  ${this.gehennomOpen ? `JAM: depth ${GEHENNOM_BOTTOM}` : `Invoke @ depth ${MAX_DEPTH}`}`)
    );
  }

  private buildHuds(): [string, string] {
    return [skin(this.buildHud(this.player)), this.coPlayer ? skin(this.buildHud(this.coPlayer)) : ""];
  }

  draw(): void {
    if (this.netRole === "guest") return; // the guest only paints frames it receives
    if (this.player) this.music.setContext(this.musicContext()); // distress, density, and reactions
    const cells = this.buildCells();
    const huds = this.buildHuds();
    this.display.clear();
    for (const [x, y, ch, fg] of cells) this.display.draw(x, y, ch, fg, COLORS.bg);
    this.display.drawText(1, MAP_H + 1, huds[0]);
    if (this.netRole === "host" && this.peer) this.peer.send({ t: "frame", cells, huds });
  }
}
