# Ascend — Design Document

> An authentic ASCII roguelike that pays homage to Polkadot, Kusama, the Web3
> Foundation, JAM, Gavin Wood, and the web3 ethos of **privacy, independence,
> and resiliency** — where provisions are bought with **PAS** and your deeds are
> recorded on-chain.

**North star:** NetHack-grade depth and completeness. **Path:** incremental —
each phase is playable and on-theme; "parity" is the long-tail content grind
after the engine, economy, and mythology are solid.

---

## 1. The pitch

You are a **Seeker** descending the Dungeon of Doom — a corrupted, centralised
legacy stack. At its bottom lies the **JAM** (this world's Amulet of Yendor): the
artifact that lets a chain *ascend* into a trustless, resilient relay. Recover it
and climb back to the surface to **Ascend**.

Permadeath. Procedural dungeons. Hunger, identification, emergent item play. And
a living economy: **PAS** buys provisions at shrines/shops, your earnings can fund
your next run, and your fallen heroes leave **bones** on-chain for others to find.

---

## 2. Mythology bible (theming)

The homage runs from cosmetic names down into mechanics. Web3 philosophy becomes
gameplay, not just flavour.

| World concept | Roguelike role |
|---|---|
| **The JAM** | The Amulet of Yendor — endgame artifact at the dungeon's bottom. |
| **Gavin Wood, the Architect** | A deity/wizard; the patron of the Ascend. Prayer/altar analogue. |
| **Web3 Foundation** | A patron order that grants boons; quest-givers. |
| **Polkadot relay chain** | The surface / the goal of ascension. |
| **Parachains** | Branching dungeon arms (side-levels), each with a flavour. |
| **Kusama** | A chaos realm — high-risk, high-reward, faster, deadlier. "Expect chaos." |
| **Validators** | Stalwart guardian constructs (golems). |
| **Nominators** | Allied NPCs / pets that back you. |
| **The Censor** | A boss demon embodying centralised control/censorship. |
| **Sybils** | Swarm monsters that multiply (Sybil attack). |
| **The Gray Paper** | The in-game guidebook/spellbook lore (Gavin's JAM spec). |

**Philosophy → mechanics:**
- **Privacy** → a **ZK Cloak** / stealth: become unseen, slip past guardians.
- **Resiliency** → **revival / checkpointing**: finality as a save anchor; bones.
- **Independence** → **no central authority**: no single safe hub; self-custody of
  your gear (NFT items you truly own), permissionless shops.
- **Light-client / smolness** → a "Light Lantern" that reveals truth cheaply.

Tone: reverent but playful. Death messages, shop banter, and altar prayers carry
the lore. Nothing breaks the ASCII purity.

---

## 3. Architecture

- **Stack:** TypeScript + Vite, **[rot-js](https://ondras.github.io/rot.js/)** (MIT)
  for display, dungeon gen, FOV, pathfinding, and turn scheduling. No framework in
  the engine; DOM for the message log + (later) wallet/shop overlays.
- **Rendering:** one `ROT.Display` (ASCII grid). Map + status line on the canvas;
  scrolling message log in the DOM. Tile renderer is an optional later swap.
- **Turn model:** `ROT.Scheduler.Simple` + `ROT.Engine`. The player's `act()`
  locks the engine and resolves on keypress; monsters act on their turns.
- **Modules (Phase 0):**
  - `src/main.ts` — bootstrap + mount.
  - `src/game.ts` — orchestrator: display, level, player, engine, draw, log, descend, game-over.
  - `src/level.ts` — map generation (Digger), tiles, FOV/fog-of-war, stairs, spawns.
  - `src/entities.ts` — `Entity`, `Player`, `Monster` (+ simple AI).
  - `src/data.ts` — glyph/colour palette, monster table, themed strings.
  - `src/log.ts` — message log.
- **Future:** `src/chain/` (wallet, relay client, shop), `src/items/`,
  `src/lore/`, `src/save/`.

---

## 4. On-chain integration (reuses Datum / Paseo)

Same Paseo Asset Hub testnet and the **gasless relay** pattern from datum-tavern
(sign a message, the relay submits + pays gas — no per-action fee friction).

- **PAS shops (Phase 2):** in-dungeon shops/altars sell provisions for PAS. A small
  `AscendShop` contract (or reuse a vault) debits PAS gaslessly via the relay.
- **Earn ↔ spend (Phase 2):** fund runs by earning PAS (Datum ad views/quests) and
  spending on gear — a closed loop across the two games.
- **On-chain runs / leaderboard (Phase 4):** permadeath records + a hall of fame;
  **bones** — your dead hero's level/loadout left on-chain for another player's run.
- **NFT gear / ownership (Phase 4):** notable artifacts as on-chain tokens —
  self-custodied, carried between runs, tradeable. Embodies *independence*.

Wallet: MetaMask + Nova (with the `wss://` lesson baked in). All spends gasless.

---

## 5. Content (initial → parity)

**Phase 0 (now):** floor/wall/door/stairs; `@` Seeker; 2–3 monsters (Sybil swarm,
a Validator golem, a Bug); melee; HP; permadeath; one descending dungeon.

**Growing toward parity:** weapons/armor/food/potions/scrolls/wands/rings/spells;
identification; hunger; traps; pets/nominators; altars + prayer (Gavin); shops;
special levels (Kusama branch, the W3F vault, the Censor's lair); the JAM + the
ascension run. The deep interaction web is the Phase 5 long tail.

---

## 6. Roadmap

- **Phase 0 — Playable foundation** *(this commit)*: walkable ASCII dungeon, FOV/fog,
  a monster with AI, melee + permadeath, message log, descend stairs, status line.
- **Phase 1 — Core systems:** inventory, item classes, wield/wear/quaff/read,
  hunger, identification, multi-level depth, more monsters.
- **Phase 2 — Web3 economy:** wallet connect, gasless PAS shops, earn↔spend.
- **Phase 3 — Mythology & endgame:** full theming, the JAM, Gavin/altars, the
  Gray Paper, the Censor, Kusama branch, ascension win.
- **Phase 4 — Persistence & social:** on-chain runs/leaderboard, bones, NFT gear.
- **Phase 5 — Toward parity:** spells, traps, pets, alignment/prayer, special
  levels, the deep interaction web.

---

## 7. Controls

Move `←↑↓→` / `hjkl` / numpad · diagonals `yubn` · descend `>` · wait `.` ·
restart `R`. (More verbs arrive with inventory in Phase 1.)

---

_Status: Phase 0. See README for running it._
