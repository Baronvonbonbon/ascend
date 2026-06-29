# Dungeon Expansion — toward NetHack scale

> Living plan for growing Ascend from ~12+4 levels to a full, branched, NetHack-scale
> dungeon. Built over several sessions. Decisions locked with the maintainer below.

## Locked decisions
- **Length:** full scale — **~45–60 levels** across branches (a ~25–30 main descent + several side branches).
- **Branching:** **NetHack-style mandatory branches** — some branches are on the critical path (a Sokoban-equivalent prize-gate, a Mines pass-through), not just optional loot.
- **Persistence:** **levels persist** — each level is generated once and stored; revisiting returns the *same* layout with your dropped items, bones, monsters' state. *(Shipped in Phase 15 for the dungeon, chains, and quest; planes excluded. Was: regenerate-on-revisit.)*
- **Generators first:** caves, labyrinth (maze+rooms), grid/city, swamp/water + special rooms.

## Layout generators
**Shipped (Phase 14a):**
- `normal` — rooms + corridors (rot-js Digger). *standard dungeon*
- `bigroom` — one vast chamber. *the Mempool*
- `maze` — perfect maze (EllerMaze). *Gehennom*
- `cave` — cellular-automata caverns, largest-region kept for connectivity. *the Mines*
- `labyrinth` — a maze with rectangular chambers carved in.
- `grid` — rooms in blocks joined by orthogonal streets. *a rollup metropolis*

**Shipped (Phase 14b):**
- `swamp` — open water studded with island rooms, chained by L-shaped causeways. *the Liquidity Pools*
  - New **`water` tile** (`}`): light passes (you see the far shore) but it's **impassable** to walking — `isPassable` excludes it, `lightPasses` includes it. `reachableFrom` now uses `isPassable`, so water genuinely gates reachability and `finishLayout` only places the stair / spawns on island-connected floor. Cross by causeway or XCM jump.
- **Special rooms** dropped into `normal` levels (`placeSpecialRoom`, depth ≥ 2, 35% chance, picks a non-start room via `roomCells` flood-fill):
  - **temple** — an altar tended by a peaceful Gavin **priest** (new `priest` flag, peaceful until struck → provoked like a keeper). *a Gavin shrine.*
  - **zoo** — the room packed with depth-appropriate monsters guarding scattered loot. *an airdrop trap room.*
  - **vault** — a dense treasure room (the Treasury) heaped with wares + gear around a locked chest. *Reachable normally for now; true sealed-by-walls vaults (reached only by dig/teleport) deferred — they need a path-safety check so a vault can't wall off the down-stair.*

All new generators share `finishLayout()`: pick a start, set the down-stair at the farthest **reachable** cell (BFS), filter spawns to reachable space, and fall back to `normal` if degenerate.

**To build:**
- `fortress` — a structured keep with a moat (use the `water` tile). *the Council Fort* (NetHack Castle)
- `concentric` / `radial` — rings + spirals, for boss arenas and Planes.
- More **special rooms**: morgue (undead+corpses), beehive (swarm+honey), barracks (soldiers), and **true sealed vaults** (walled-off treasure reached only by digging/teleport, gated on the path-safety check above).
- **Swim option** for water — wade with a drowning / item-drop risk — as an alternative to pure impassability.

## Where layouts go now (Phase 14a, pre-persistence)
Zoned into the existing descent + parachains so variety lands immediately:
- Main descent: d1–2 normal · **d3 grid** · **d4 & d6 cave** · d5 bigroom (Mempool) · **d7 labyrinth** · d8 vibrating square · d9–11 maze (Gehennom) · d12 sanctum.
- Parachains: each `ChainDef.layout` — Kusama/Phala `maze`, Moonbeam/Astar `grid`, Interlay `cave`, Bifrost `labyrinth`, **Hydration `swamp`** (the Liquidity Pools — was `bigroom`), Acala `normal`.

## Target dungeon graph (to design in Phase 16)
A branch graph instead of a single spine:
- **Dungeons of Doom** (main, ~d1→d12 to the vibrating square) — the standard→cave→grid→labyrinth zones.
- **The Mines** (branch off the upper dungeon) — caves, a themed "Mines' End" with a luckstone-grade prize. *Mandatory pass-through or strongly incentivised.*
- **The Consensus Vault** (Sokoban-equivalent) — a hand-built boulder-puzzle branch climbing *up*; clear it for a guaranteed artifact (bag of holding / amulet). *Mandatory prize-gate.*
- **The Quest** (per-archetype) — already shipped; fold into the graph as a gated branch (Phase 13c).
- **Parachains** (XCM side-branches) — optional, each its own layout/palette/monster set.
- **The endgame ladder** — vibrating square → Gehennom (mazes, ~d9–11, expand toward ~20) → Moloch's Sanctum → the Planes → Genesis.

## Persistence architecture (Phase 15 — foundational) ✅ SHIPPED
- `slots: Map<string, { level: Level; monsters: Monster[] }>` on `Game`, keyed by branch+depth via `levelKey()` (`"dungeon:7"`, `"kusama:1"`, `"quest"`).
- A unified `beginLevel(key, kind)`: saves the level being left, switches to the keyed slot, and returns `true` if it already exists (restore — skip generation/spawn) or `false` (generate fresh, then `saveActive()`). `descend/ascend/enterChain/exitChain/enterQuest/exitQuest` all route through it; fresh-only setup (loot caches, the quest nemesis, special rooms) lives in the `!restored` branch.
- `enterLevel` (fresh) populates then calls `placeParty` + `scheduleParty`; `restoreEnter` (revisit) re-places the party and rebuilds the schedule **without respawning**. Both share `scheduleParty` (clear → add player/partner/alive-monsters/pet → FOV → music).
- Stored per level: everything already on `Level` (tiles, items, traps, engravings, boulders, portals, graves, explored mask, stairs) **+** its `monsters[]` (positions/HP/state). The Level's own arrays are reached through the stored ref, so reassigning `level.items` is safe; only `Game.monsters` is duplicated into the slot, so `kill()` now **splices in place** (was a `filter`-reassign) to keep the array identity — dead monsters stay dead on revisit.
- Only the **active** level's actors are scheduled; stored levels freeze until revisited.
- **Planes are excluded** — the ascent only ever climbs *up* (`ascend` on a plane → `enterPlane(n+1)`), so a plane is never revisited; they regenerate per entry (and keep `genesisAltars` simple). `enterPlane` still `saveActive()`s the dungeon level it leaves.
- Edges handled: a monster frozen on the arrival stair nudges the player to a free neighbour; a **completed** Quest's homeland portal — which now persists on the relay level — goes inert (tile cleared) on re-touch instead of re-opening a dead quest.
- Co-op: host owns the level store; guests render frames (unchanged).
- **Deferred:** plane persistence (incl. `genesisAltars`/guardian state) and serialising the store for save/resume across page reloads.

## Polkadot flavor for new areas
- Mines → "the Storage Caverns" (a storage/DA parachain). Swamp → "the Liquidity Pools." Grid → "the Rollup City." Fortress → "the Council Fort." Vault → "the Treasury." Temple → "a Gavin shrine." Zoo → "an airdrop trap room."

## Phased rollout
- **14a — generators (this session):** cave, labyrinth, grid + zoning + parachain layouts. ✅
- **14b — swamp + special rooms:** the `water` tile + `swamp` generator (zoned onto the Hydration parachain) + first special rooms (temple, zoo, vault) dropped into `normal` floors. ✅
- **15 — persistence:** the level store + revisit-identical levels (dungeon + chains + quest; planes excluded). *Foundational; unblocks real branches.* ✅
- **16 — branch graph:** multi-branch dungeon; build the Mines + the Consensus Vault (Sokoban) as mandatory branches; lengthen the main descent toward ~25–30.
- **17:** fortress + concentric generators; per-Plane unique layouts; expand Gehennom.
- **18:** balance pass across the longer run (XP curve, hunger, spawn rates, the Censor cadence), more monsters/items to fill the space.
