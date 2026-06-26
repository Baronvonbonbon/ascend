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
> (`‡` graves) that surface in later descents.
>
> **Phase 4b — NFT gear (`✦` relics)** is in: mini-bosses drop, and bazaars in the
> Parachain Reaches sell, **relics** — enchanted equipment minted to you as **tradeable
> ERC-721 NFTs** on the **AscendGear** contract (gasless: you sign a Mint authorization,
> the relay — which holds the minter role — submits and pays gas). Relics are standard
> ERC-721s with `transfer`/`approve`, so any marketplace (e.g. Datum Tavern) can list and
> trade them, and your owned relics **materialise in your pack at the start of every run** —
> real, tradeable meta-progression that outlives permadeath.
>
> **Phase 5 (toward parity)** is underway: hidden **traps** (`^` — gas-fee / slashing /
> reorg), a bigger bestiary including self-replicating **sybils** and the deadlier
> **Kusama Deeps** swarm, **scrolls of enchantment**, a **speed system** (fast/slow
> monsters act more/less often), natural **HP regeneration**, and **rings** —
> resilience (+max HP), regeneration, and privacy (a ZK cloak: monsters can't track you),
> and charged **wands** (`z` to zap in a direction — a bolt of finality, banishment,
> **slowness**, or **digging** to tunnel through walls), plus a **scroll of cleansing** (cure status).
> **Status effects** add bite: gas wraiths **poison** (damage over time), censor imps and
> 51% attackers **confuse** (you stagger), and **oracles** (`o`) **zap you from afar**
> with line-of-sight — cured by prayer or a healing potion. **Rug pullers** (`r`) live up
> to the name: get adjacent and one will **snatch an item from your pack and bolt** — chase
> it down and kill it to reclaim your loot, or it escapes and you're rugged. Not all loot
> is loot: **honeypots** (`m`) are **mimics** that sit disguised as an item — a sword, a
> potion, a ring — and lunge the moment you reach for them. And you
> start with a **nominator** (`d`) — a loyal pet that follows you and savages adjacent foes.
> Mid-depth floors hold **XCM portals** (`Ω`): call out (`>`) to a **parachain branch** —
> Kusama, Moonbeam, Astar, Phala, Interlay, Bifrost, Hydration, Acala — each with its own
> **difficulty × loot** multipliers (some up, some down from the relay). Climb back (`<`) to the relay.

> **Realm mini-bosses** guard the run: **the Forkmaster** (depth 3) and **the Sudo Key**
> (depth 6) each drop a guaranteed prize when slain, before **THE CENSOR** and the JAM at depth 8.

> **Sanctity (BUC):** every item is secretly **blessed**, **uncursed**, or **cursed**. Blessed
> gear hits / guards / heals harder; **cursed** gear is a trap — wield or wear it and it
> **welds on** (you can't unequip or drop it until it's cleansed), a cursed ring betrays you,
> and a cursed scroll of enchantment *corrodes* your blade. You don't know an item's sanctity
> until you learn it: set it on **Gavin's altar** (`_`) to read the glow, **identify** it, or just
> risk equipping it. To break a curse, **pray** at an altar (`P`) or read a **scroll of formal
> verification** (audit) — relics and shop wares come pre-audited.

**On-chain (Paseo):** `AscendBank` (`0x3D35694e…FcD31`) holds your purse for gasless
shop spends; `AscendLedger` (`0x56068D…ccaa5`) is the gasless run record + bones;
`AscendGear` (`0xd029ae…B7c3`) is the tradeable ERC-721 relic NFT. All three via
signature-authorized meta-transactions relayed by the Datum relay (gasless for the player).

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
4. **Persistence & social** — on-chain runs/leaderboard, bones, **tradeable NFT gear** ✓.
5. **Toward parity** — spells, traps, pets, alignment, special levels.

Full design + theming bible in **[DESIGN.md](./DESIGN.md)**.

## License

GPL-3.0-or-later.
