import * as ROT from "rot-js";
import type { Game } from "./game";
import type { Entity, Monster, Pet, Player } from "./entities";

// ─────────────────────────────────────────────────────────────────────────────
// A small shared behaviour engine for every non-player actor (monsters and the
// pet). Each actor runs an ordered list of Behaviours; the first whose `score`
// returns a positive number acts, and evaluation stops there. That early-out is
// what keeps random-gated actions (a 5% split, a 10% summon) firing at their
// intended rates: lower rungs never roll unless the higher ones decline.
//
// The score is a number, not a boolean, so a behaviour can *also* be used in a
// utility fashion — return a computed weight and let the engine pick the best —
// but the monster/pet lists below lean on ordering, which reads closest to the
// hand-tuned priority ladder they replace.
// ─────────────────────────────────────────────────────────────────────────────

export interface Behavior<S extends Entity> {
  name: string;
  /** >0 = this behaviour wants to act now (higher wins if you sort); 0 = decline. */
  score(game: Game, self: S, ctx: AiCtx): number;
  act(game: Game, self: S, ctx: AiCtx): void;
}

/** Per-turn scratch shared across a behaviour list (target, cached distance…). */
export interface AiCtx {
  p: Player;          // the primary target (nearest adventurer)
  dist: number;       // Chebyshev distance self → p, cached
  [k: string]: unknown;
}

/** Run an ordered behaviour list: first positive score acts, then we stop. */
export function runAi<S extends Entity>(game: Game, self: S, behaviors: Behavior<S>[], ctx: AiCtx): void {
  for (const b of behaviors) {
    if (b.score(game, self, ctx) > 0) { b.act(game, self, ctx); return; }
  }
}

// ── movement primitives (shared; formerly duplicated on Monster and Pet) ─────

const DIRS8: [number, number][] = [[-1, 0], [1, 0], [0, -1], [0, 1], [1, 1], [-1, -1], [1, -1], [-1, 1]];
const DIRS4: [number, number][] = [[-1, 0], [1, 0], [0, -1], [0, 1]];

export function cheb(x0: number, y0: number, x1: number, y1: number): number {
  return Math.max(Math.abs(x0 - x1), Math.abs(y0 - y1));
}

/** True if `self` can step onto (x,y): passable, and no monster/pet/boulder in the way.
 *  Pets soft-block too, so a retinue doesn't stack and foes must route around your hounds. */
function freeForStep(game: Game, x: number, y: number): boolean {
  return game.level.isPassable(x, y) && !game.monsterAt(x, y) && !game.petAt(x, y) && !game.level.boulderAt(x, y);
}

/** First tile of a Dijkstra path toward (tx,ty), or null if none. Does not move. */
export function pathStep(game: Game, self: Entity, tx: number, ty: number): [number, number] | null {
  const dij = new ROT.Path.Dijkstra(tx, ty, (x, y) => game.level.isPassable(x, y), { topology: 8 });
  const path: [number, number][] = [];
  dij.compute(self.x, self.y, (x, y) => path.push([x, y]));
  path.shift(); // drop the tile we're standing on
  return path.length ? path[0] : null;
}

/** Take one Dijkstra step toward a target tile, if the next tile is free. */
export function stepToward(game: Game, self: Entity, tx: number, ty: number): void {
  const next = pathStep(game, self, tx, ty);
  if (next && !game.playerAt(next[0], next[1]) && freeForStep(game, next[0], next[1])) {
    self.x = next[0]; self.y = next[1];
  }
}

/** Step to the neighbour that puts the most distance between us and (fx,fy). */
export function fleeStep(game: Game, self: Entity, fx: number, fy: number): void {
  let best: [number, number] | null = null, bestD = -1;
  for (const [dx, dy] of DIRS8) {
    const nx = self.x + dx, ny = self.y + dy;
    if (!freeForStep(game, nx, ny) || game.playerAt(nx, ny)) continue;
    const d = cheb(nx, ny, fx, fy);
    if (d > bestD) { bestD = d; best = [nx, ny]; }
  }
  if (best) { self.x = best[0]; self.y = best[1]; }
}

/** A random shuffle into one open cardinal neighbour — never onto a player. */
export function wanderStep(game: Game, self: Entity): void {
  const d = ROT.RNG.getItem(DIRS4)!;
  const nx = self.x + d[0], ny = self.y + d[1];
  if (freeForStep(game, nx, ny) && !game.playerAt(nx, ny)) { self.x = nx; self.y = ny; }
}

/** Vanish to a far corner of the level — the thief's getaway. */
export function blinkAway(game: Game, self: Entity, p: Player): void {
  for (let i = 0; i < 30; i++) {
    const pos = game.level.randomFloor();
    if (cheb(pos.x, pos.y, p.x, p.y) >= 8 && !game.monsterAt(pos.x, pos.y) && !game.playerAt(pos.x, pos.y)) {
      self.x = pos.x; self.y = pos.y; return;
    }
  }
}

/** Like fleeStep, but reports the tile & its distance instead of moving (for "should I run?" checks). */
export function bestFleeTile(game: Game, self: Entity, fx: number, fy: number): { x: number; y: number; d: number } | null {
  let best: { x: number; y: number; d: number } | null = null;
  for (const [dx, dy] of DIRS8) {
    const nx = self.x + dx, ny = self.y + dy;
    if (!freeForStep(game, nx, ny) || game.playerAt(nx, ny)) continue;
    const d = cheb(nx, ny, fx, fy);
    if (!best || d > best.d) best = { x: nx, y: ny, d };
  }
  return best;
}

const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

/** Living hostiles sharing this actor's floor (peaceful shopkeepers/priests excluded). */
function foesOnFloor(game: Game, self: Entity): Monster[] {
  return game.monsters.filter((m) => m.alive && !m.peaceful && m.floorKey === self.floorKey);
}

export { DIRS8, DIRS4, freeForStep };

// ─────────────────────────────────────────────────────────────────────────────
// Monster behaviour list. The first block reproduces the old priority ladder so
// nothing regresses; the tactical additions (kiting, morale/regroup, surround
// routing, ganging up on the hound) are called out where they slot in.
// Passive guards — sleep, blindness, dormant mimic, peaceful, engulf, the
// watcher's float, an empty floor — stay in Monster.act() ahead of this list.
// ─────────────────────────────────────────────────────────────────────────────

const hasRanged = (m: Monster): boolean => !!(m.def.zaps || m.def.throws || m.def.ranged || m.def.breath);

export const MONSTER_BEHAVIORS: Behavior<Monster>[] = [
  // A laden thief (items or gold) wants only to escape — it never turns to fight.
  { name: "flee-laden", score: (_g, s) => (s.stolen || s.stoleGold > 0 ? 1 : 0),
    act: (g, s, c) => fleeStep(g, s, c.p.x, c.p.y) },

  // Scared by a mirror node (its own reflection): it turns tail until its nerve returns.
  { name: "flee-frightened", score: (_g, s) => (s.frightened > 0 ? 1 : 0),
    act: (g, s, c) => { s.frightened--; fleeStep(g, s, c.p.x, c.p.y); } },

  // A coward turns tail once badly hurt.
  { name: "flee-cowardly", score: (_g, s) => (s.def.cowardly && s.hp < s.maxHp * 0.3 ? 1 : 0),
    act: (g, s, c) => fleeStep(g, s, c.p.x, c.p.y) },

  // muse.c (wear): a soldier/golem standing on a piece of armor dons it — harder to hit thereafter.
  { name: "don-armor",
    score: (g, s) => {
      if (!(s.def.wears && s.worn < 6)) return 0;
      const it = g.level.itemAt(s.x, s.y);
      return it && it.type.kind === "armor" && !it.corpse && !it.chest && !it.price ? 1 : 0;
    },
    act: (g, s, c) => {
      const it = g.level.itemAt(s.x, s.y)!;
      s.worn += Math.max(1, (it.type.ac ?? 1) + (it.enchant ?? 0));
      g.level.items = g.level.items.filter((z) => z !== it);
      g.log.add(`${cap(s.name)} dons ${g.ident.name(it.type)} — better armored now.`, "bad", c.p);
    } },

  // muse.c: a tough foe gulps a healing draught when badly hurt — a limited supply.
  { name: "muse-heal",
    score: (_g, s) => (!s.cancelled && s.def.muse && s.museLeft > 0 && s.hp < s.maxHp * 0.35 && ROT.RNG.getUniform() < 0.45 ? 1 : 0),
    act: (g, s, c) => {
      s.museLeft--;
      const h = Math.round(s.maxHp * (0.3 + ROT.RNG.getUniform() * 0.25));
      s.hp = Math.min(s.maxHp, s.hp + h);
      g.log.add(`${cap(s.name)} gulps a draught and steadies — +${h}.`, "bad", c.p);
    } },

  // muse.c escape: out of draughts and near death, it gulps a teleport draught and blinks across the level.
  { name: "muse-escape",
    score: (_g, s) => (!s.cancelled && s.def.muse && s.museLeft === 0 && !s.museEscaped && s.hp < s.maxHp * 0.25 && ROT.RNG.getUniform() < 0.4 ? 1 : 0),
    act: (g, s, c) => { s.museEscaped = true; g.museTeleport(s, c.p); } },

  // A medic mends a wounded ally within reach instead of fighting.
  { name: "medic",
    score: (g, s) => {
      if (s.cancelled || !s.def.heals) return 0;
      return g.monsters.some((o) => o !== s && o.alive && o.hp < o.maxHp && cheb(o.x, o.y, s.x, s.y) <= 2 && g.hasLineOfSight(s.x, s.y, o.x, o.y)) ? 1 : 0;
    },
    act: (g, s) => {
      const ally = g.monsters.find((o) => o !== s && o.alive && o.hp < o.maxHp && cheb(o.x, o.y, s.x, s.y) <= 2 && g.hasLineOfSight(s.x, s.y, o.x, o.y))!;
      ally.hp = Math.min(ally.maxHp, ally.hp + ROT.RNG.getUniformInt(3, 7));
      g.log.add(`${cap(s.name)} mends ${ally.name}.`, "dim");
    } },

  // NEW — morale break & regroup: a wounded, non-fearless foe with a healthier ally
  // to fall back on breaks off and retreats toward that ally instead of trading blows.
  // Once the ally is at its shoulder it re-commits (score 0), so packs re-form and
  // press again rather than feeding themselves to you one at a time.
  { name: "regroup",
    score: (g, s, c) => {
      if (s.def.boss || s.def.fearless || s.def.cowardly) return 0; // bosses never waver; cowards handled above
      if (s.hp >= s.maxHp * 0.45 || c.dist > 3) return 0;           // only when bloodied and pressed
      const rally = foesOnFloor(g, s).find((o) => o !== s && o.hp > o.maxHp * 0.5 && cheb(o.x, o.y, s.x, s.y) <= 7);
      if (!rally || cheb(rally.x, rally.y, s.x, s.y) <= 1) return 0; // no rally point, or already shoulder-to-shoulder
      c.rally = rally;
      return 1;
    },
    act: (g, s, c) => { const r = c.rally as Monster; stepToward(g, s, r.x, r.y); } },

  // A Gray-Paper ward beneath the player holds ordinary foes at bay.
  { name: "ward-avoid",
    score: (g, s, c) => (!s.def.boss && !s.def.fearless && g.level.engravingAt(c.p.x, c.p.y) ? 1 : 0),
    act: (g, s) => wanderStep(g, s) },

  // The Sybil attack: a sybil with budget left occasionally replicates (bounded). Nullified ones can't.
  { name: "split",
    score: (g, s) => (!s.cancelled && s.def.splits && s.splitsLeft > 0 && ROT.RNG.getUniform() < 0.05 && g.spawnSybilNear(s) ? 1 : 0),
    act: () => {} }, // spawnSybilNear already ran (and succeeded) in the score gate

  // A conjurer summons reinforcements (a verbal casting — magical silence stops it).
  { name: "summon",
    score: (g, s) => (!s.cancelled && s.silenced === 0 && s.def.summons && g.level.isVisible(s.x, s.y) && ROT.RNG.getUniform() < 0.1 && g.summonNear(s) ? 1 : 0),
    act: () => {} },

  // Breeders multiply when a mate of their kind is adjacent.
  { name: "breed",
    score: (g, s) => {
      if (s.cancelled || !s.def.breeds || ROT.RNG.getUniform() >= 0.06) return 0;
      const mate = g.monsters.find((o) => o !== s && o.alive && o.def === s.def && cheb(o.x, o.y, s.x, s.y) === 1);
      return mate && g.breedNear(s) ? 1 : 0;
    },
    act: () => {} },

  // The resurrected Censor lunges for the JAM itself — a snatch-and-blink.
  { name: "censor-steal",
    score: (_g, s, c) => (s.isHunter && !s.cancelled && c.dist === 1 && c.p.hasJam && ROT.RNG.getUniform() < 0.18 ? 1 : 0),
    act: (g, s, c) => g.censorSteal(s, c.p) },

  // The rug pull: a thief adjacent to you snatches a pack item and blinks away.
  { name: "thief-steal",
    score: (g, s, c) => {
      if (s.cancelled || !s.def.steals || c.dist !== 1) return 0;
      const loot = g.stealItem(c.p);
      if (!loot) return 0;      // nothing to take — decline, and melee picks it up below
      c.loot = loot;
      return 1;
    },
    act: (g, s, c) => {
      const loot = c.loot as import("./inventory").Item;
      s.stolen = loot;
      g.log.add(`${cap(s.name)} rugs you — it rips ${g.ident.name(loot.type)} from your pack and bolts!`, "bad", c.p);
      blinkAway(g, s, c.p);
    } },

  // Seduce: a charmer transfixes you (a lost turn) and slips away with whatever it can lift.
  { name: "seduce",
    score: (_g, s, c) => (!s.cancelled && s.def.seduces && c.dist === 1 && ROT.RNG.getUniform() < 0.6 ? 1 : 0),
    act: (g, s, c) => {
      const p = c.p;
      if (p.paralyzed === 0 && !p.freeAction) { p.paralyzed = 1; g.log.add(`${cap(s.name)} catches your eye — you stand transfixed!`, "bad", p); }
      const loot = g.stealItem(p);
      if (loot) { s.stolen = loot; g.log.add(`${cap(s.name)} slips ${g.ident.name(loot.type)} away as you swoon, and is gone.`, "bad", p); blinkAway(g, s, p); }
    } },

  // The airdrop farmer: adjacent, it snatches a fistful of gold and blinks away.
  { name: "gold-steal",
    score: (_g, s, c) => (!s.cancelled && s.def.stealsGold && c.dist === 1 && c.p.gold > 0 ? 1 : 0),
    act: (g, s, c) => {
      const took = g.stealGold(c.p);
      if (took <= 0) { g.attack(s, c.p); return; } // nothing left to grab — just hit them
      s.stoleGold += took;
      g.log.add(`${cap(s.name)} swipes ${took} gold and blinks away!`, "bad", c.p);
      blinkAway(g, s, c.p);
    } },

  // NEW — kiting: a ranged foe that still has legs and a lane won't stand and trade
  // punches. When you close to melee it usually backpedals to reopen the gap, then
  // looses its bolt/breath/dart next turn. Cornered or desperate, it fights.
  { name: "kite",
    score: (g, s, c) => {
      if (c.dist !== 1 || !hasRanged(s)) return 0;
      if (s.hp <= s.maxHp * 0.35) return 0;                 // desperate — commit to the melee
      if (s.cancelled && !s.def.throws) return 0;           // nullified caster has nothing to kite for
      const flee = bestFleeTile(g, s, c.p.x, c.p.y);
      if (!flee || flee.d <= c.dist) return 0;              // nowhere to back off to
      if (ROT.RNG.getUniform() >= 0.75) return 0;           // a quarter of the time it holds its ground
      c.kite = flee;
      return 1;
    },
    act: (_g, s, c) => { const t = c.kite as { x: number; y: number }; s.x = t.x; s.y = t.y; } },

  // Melee. NEW — opportunism: with your hound also in reach it will sometimes turn
  // on the hound instead (and reliably if the hound is nearly down), thinning your
  // support before finishing you.
  { name: "melee", score: (_g, _s, c) => (c.dist === 1 ? 1 : 0),
    act: (g, s, c) => {
      const pet = g.adjacentPet(s.x, s.y);
      if (pet && (pet.hp <= pet.maxHp * 0.4 || ROT.RNG.getUniform() < 0.35)) { g.attack(s, pet); return; }
      g.attack(s, c.p);
    } },

  // If one of the retinue is at our side (and the player isn't), swat it.
  { name: "swat-pet",
    score: (g, s) => (g.adjacentPet(s.x, s.y) ? 1 : 0),
    act: (g, s) => g.attack(s, g.adjacentPet(s.x, s.y)!) },

  // muse.c: a caster zaps a wand-borne debuff at you from range — silence stops it.
  { name: "zap",
    score: (g, s, c) => (!s.cancelled && s.silenced === 0 && s.def.zaps && !c.p.stealth && c.dist >= 2 && c.dist <= 6 &&
      g.level.isVisible(s.x, s.y) && g.hasLineOfSight(s.x, s.y, c.p.x, c.p.y) && ROT.RNG.getUniform() < 0.5 ? 1 : 0),
    act: (g, s, c) => g.monsterZap(s, c.p) },

  // mthrowu.c: a thrower hurls a physical projectile from range — silence/cancel don't stop it.
  { name: "throw",
    score: (g, s, c) => (s.def.throws && !c.p.stealth && c.dist >= 2 && c.dist <= 6 && g.level.isVisible(s.x, s.y) && g.hasLineOfSight(s.x, s.y, c.p.x, c.p.y) ? 1 : 0),
    act: (g, s) => g.monsterThrow(s) },

  // Ranged foes zap the player from a distance with line-of-sight — a cast, stopped by silence.
  { name: "ranged",
    score: (g, s, c) => (!s.cancelled && s.silenced === 0 && s.def.ranged && !c.p.stealth && c.dist >= 2 && c.dist <= 6 && g.level.isVisible(s.x, s.y) && g.hasLineOfSight(s.x, s.y, c.p.x, c.p.y) ? 1 : 0),
    act: (g, s) => g.rangedAttack(s) },

  // A dragon breathes a ray when you're roughly in line.
  { name: "breath",
    score: (g, s, c) => (!s.cancelled && s.def.breath && !c.p.stealth && c.dist >= 2 && c.dist <= 5 && g.level.isVisible(s.x, s.y) && g.hasLineOfSight(s.x, s.y, c.p.x, c.p.y) ? 1 : 0),
    act: (g, s) => g.breathAttack(s) },

  // Chase. NEW — surround routing: rather than stalling behind a packmate that
  // clogs the shortest step, it slides to any open tile that still closes the gap,
  // so a mob fans out and flanks instead of forming a single-file conga line.
  { name: "chase",
    score: (g, s, c) => (s.def.ai === "chase" && !c.p.stealth && (g.level.isVisible(s.x, s.y) || c.dist <= 5) && c.dist <= 9 ? 1 : 0),
    act: (g, s, c) => {
      const p = c.p;
      const options: [number, number][] = [];
      const primary = pathStep(g, s, p.x, p.y);
      if (primary) options.push(primary);
      for (const [dx, dy] of DIRS8) {
        const nx = s.x + dx, ny = s.y + dy;
        if (cheb(nx, ny, p.x, p.y) < c.dist) options.push([nx, ny]);
      }
      for (const [nx, ny] of options) {
        const tgt = g.playerAt(nx, ny);
        if (tgt) { g.attack(s, tgt); return; }
        if (freeForStep(g, nx, ny)) { s.x = nx; s.y = ny; return; }
      }
    } },

  // Investigate a partner's call it heard — head toward where the noise came from.
  { name: "investigate",
    score: (_g, s) => (s.heardSound ? 1 : 0),
    act: (g, s) => {
      const h = s.heardSound!;
      if (s.x === h.x && s.y === h.y) { s.heardSound = null; return; } // arrived — nothing here
      stepToward(g, s, h.x, h.y);
    } },

  // Wander (always-true fallback).
  { name: "wander", score: () => 1, act: (g, s) => wanderStep(g, s) },
];

// ─────────────────────────────────────────────────────────────────────────────
// Pet behaviour list. The old pet only bit what touched it and then trailed you.
// These give it its own drives: break off when nearly dead, hunt foes it can see
// (without straying too far from you), body-block threats coming at you, and pad
// around traps it senses. Leash/whistle/ride overrides are applied in Pet.act().
// ─────────────────────────────────────────────────────────────────────────────

const PET_HUNT_RANGE = 5;   // how far the hound will range to pounce on a foe
const PET_LEASH_SLACK = 7;  // …but never more than this from you (it won't run off to die)

/** Nearest living hostile the pet can see, within `range`. */
function petQuarry(game: Game, pet: Pet, range: number): Monster | null {
  let best: Monster | null = null, bestD = range + 1;
  for (const m of foesOnFloor(game, pet)) {
    const d = cheb(pet.x, pet.y, m.x, m.y);
    if (d < bestD && game.hasLineOfSight(pet.x, pet.y, m.x, m.y)) { bestD = d; best = m; }
  }
  return best;
}

/** Follow the owner one Dijkstra step, but refuse to pad onto a trap it senses. */
function petFollowStep(game: Game, pet: Pet, ownerX: number, ownerY: number): void {
  const primary = pathStep(game, pet, ownerX, ownerY);
  if (!primary) return;
  const trapped = (x: number, y: number) => !!game.level.trapAt(x, y);
  let step = primary;
  if (trapped(step[0], step[1])) {
    // Sidestep the hazard: pick the free, trap-free neighbour that gets closest to you.
    let best: [number, number] | null = null, bestD = Infinity;
    for (const [dx, dy] of DIRS8) {
      const nx = pet.x + dx, ny = pet.y + dy;
      if (!freeForStep(game, nx, ny) || game.playerAt(nx, ny) || trapped(nx, ny)) continue;
      const d = cheb(nx, ny, ownerX, ownerY);
      if (d < bestD) { bestD = d; best = [nx, ny]; }
    }
    if (!best) return; // hemmed in by hazards — hold position this turn
    step = best;
  }
  if (!(step[0] === ownerX && step[1] === ownerY) && freeForStep(game, step[0], step[1])) {
    pet.x = step[0]; pet.y = step[1];
  }
}

export const PET_BEHAVIORS: Behavior<Pet>[] = [
  // NEW — self-preservation, tuned by temperament: a bold hound trades down to a sliver before
  // breaking off; a timid one bolts to your side early. Nearly-dead-with-a-foe still overrides.
  { name: "retreat",
    score: (g, s) => {
      const fleeAt = 0.15 + (1 - s.profile.aggression) * 0.32; // bold ~0.15 · timid ~0.47
      if (s.hp > s.maxHp * fleeAt) return 0;
      return petQuarry(g, s, 3) ? 1 : 0;
    },
    act: (g, s, c) => { const foe = petQuarry(g, s, 3)!; fleeStep(g, s, foe.x, foe.y); if (cheb(s.x, s.y, c.p.x, c.p.y) > 1) stepToward(g, s, c.p.x, c.p.y); } },

  // NEW — trait interaction (gluttony vs valor): a bold AND greedy hound will ABANDON a fight to
  // wolf down nearby food, where a timid or indifferent one keeps its teeth in the foe. It fires only
  // when there's actually a fight to abandon and food within reach, gated by appetite × boldness.
  { name: "gorge",
    score: (g, s, c) => {
      const greed = s.profile.appetite, bold = s.profile.aggression;
      if (greed < 0.4) return 0;                                              // only genuinely food-driven dogs
      if (s.nutrition >= 120 + greed * 380) return 0;                         // …and only when hungry
      if (!(g.adjacentEnemy(s.x, s.y) || petQuarry(g, s, 3))) return 0;       // only if there IS a fight to leave
      const food = g.petEdibleAt(s.x, s.y) ? { x: s.x, y: s.y } : g.petNearestEdible(s.x, s.y, 2 + Math.round(greed * 2));
      if (!food) return 0;
      if (ROT.RNG.getUniform() > greed * (0.3 + bold * 0.7)) return 0;        // bold+greedy breaks off; timid clings on
      c.forage = food;
      return 1;
    },
    act: (g, s, c) => { if (g.petEdibleAt(s.x, s.y)) g.petEat(s); else { const f = c.forage as { x: number; y: number }; stepToward(g, s, f.x, f.y); } } },

  // Savage whatever is already in reach.
  { name: "maul",
    score: (g, s) => (g.adjacentEnemy(s.x, s.y) ? 1 : 0),
    act: (g, s) => g.attack(s, g.adjacentEnemy(s.x, s.y)!) },

  // NEW — forage: a hungry hound would rather eat than chase. Wolf down a corpse or scrap
  // underfoot, or pad over to the nearest one it can reach (petEdibleAt skips petrifying meat).
  { name: "eat",
    score: (g, s, c) => {
      const hungryAt = 150 + s.profile.appetite * 260; // greedy pets forage sooner (up to ~410), light eaters wait
      if (s.nutrition >= hungryAt) return 0;
      if (g.petEdibleAt(s.x, s.y)) return 1;
      const near = g.petNearestEdible(s.x, s.y, 3 + Math.round(s.profile.appetite * 3)); // greedy → roams farther for food
      if (!near) return 0;
      c.forage = near;
      return 1;
    },
    act: (g, s, c) => {
      if (g.petEdibleAt(s.x, s.y)) { g.petEat(s); return; }
      const f = c.forage as { x: number; y: number }; if (f) stepToward(g, s, f.x, f.y);
    } },

  // NEW — hunt: the drive it never had. Lunge at a foe it can see, as long as the
  // chase won't drag it dangerously far from you.
  { name: "hunt",
    score: (g, s, c) => {
      const range = 2 + Math.round(s.profile.aggression * (PET_HUNT_RANGE - 1)); // bold → ranges far (up to 6); timid → only pounces on the near (2)
      const q = petQuarry(g, s, range);
      if (!q) return 0;
      if (cheb(s.x, s.y, c.p.x, c.p.y) >= PET_LEASH_SLACK) return 0; // too far from you already
      c.quarry = q;
      return 1;
    },
    act: (g, s, c) => { const q = c.quarry as Monster; stepToward(g, s, q.x, q.y); } },

  // NEW — cover you: no prey of its own, but a foe is closing on you — interpose,
  // moving to the tile between you and the threat.
  { name: "cover",
    score: (g, s, c) => {
      if (cheb(s.x, s.y, c.p.x, c.p.y) > 3) return 0; // stay a bodyguard, not a straggler
      let threat: Monster | null = null, td = 5;
      for (const m of foesOnFloor(g, s)) {
        const d = cheb(m.x, m.y, c.p.x, c.p.y);
        if (d < td && g.hasLineOfSight(m.x, m.y, c.p.x, c.p.y)) { td = d; threat = m; }
      }
      if (!threat) return 0;
      c.threat = threat;
      return 1;
    },
    act: (g, s, c) => {
      const t = c.threat as Monster, p = c.p;
      // Step to the free neighbour of yours that sits closest to the threat (block its lane).
      let best: [number, number] | null = null, bestD = Infinity;
      for (const [dx, dy] of DIRS8) {
        const nx = p.x + dx, ny = p.y + dy;
        if (!freeForStep(g, nx, ny) || g.playerAt(nx, ny)) continue;
        const d = cheb(nx, ny, t.x, t.y);
        if (d < bestD) { bestD = d; best = [nx, ny]; }
      }
      if (best) stepToward(g, s, best[0], best[1]);
    } },

  // NEW — apport (fetch): carrying something, it trots back to lay it at your feet; idle and
  // unhurried, it'll occasionally snatch up a loose trinket nearby to bring you. It won't
  // touch shop wares, gold, corpses, relics, or the amulet, and won't wander far to fetch.
  { name: "apport",
    score: (g, s, c) => {
      if (s.carrying) return 1;                          // always want to deliver the goods
      if (s.nutrition < 250) return 0;                   // too hungry to play
      if (cheb(s.x, s.y, c.p.x, c.p.y) > 3) return 0;    // stay close
      const it = g.petFetchableNear(s.x, s.y, 2);
      if (!it || ROT.RNG.getUniform() > 0.15 + s.profile.fetch * 0.65) return 0; // a keen fetcher grabs ~4/5; an aloof one rarely bothers
      c.fetch = it;
      return 1;
    },
    act: (g, s, c) => {
      if (s.carrying) {
        if (cheb(s.x, s.y, c.p.x, c.p.y) <= 1) g.petDropCarried(s);
        else stepToward(g, s, c.p.x, c.p.y);
        return;
      }
      const it = c.fetch as { x: number; y: number };
      if (s.x === it.x && s.y === it.y) g.petPickup(s);
      else stepToward(g, s, it.x, it.y);
    } },

  // Heel: trail you (routing around traps it senses) when there's nothing to fight.
  { name: "follow", score: (_g, _s, c) => (c.dist > 1 ? 1 : 0),
    act: (g, s, c) => petFollowStep(g, s, c.p.x, c.p.y) },

  // At your heel with all quiet — mill in place now and then so it reads as alive.
  { name: "idle", score: () => 1,
    act: (g, s, c) => { if (ROT.RNG.getUniform() < 0.1 + s.profile.wander * 0.5) { const bx = s.x, by = s.y; wanderStep(g, s); if (cheb(s.x, s.y, c.p.x, c.p.y) > 2) { s.x = bx; s.y = by; } } } }, // restless pets mill more
];
