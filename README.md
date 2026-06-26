# ⛓ Ascend

An authentic **ASCII roguelike on Polkadot**. Descend the dungeon of the legacy
stack, recover the **JAM** (this world's Amulet of Yendor), and *ascend*.

A homage to Polkadot, Kusama, the Web3 Foundation, JAM, Gavin Wood, and the
web3 ethos of **privacy, independence, and resiliency** — where provisions are
bought with **PAS** and your deeds are recorded on-chain (reusing the
[Datum](https://datum.javcon.io) relay + Paseo testnet).

> **Status: Phase 3 — mythology & a winnable endgame.** Everything from Phases 1–2
> **plus a goal**: descend through realms (the Legacy Stack → Parachain Reaches →
> the Kusama Deeps) to **depth 8**, slay **THE CENSOR**, seize **the JAM**, then
> climb back to the surface (`<`) to **ASCEND** and win. Plus **Gavin's altars**
> (`P` to pray → be made whole), the **Gray Paper** intro, and a theming pass.
> **Phase 4 — persistence & social** is in: when a run ends (death or ASCENSION)
> it's recorded on-chain **gaslessly** (you sign, the relay submits) into the
> **AscendLedger** Hall of Fame (`H` to view), and fallen heroes leave **bones**
> (`‡` graves) that surface in later descents. NFT gear is the remaining Phase 4b.
>
> **Phase 5 (toward parity)** is underway: hidden **traps** (`^` — gas-fee / slashing /
> reorg), a bigger bestiary including self-replicating **sybils** and the deadlier
> **Kusama Deeps** swarm, **scrolls of enchantment**, a **speed system** (fast/slow
> monsters act more/less often), natural **HP regeneration**, and **rings** —
> resilience (+max HP), regeneration, and privacy (a ZK cloak: monsters can't track you).

**On-chain (Paseo):** `AscendBank` (`0x3D35694e…FcD31`) holds your purse for gasless
shop spends; `AscendLedger` (`0x56068D…ccaa5`) is the gasless run record + bones.
Both via signature-authorized meta-transactions relayed by the Datum relay.

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
