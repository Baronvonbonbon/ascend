# Co-op: the two-player rework

> Trackable plan for turning co-op into two genuinely independent adventurers —
> their own sight, floors, state (items/identifications/logs), and a distance-degraded
> signal between them. Check items off as they land;
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
- **Two individuals** — separate per-adventurer state:
  - [x] **Items** — already per-player (`Player.inventory`). _(was already true)_
  - [x] **Identifications** — per-character knowledge over shared world appearances. _(shipped)_
  - [ ] **Logs** — actor-routed: each adventurer's log shows their own actions; combat
        routes to the player fighting; shared world lines go to both.
  - [ ] **Signal messaging** — a free, once-per-turn 60-char message that degrades
        with distance + line-of-sight (the example: `theres an enemy in there` →
        `th.. a. .nem. .. ..er.` farther away; nothing beyond earshot / another floor).

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

## Stage 2 — wire the context switch into the turn loop ✅
Goal: every action runs in its actor's floor context. Still single-floor in
practice (party shares a floor), so behavior is unchanged — but the plumbing is live.
- [x] `Player.act`/`drainQueue`: `this.game.setActive(this.floorKey)` before the
      start-of-turn draw and before `handleKey`.
- [x] `Monster.act` and `Pet.act`: `this.game.setActive(this.floorKey)` at the top.
- [x] **Tag mid-play spawns** so they never carry a stale default key. Done at the
      source instead of per-site: the `Entity` constructor now sets
      `floorKey = game.activeFloorKey`, so every `new Monster(...)` (summons, splits,
      breeders, faucet/throne bots, the Censor resurrection, minibosses, branch
      guardian, quest nemesis) is born on the live floor — no `spawnMonster` helper
      and no per-site audit to forget. `scheduleParty`'s bulk re-tag is now redundant
      but harmless. Exposed `Game.activeFloorKey` getter for this.
- [ ] Verify: solo unchanged; same-floor co-op unchanged. _(playtest — provably a
      no-op while `floorKey === activeKey`; `setActive` early-returns)_

## Stage 3 — transitions move only the acting player + scheduler membership ✅
Goal: a stair/portal moves only `this.acting`; the partner stays put; both floors
stay scheduled.
- [x] `descend`/`ascend`/`enterChain`/`exitChain`/`enterQuest`/`exitQuest`/
      `enterBranch`/`descendBranch`/`ascendBranch`/`enterPlane` operate on
      `this.acting`. The arriving player's `floorKey` is set to the new key centrally
      in `rebuildSchedule` (`this.acting.floorKey = this.activeKey`).
- [x] `placeParty` no longer drags the partner — it only repositions the acting
      player's pet (the partner stays on its own floor). The acting player's own
      position is set by each transition.
- [x] `rebuildSchedule()` — clear, add both players, then the **alive monsters of
      every floor a living player stands on** (dedupe via a floor-key `Set` + a
      monster `Set`), then the pet. Replaces `scheduleParty` at all call sites.
- [x] Floor-scoped targeting/collision:
      - [x] `nearestPlayer` pools `playersHere()` (falls back to any survivor for the
            on-floor attack callers); `Monster.act` wanders when `playersHere()` is empty.
      - [x] `playerAt` / `otherPlayerAt` filter to `playersHere()`.
      - [x] `livingPlayers()` stays global (game-over); added `playersHere()` =
            living players whose `floorKey === activeKey`; `recomputeFOV` computes each
            player's FOV on its **own** floor's `Level` (via `slots`).
- [x] Edge cases: regroup → shared slot, monsters scheduled once (Set dedupe);
      `censorHuntTick` `setActive(holder.floorKey)` so the hunt rises on the
      JAM-bearer's floor; `enterPlane` now sets `activeKey = plane:n` and registers
      the plane in `slots` so per-actor `setActive` doesn't yank a player off a plane.
- Removed the `branchReturnDepth` field — `ascendBranch` now restores `def.entryDepth`
      directly (a branch always roots there), eliminating a co-op shared-field collision.
- **Known v1 limitation:** procedural spawn density/scaling in `enterLevel`
      (`spawnMonsters`/`placeJamAndBoss`/Monster ctor) still reads `this.player.depth`,
      so a *guest*-generated floor scales to the host's depth. Cosmetic/balance only
      (no crash); revisit if guests routinely generate floors far from the host.
- [ ] Verify: split via stairs, regroup, branch/parachain/plane split. _(playtest —
      two browser tabs; cannot be checked headlessly)_

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

## Stage 5 — per-player logs (actor + involved routing) _(decided)_
Goal: each adventurer sees their own log, not a shared feed. **Decision: pragmatic
"actor + involved" routing** (not full perception-based).
- [ ] Replace the single `Log` with a router (`this.log.add(text, kind, who?)`):
      - default audience = `this.acting` (the player whose action produced the line)
        → **no change needed at most call sites** (player-turn messages auto-route).
      - `who = "both"` for shared/world lines (level entry, greetings, the JAM/Censor
        world events, a party member falling, game over).
      - `who = <player>` for messages about a specific player during a **monster's**
        turn (the actor is stale then): route `attack(a, d)` combat to the player
        involved (defender if `d` is a Player, else `a`); route steal / breath /
        summon / status-affliction lines to the **target** player.
- [ ] Routing impl (host-authoritative): paint to host DOM if audience includes
      `this.player`; `peer.send({t:"log",…})` to the guest if it includes
      `this.coPlayer`. Solo + guest-side: just paint locally (no behavior change).
- [ ] Keep `Log.paint` for guest-received lines (`onGuestMessage` `t:"log"`).
- [ ] Audit the handful of currently-`onAdd`-mirrored messages; the per-player
      router replaces the blanket mirror at `log.onAdd`.

## Stage 6 — signal messaging _(decided)_
Goal: a once-per-turn 60-char message that degrades with distance + line-of-sight.
**Decisions: free action, once/turn · distance + LOS gating.**
- [ ] **Compose**: a key (pick a free one, e.g. `T`/`"`) enters compose mode
      (per-player `msgBuf` + `composing` flag on `Player`, reusing the `pendingName`
      text-input pattern in `handleKey`); type up to 60 chars; Enter sends, Esc
      cancels. Prompt echoed via the player's own (routed) log. Free action — does
      **not** call `endTurn`; gated by a `signalledThisTurn` flag reset in `endTurn`.
      Works for the guest too (keystrokes already forward via `handleRemoteInput →
      coPlayer.feed`).
- [ ] **Deliver / degrade** (`sendSignal(from)`):
      - different floor (`from.floorKey !== to.floorKey`) → undelivered ("your call
        goes unheard").
      - `dist = Chebyshev(from, to)`; earshot `R ≈ 14`. `dist > R` → undelivered.
      - `keep = clamp(1 - dist/R, 0, 1)`; if no line-of-sight between them,
        `keep *= 0.45` (muffled by walls / out of eyeshot).
      - mask: per char, keep spaces; `Math.random() < keep ? ch : "."` → scattered
        survivors, more dots farther/blocked (`th.. a. .nem. .. ..er.`).
      - sender's log (routed to sender): full text — `You signal: "…"`.
        recipient's log (routed to recipient): the degraded text — `Partner signals: "…"`.
      - LOS helper: reuse the ranged-attack sight check if present, else a Bresenham
        wall check between the two tiles.
- [ ] **Ties into independent floors**: cross-floor = undelivered falls out naturally
      once players can split (Stages 2–4); on a shared floor it's pure distance + LOS.

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
