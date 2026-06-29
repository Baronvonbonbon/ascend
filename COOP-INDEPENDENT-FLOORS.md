# Co-op: separate fog + independent floors

> Trackable plan for letting two co-op players have their own sight and explore
> different floors/planes/branches from one another. Check items off as they land;
> each stage must keep `npx tsc --noEmit` + `npm run build` green and not regress
> solo play. **Two-client playtest required after stages 2–4** (host in one browser
> tab, join in another) — this cannot be verified headlessly.

## Goal
- [x] **Separate fog of war** — each player sees only their own FOV, with their own
      explored memory (no shared/union sight). _(shipped)_
- [ ] **Independent floors** — players can be on different floors (`dungeon:N`,
      a parachain, a branch, a plane) at the same time, both **fully simulated**
      (monsters act on each floor and target the player *there*), each rendering
      their own floor.

## Why it's a core-loop rearchitecture
Almost everything assumes a single active level: `this.level` (~274 refs),
`this.monsters` (~43), one `scheduler`/`engine`, and every transition
(`descend`/`ascend`/`enterChain`/`enterBranch`/`enterPlane`) moves the **whole
party** together. Monsters path against `this.game.level` and target via
`nearestPlayer`, both assuming one level.

## The approach (key insight)
The turn engine is already promise-based: the `ROT.Engine` interleaves both
players (each `Player.act()` awaits its own input via `resolveTurn`) and monsters
by speed. And **a floor's full identity is encoded in its key** — `dungeon:7`,
`kusama:5` (parachain), `mines:2` (branch floor), `plane:3`, `quest`.

So instead of rewriting the ~300 `this.level` references, we **swap the active
context per acting entity**: each actor carries a `floorKey`, and
`setActive(key)` loads that floor's `level` + `monsters` and derives the
chain/branch/plane/quest flags (`applyKeyContext`) **before** the actor takes its
turn. All existing `this.level`/`this.monsters`/`this.currentChain` code then
operates on the acting entity's floor with no edits.

Persistence (Phase 15 `slots: Map<key, {level, monsters}>`) already stores every
visited floor by key, so "the other player's floor" is just another live slot.

---

## Stage 1 — context-switch foundation ✅ (no behavior change)
- [x] `Entity.floorKey` — which floor an actor stands on (default `dungeon:1`).
- [x] `Game.setActive(key)` — swap the live context (`level` + `monsters`), saving
      the outgoing floor; no-op when already loaded.
- [x] `Game.applyKeyContext(key)` — derive `currentChain` / `branchFloor` /
      `plane` / `inQuest` from a key (`quest`, `plane:N`, `dungeon:N`, `<branch>:N`,
      `<chain>:N`).
- [x] `scheduleParty` tags the party + monsters with the active floor.
- Not wired into the turn loop yet → pure foundation. **Builds green.**

## Stage 2 — wire the context switch into the turn loop
Goal: every action runs in its actor's floor context. Still single-floor in
practice (party shares a floor), so behavior is unchanged — but the plumbing is live.
- [ ] `Player.feed`/`drainQueue`: call `this.game.setActive(this.floorKey)` before
      `handleKey`.
- [ ] `Monster.act` and `Pet.act`: `this.game.setActive(this.floorKey)` at the top.
- [ ] **Tag mid-play spawns** with `this.activeKey` so they don't carry a stale
      default key. Audit every `new Monster(...)` outside `scheduleParty`:
      summons (`sudo conjurer`), splits (`sybil`), breeders (`dust gremlin`),
      faucet/throne bots, the Censor resurrection, minibosses, branch guardian,
      quest nemesis. Add a `spawnMonster(def,x,y)` helper that sets
      `floorKey = this.activeKey` + pushes + schedules, and route them through it.
- [ ] Verify: solo unchanged; same-floor co-op unchanged. _(playtest)_

## Stage 3 — transitions move only the acting player + scheduler membership
Goal: a stair/portal moves only `this.acting`; the partner stays put; both floors
stay scheduled.
- [ ] Make `descend`/`ascend`/`enterChain`/`exitChain`/`enterQuest`/`exitQuest`/
      `enterBranch`/`descendBranch`/`ascendBranch`/`enterPlane` operate on
      `this.acting` (not `this.player`) and set `this.acting.floorKey` to the new key.
- [ ] Stop dragging the partner along: `placeParty` only repositions the *acting*
      player (+ pet if it's that player's); the other player is untouched.
- [ ] `rebuildSchedule()` — clear, add both players, then add the **alive monsters
      of every floor that currently has a player on it** (dedupe when both share a
      floor), then the pet. Call after every transition.
- [ ] Floor-scope targeting/collision (active context = the floor being acted):
      - [ ] `nearestPlayer(x,y)` → nearest player whose `floorKey === this.activeKey`
            (monster wanders if none on its floor).
      - [ ] `playerAt(x,y)` / `otherPlayerAt` → only players on the active floor.
      - [ ] `livingPlayers()` stays global (game-over check); add `playersHere()`
            for floor-scoped uses (adjacency, displacement, FOV recompute).
- [ ] Edge cases: regroup (both step onto the same key → shared slot, no dup
      monsters); a player descending into a *fresh* floor while the other is mid-turn;
      the JAM/Censor hunt (`censorHuntTick`) keyed to the floor the JAM is on.

## Stage 4 — render each player's own floor
Goal: host sees its floor, guest sees its floor (each with separate fog from the
fog-of-war work).
- [ ] `recomputeFOV` computes each player's FOV on **their** floor's `Level`
      (host → viewer 0 `computeFOV`, companion → viewer 1 `computeFOVCo`).
- [ ] `buildCells(player, viewerIdx)` renders `slots.get(player.floorKey).level`
      + that floor's monsters + players on that floor (currently it reads the
      global `this.level`).
- [ ] `draw`: host paints `buildCells(this.player, 0)`; stream
      `buildCells(this.coPlayer, 1)` to the guest. Keep the downed-spectator fallback.
- [ ] Per-player HUD: depth/realm/location label derived from each player's
      `floorKey` (today `buildHud` reads the global `currentChain`/`plane`).
- [ ] Music/area (`currentAreaId`) follows the **host's** floor (it's the host's
      soundtrack); set context to the host's floor before `draw`.

## Risks / watch-list
- **Context leakage:** any code that reads `this.level`/`this.currentChain`
  *between* acts (timers, async wallet flows, `draw`) sees the last-acted floor —
  always `setActive(host)` before host-side render.
- **Scheduler dup:** a monster must never be scheduled twice (both players on its
  floor) — `rebuildSchedule` dedupes by floor key, not by monster.
- **Mid-build context:** `setActive` bails if the slot doesn't exist yet; the
  generating transition owns the context until it `saveActive`s.
- **Planes aren't persisted** (`saveActive` skips `plane > 0`) — a player on a
  plane can't be "left and returned to"; decide whether split-onto-a-plane is
  allowed or the party regroups for the endgame.
- **Co-op is host-authoritative**; the guest only renders streamed frames, so all
  of this runs on the host. The guest's input already routes via
  `handleRemoteInput → coPlayer.feed`.

## Test plan (per stage, after 2–4)
1. Host a game in tab A, join from tab B (the lobby `#lobby` flow).
2. Same floor: confirm separate fog (you only see your partner when in sight).
3. One player takes stairs; the other stays. Confirm: mover changes floor, partner
   doesn't; each renders their own floor; monsters move on **both** floors.
4. Regroup on the same floor → no duplicated/again-spawned monsters; shared slot.
5. Split into a branch/parachain/plane; return; confirm persistence + no context bleed.
6. Down one player on a different floor → survivor plays on; spectator follows.

## Touch points (files)
- `src/entities.ts` — `Entity.floorKey`; `Player.feed`/`drainQueue`, `Monster.act`,
  `Pet.act` setActive hooks.
- `src/game.ts` — `setActive`/`applyKeyContext` (done); `scheduleParty` →
  `rebuildSchedule`; transitions; `nearestPlayer`/`playerAt`; `recomputeFOV`/
  `buildCells`/`draw`/`buildHud`; the `new Monster` spawn sites.
- `src/level.ts` — per-viewer fog already in place (`visible`/`visibleCo`,
  `explored`/`exploredCo`, `computeFOV`/`computeFOVCo`).
