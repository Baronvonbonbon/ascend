# Dungeon Expansion — toward NetHack scale

> Living plan for growing Ascend from ~12+4 levels to a full, branched, NetHack-scale
> dungeon. Built over several sessions. Decisions locked with the maintainer below.

## Locked decisions
- **Length:** full scale — **~45–60 levels** across branches (a ~25–30 main descent + several side branches).
- **Branching:** **NetHack-style mandatory branches** — some branches are on the critical path (a Sokoban-equivalent prize-gate, a Mines pass-through), not just optional loot.
- **Persistence:** **levels persist** — each level is generated once and stored; revisiting returns the *same* layout with your dropped items, bones, monsters' state. (Today we regenerate on revisit — this is the big architecture change.)
- **Generators first:** caves, labyrinth (maze+rooms), grid/city, swamp/water + special rooms.

## Layout generators
**Shipped (Phase 14a):**
- `normal` — rooms + corridors (rot-js Digger). *standard dungeon*
- `bigroom` — one vast chamber. *the Mempool*
- `maze` — perfect maze (EllerMaze). *Gehennom*
- `cave` — cellular-automata caverns, largest-region kept for connectivity. *the Mines*
- `labyrinth` — a maze with rectangular chambers carved in.
- `grid` — rooms in blocks joined by orthogonal streets. *a rollup metropolis*

All new generators share `finishLayout()`: pick a start, set the down-stair at the farthest **reachable** cell (BFS), filter spawns to reachable space, and fall back to `normal` if degenerate.

**To build:**
- `swamp` — open water with island rooms. Needs a **water tile** (impassable, or swim w/ drowning risk) + FOV/passability rules. *the Liquidity Pools*
- `fortress` — a structured keep with a moat. *the Council Fort* (NetHack Castle)
- `concentric` / `radial` — rings + spirals, for boss arenas and Planes.
- **Special rooms** dropped into `normal` levels: temple (altar+priest), zoo (packed treasure), morgue (undead+corpses), beehive (swarm+honey), barracks (soldiers), **vault** (sealed treasure, reached by digging/teleport).

## Where layouts go now (Phase 14a, pre-persistence)
Zoned into the existing descent + parachains so variety lands immediately:
- Main descent: d1–2 normal · **d3 grid** · **d4 & d6 cave** · d5 bigroom (Mempool) · **d7 labyrinth** · d8 vibrating square · d9–11 maze (Gehennom) · d12 sanctum.
- Parachains: each `ChainDef.layout` — Kusama/Phala `maze`, Moonbeam/Astar `grid`, Interlay `cave`, Bifrost `labyrinth`, Hydration `bigroom`, Acala `normal`.

## Target dungeon graph (to design in Phase 16)
A branch graph instead of a single spine:
- **Dungeons of Doom** (main, ~d1→d12 to the vibrating square) — the standard→cave→grid→labyrinth zones.
- **The Mines** (branch off the upper dungeon) — caves, a themed "Mines' End" with a luckstone-grade prize. *Mandatory pass-through or strongly incentivised.*
- **The Consensus Vault** (Sokoban-equivalent) — a hand-built boulder-puzzle branch climbing *up*; clear it for a guaranteed artifact (bag of holding / amulet). *Mandatory prize-gate.*
- **The Quest** (per-archetype) — already shipped; fold into the graph as a gated branch (Phase 13c).
- **Parachains** (XCM side-branches) — optional, each its own layout/palette/monster set.
- **The endgame ladder** — vibrating square → Gehennom (mazes, ~d9–11, expand toward ~20) → Moloch's Sanctum → the Planes → Genesis.

## Persistence architecture (Phase 15 — foundational)
- A `Map<levelKey, Level>` on `Game`, keyed by branch+depth (e.g. `"dungeon:7"`, `"mines:3"`, `"kusama:1"`).
- `descend/ascend/enterChain/enterQuest/enterPlane` look up the stored level; generate + store only on first visit.
- Store per level: tiles, items, monsters (positions/HP/state), traps, engravings, boulders, explored mask, stairs.
- The Censor hunt + bones already lean on "what's here"; persistence makes backtracking and branch loops coherent.
- Co-op: host owns the level store; guests render frames (unchanged).
- Risk: monster scheduling across stored levels — only the active level's actors are scheduled; others freeze until revisited.

## Polkadot flavor for new areas
- Mines → "the Storage Caverns" (a storage/DA parachain). Swamp → "the Liquidity Pools." Grid → "the Rollup City." Fortress → "the Council Fort." Vault → "the Treasury." Temple → "a Gavin shrine." Zoo → "an airdrop trap room."

## Phased rollout
- **14a — generators (this session):** cave, labyrinth, grid + zoning + parachain layouts. ✅
- **14b:** swamp/water tile + the `swamp` generator; first special rooms (temple, vault, zoo).
- **15 — persistence:** the level store + revisit-identical levels. *Foundational; unblocks real branches.*
- **16 — branch graph:** multi-branch dungeon; build the Mines + the Consensus Vault (Sokoban) as mandatory branches; lengthen the main descent toward ~25–30.
- **17:** fortress + concentric generators; per-Plane unique layouts; expand Gehennom.
- **18:** balance pass across the longer run (XP curve, hunger, spawn rates, the Censor cadence), more monsters/items to fill the space.
