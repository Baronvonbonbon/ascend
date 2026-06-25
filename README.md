# ⛓ Ascend

An authentic **ASCII roguelike on Polkadot**. Descend the dungeon of the legacy
stack, recover the **JAM** (this world's Amulet of Yendor), and *ascend*.

A homage to Polkadot, Kusama, the Web3 Foundation, JAM, Gavin Wood, and the
web3 ethos of **privacy, independence, and resiliency** — where provisions are
bought with **PAS** and your deeds are recorded on-chain (reusing the
[Datum](https://datum.javcon.io) relay + Paseo testnet).

> **Status: Phase 1 — core roguelike systems.** Procedural dungeon, fog-of-war FOV,
> monsters with AI, melee + permadeath, **items** (weapons/armor/food/potions/scrolls)
> on the floor, an **inventory**, **equip** (weapon damage + armor soak), **consumables**
> with effects (heal/harm/strength/teleport/map/identify), a **hunger clock**, and
> **identification** (randomised potion/scroll appearances). The PAS economy,
> mythology, and on-chain layer arrive next — see **[DESIGN.md](./DESIGN.md)**.

## Play it

```bash
npm install
npm run dev      # http://localhost:5180
```

**Controls:** move **arrows/hjkl/yubn** · pick up `,` · inventory `i` · wield `w` ·
wear `W` · quaff `q` · read `r` · eat `e` · drop `d` · descend `>` · wait `.` · restart `R`.

`npm run build` → typecheck + production bundle in `dist/`.

## Stack

TypeScript + Vite + [rot-js](https://ondras.github.io/rot.js/) (MIT) for the
roguelike engine (display, dungeon generation, FOV, pathfinding, turn scheduling).
No framework in the engine; the chain layer reuses the Datum relay.

## Roadmap (abridged)

0. **Foundation** *(now)* — dungeon, FOV, monsters, combat, permadeath.
1. **Core systems** — inventory, items, hunger, identification, depth.
2. **Web3 economy** — wallet connect, gasless PAS shops, earn↔spend.
3. **Mythology & endgame** — full theming, the JAM, altars (Gavin), the Censor, ascension.
4. **Persistence & social** — on-chain runs/leaderboard, bones, NFT gear.
5. **Toward parity** — spells, traps, pets, alignment, special levels.

Full design + theming bible in **[DESIGN.md](./DESIGN.md)**.

## License

GPL-3.0-or-later.
