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
- [x] **Independent floors** — players can be on different floors (`dungeon:N`,
      a parachain, a branch, a plane) at the same time, both **fully simulated**
      (monsters act on each floor and target the player *there*), each rendering
      their own floor. _(shipped — Stages 2–4; awaits two-client playtest)_
- **Two individuals** — separate per-adventurer state:
  - [x] **Items** — already per-player (`Player.inventory`). _(was already true)_
  - [x] **Identifications** — per-character knowledge over shared world appearances. _(shipped)_
  - [x] **Logs** — actor-routed: each adventurer's log shows their own actions; combat
        routes to the player fighting; shared world lines go to both. _(shipped — Stage 5)_
  - [x] **Signal messaging** — a free, once-per-turn 60-char message (key `"`) that
        degrades with distance + line-of-sight (`theres an enemy in there` →
        `th.. a. .nem. .. ..er.` farther away; nothing beyond earshot / another floor).
        _(shipped — Stage 6)_

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

## Stage 4 — render each player's own floor ✅
Goal: host sees its floor, guest sees its floor (each with separate fog from the
fog-of-war work).
- [x] `recomputeFOV` computes each player's FOV on **its own** floor's `Level`
      (done in Stage 3 — `fovOn` resolves `slots.get(p.floorKey).level`, host →
      `computeFOV`, companion → `computeFOVCo`).
- [x] `buildCells(viewer)` now resolves the viewer's floor (`me.floorKey` →
      `slots`), and reads tiles/graves/traps/portals/items/boulders/**monsters**
      from that floor's `Level`; the pet and other players draw only when they
      stand on the viewer's floor.
- [x] `draw`: host paints `buildCells(hostView)` (its own floor) and streams
      `buildCells(guestView)` to the guest. Downed-spectator fallback kept. `draw`
      anchors music + the host view to the host's floor via a **save/restore** of
      `activeKey`, so it stays side-effect-free for mid-handler callers.
- [x] Per-player HUD: location label derived from each player's `floorKey` via a
      new pure `contextOf(key)` (also now backs `applyKeyContext`).
- [x] Music/area follows the **host's** floor: `draw` sets the host's floor active
      before `musicContext`; the `setArea` crossfade in `rebuildSchedule` only fires
      on host (`this.acting === this.player`) transitions.
- [ ] Verify: host + guest each see their own floor/fog/HUD; spectate on downing.
      _(playtest — two browser tabs)_

## Stage 5 — per-player logs (actor + involved routing) ✅ _(decided)_
Goal: each adventurer sees their own log, not a shared feed. **Decision: pragmatic
"actor + involved" routing** (not full perception-based).
- [x] `Log.add(text, kind, who?)` with a host-side `audience` resolver:
      - default audience = `this.acting` (player-turn messages auto-route — most
        call sites untouched, incl. all the input prompts + self endTurn status ticks).
      - `who = "both"` for shared/world lines: the start-of-run intro (greetings /
        gray-paper / keys), the Censor rising + JAM blink-steal, a party member
        falling, and game-over.
      - `who = <player>` for monster-turn lines (when `this.acting` is stale):
        `attack` routes to the involved player (`"both"` on friendly fire);
        `rangedAttack` / `breathAttack` to the zapped player; `applyStatus` to the
        target; the thief's rug to the victim; the JAM-reclaim to the recipient.
- [x] Routing impl (host-authoritative): `audience(who)` returns `{host, guest}` —
      paint to host DOM if `host`; `onAdd`→`peer.send({t:"log"})` to guest if `guest`.
      Solo (`audience` null) + guest-side: just paint locally. `Log.paint` still
      renders guest-received lines (`onGuestMessage` `t:"log"`).
- [x] The blanket `log.onAdd` mirror is now gated by the per-line `audience`.
- [ ] Verify: each adventurer's log shows only its own actions; both see the
      shared world beats. _(playtest)_

## Stage 6 — signal messaging ✅ _(decided)_
Goal: a once-per-turn 60-char message that degrades with distance + line-of-sight.
**Decisions: free action, once/turn · distance + LOS gating.**
- [x] **Compose**: the `"` key enters compose mode (`composing` + `msgBuf` on
      `Player`, mirroring the `pendingName` text-input path in `handleKey`); type up
      to 60 chars; Enter sends, Esc cancels. Prompt echoes via the composer's own
      (routed) log. Free action — does **not** call `endTurn`; gated by a
      `signalledThisTurn` flag reset in `endTurn`. Works for the guest (keystrokes
      forward via `handleRemoteInput → coPlayer.feed`, all host-side).
- [x] **Deliver / degrade** (`sendSignal(from, msg)`):
      - different floor → undelivered ("your call goes unheard").
      - `dist = Chebyshev`; earshot `R = 14`; `dist > R` → undelivered ("too far").
      - `keep = clamp(1 - dist/R, 0, 1)`; no line-of-sight → `keep *= 0.45`.
      - mask: keep spaces; `ROT.RNG.getUniform() < keep ? ch : "."` (host-RNG so the
        host's authoritative sim stays deterministic).
      - sender hears the full text (`You signal: "…"`, routed to sender); recipient
        gets the degraded text (`Partner signals: "…"`, routed to recipient).
      - LOS: reuses the existing `hasLineOfSight` (both are on the active floor here,
        so it reads `this.level` correctly).
- [x] **Ties into independent floors**: cross-floor = undelivered falls out of the
      `floorKey` check; on a shared floor it's pure distance + LOS.

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
- **Netcode (UPDATED): co-op is now peer-authoritative deterministic lockstep**, not
  host-authoritative. Both clients run the FULL sim from a shared RNG seed and exchange
  only keystrokes (`onKey` broadcasts + drives `localPlayer`; `remoteInput` feeds the
  partner's avatar); each renders its own player's view locally and keeps its own log
  lines. So all the per-player machinery above runs identically on BOTH clients. Any new
  gameplay randomness MUST go through `ROT.RNG` (never `Math.random`/time) or it desyncs;
  per-client side effects (wallet/forge/NFT/relic-load) stay solo-gated. See the
  `feat(coop): peer-authoritative shared world` commit.

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
