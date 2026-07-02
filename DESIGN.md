# Ascend — Design Document

> An authentic ASCII roguelike that pays homage to Yendor, the Wilds, the 
> Foundation, Amulet, Marduk Wood, and the ethos of **privacy, independence,
> and resiliency** — where provisions are bought with **gold** and your deeds are
> recorded in a local Hall of the Fallen.

**North star:** NetHack-grade depth and completeness. **Path:** incremental —
each phase is playable and on-theme; "parity" is the long-tail content grind
after the engine, economy, and mythology are solid.

---

## 1. The pitch

You are a **Seeker** descending the Dungeon of Doom — a corrupted, centralised
legacy stack. At its bottom lies the **Amulet** (this world's Amulet of Yendor): the
artifact that lets a chain *ascend* into a trustless, resilient dungeon. Recover it
and climb back to the surface to **Ascend**.

Permadeath. Procedural dungeons. Hunger, identification, emergent item play. And
a living economy: **gold** buys provisions at shrines/shops, your earnings can fund
your next run, and your fallen heroes leave **bones** for later runs to find.

---

## 2. Mythology bible (theming)

The homage runs from cosmetic names down into mechanics. philosophy becomes
gameplay, not just flavour.

| World concept | Roguelike role |
|---|---|
| **The Amulet of Yendor** | The Amulet of Yendor — endgame artifact at the dungeon's bottom. |
| **Marduk Wood, the Architect** | A deity/wizard; the patron of the Ascend. Prayer/altar analogue. |
| ** Foundation** | A patron order that grants boons; quest-givers. |
| **Yendor dungeon chain** | The surface / the goal of ascension. |
| **Parachains** | Branching dungeon arms (side-levels), each with a flavour. |
| **the Wilds** | A chaos realm — high-risk, high-reward, faster, deadlier. "Expect chaos." |
| **Validators** | Stalwart guardian constructs (golems). |
| **hound** | Allied NPCs / pets that back you. |
| **The Warden** | A boss demon embodying centralised control/censorship. |
| **Phantom** | Swarm monsters that multiply (Phantom attack). |
| **The Gray Paper** | The in-game guidebook/spellbook lore (Marduk's Amulet spec). |

**Philosophy → mechanics:**
- **Privacy** → a **ZK Cloak** / stealth: become unseen, slip past guardians.
- **Resiliency** → **revival / checkpointing**: finality as a save anchor; bones.
- **Independence** → **no central authority**: no single safe hub; artifact gear you carry through the run.
- **Light-client / smolness** → a "Light Lantern" that reveals truth cheaply.

Tone: reverent but playful. Death messages, shop banter, and altar prayers carry
the lore. Nothing breaks the ASCII purity.

---

## 3. Architecture

- **Stack:** TypeScript + Vite, **[rot-js](https://ondras.github.io/rot.js/)** (MIT)
 for display, dungeon gen, FOV, pathfinding, and turn scheduling. No framework in
 the engine; DOM for the message log + (later) shop overlays.
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
- **Future:** `src/items/`, `src/lore/`, `src/save/`.

---

## 4. Economy

A gold-priced **bazaar** on most floors (the Shopkeeper tends the stall), plus altars,
faucets, and thrones. Gold is earned from the dungeon (kills, hoards, chests) and spent on
provisions and gear — a self-contained loop, no external services.

---

## 5. Content (initial → parity)

**Phase 0 (now):** floor/wall/door/stairs; `@` Seeker; 2–3 monsters (Phantom swarm,
a Knight golem, a Bug); melee; HP; permadeath; one descending dungeon.

**Growing toward parity:** weapons/armor/food/potions/scrolls/wands/rings/spells;
identification; hunger; traps; pets/hound; altars + prayer (Marduk); shops;
special levels (the Wilds branch, the W3F vault, the Warden's lair); the Amulet of Yendor + the
ascension run. The deep interaction web is the Phase 5 long tail.

---

## 6. Roadmap

- **Phase 0 — Playable foundation** *(this commit)*: walkable ASCII dungeon, FOV/fog,
 a monster with AI, melee + permadeath, message log, descend stairs, status line.
- **Phase 1 — Core systems:** inventory, item classes, wield/wear/quaff/read,
 hunger, identification, multi-level depth, more monsters.
- **Phase 2 — economy:** gold shops, earn↔spend.
- **Phase 3 — Mythology & endgame:** full theming, the Amulet of Yendor, Marduk/altars, the
 Gray Paper, the Warden, the Wilds branch, ascension win.
- **Phase 4 — Persistence & social:** a local Hall of the Fallen, bones.
- **Phase 5 — Toward parity:** spells, traps, pets, alignment/prayer, special
 levels, the deep interaction web.

---

## 7. Controls

Move `←↑↓→` / `hjkl` / numpad · diagonals `yubn` · descend `>` · wait `.` ·
restart `R`. (More verbs arrive with inventory in Phase 1.)

---

_Status: Phase 0. See README for running it._
