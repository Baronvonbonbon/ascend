# Ascend — Design Document

> An authentic ASCII fantasy roguelike in the tradition of NetHack — descend the
> Dungeon of Doom, recover the **Amulet of Yendor**, and *ascend*. Provisions are
> bought with **gold**; the fallen leave **bones** in a local Hall of the Fallen.

**North star:** NetHack-grade depth and completeness. **Path:** incremental —
each phase is playable and on-theme; "parity" is the long-tail content grind
after the engine, economy, and mythology are solid.

---

## 1. The pitch

You are a **Seeker** descending the **Dungeon of Doom**. At its bottom, in the grip
of Moloch, lies the **Amulet of Yendor**. Recover it and climb back to the surface
to **Ascend** — offer it on your aligned altar beyond the world and win.

Permadeath. Procedural dungeons. Hunger, identification, emergent item play. And
a living economy: **gold** buys provisions at shrines/shops, your earnings can fund
your next run, and your fallen heroes leave **bones** for later runs to find.

---

## 2. Mythology bible (theming)

The flavor runs from names down into mechanics — theme becomes gameplay, not just
decoration.

| World concept | Roguelike role |
|---|---|
| **The Amulet of Yendor** | The endgame artifact, at the dungeon's bottom. |
| **Marduk, the Architect** | A deity/wizard; the patron of the Ascend. Prayer/altar. |
| **The Fellowship** | A patron order that grants boons; quest-givers. |
| **The surface** | The goal of ascension — climb back out with the Amulet. |
| **Dungeon branches** | Side-arms off the main descent, each with its own flavor. |
| **The Wildlands** | A chaos realm — high-risk, high-reward, faster, deadlier. |
| **Golems** | Stalwart guardian constructs. |
| **Hounds** | Allied pets that fight at your side. |
| **The Warden** | A boss demon of control and shackle, hunting the Amulet. |
| **Phantoms** | Swarm monsters that multiply. |
| **The Gray Paper** | The in-game guidebook / lore. |

**Theme → mechanics:**
- **Stealth** → a **cloak of invisibility**: become unseen, slip past guardians.
- **Survival** → **revival & anchors**: the amulet of life saving; bones of the fallen.
- **Self-reliance** → **no safe hub**: the gear you carry is the gear you keep.
- **Light** → a **lantern** that reveals the dark cheaply.

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
special levels (the Wildlands branch, a treasure vault, the Warden's lair); the Amulet of Yendor + the
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
