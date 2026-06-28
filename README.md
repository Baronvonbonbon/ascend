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
> **Phase 4b — NFT gear (`✦` relics)** is in: take any piece of equipment and **forge** (`F`)
> it into a **tradeable ERC-721 NFT** on the **AscendGear** contract. Minting is **permissionless
> and direct** — you pay PAS straight from your wallet (no relay, no trusted minter), and the
> contract **rolls the relic's rarity on-chain** — *Common → Rare → Epic → Legendary* — which adds
> to its enchant, so a forge is a gamble. On-chain anti-cheat is enforced by bounds (allowlisted
> ids, enchant cap), the PAS price (scales with base enchant), and a per-address cooldown; an
> optional **luck token (WUD)** can tilt the odds toward rarer rolls. Relics are standard ERC-721s
> with `transfer`/`approve`, so any marketplace (e.g. Datum Tavern) can list and trade them, and
> your owned relics **materialise in your pack at the start of every run** — real, tradeable
> meta-progression that outlives permadeath.
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
> You can **throw** (`t`) too: hurl a dagger down a corridor as a ranged strike (it lands where
> it falls, ready to retrieve), or lob a **potion of reorg** like a grenade to burst it on a foe.
> Cornered? **Engrave** (`E`) a clause of the Gray Paper in the dust (`§`): ordinary foes shrink
> from the warded tile and won't attack while you stand on it — a breather that scuffs away with
> time and faster if you fight on it. Bosses and **THE CENSOR** fear no scripture.
> Mid-depth floors hold **XCM portals** (`Ω`): call out (`>`) to a **parachain branch** —
> Kusama, Moonbeam, Astar, Phala, Interlay, Bifrost, Hydration, Acala — each with its own
> **difficulty × loot** multipliers (some up, some down from the relay). Climb back (`<`) to the relay.

> **The bazaar has a keeper.** Each shop is tended by **the Marketmaker** (`$`) — peaceful
> while you pay (stand on a ware, `p` — a **direct wallet transaction** in PAS; the game
> freezes with flavor text until it confirms on-chain), but **shoplift** an unpaid ware (or strike it)
> and it turns lethal and hunts you down. It fears no Gray-Paper ward. Kill it and the stall is
> yours — but it hits like a boss.

> **Realm mini-bosses** guard the run: **the Forkmaster** (depth 3) and **the Sudo Key**
> (depth 6) each drop a guaranteed prize when slain, before **THE CENSOR** and the JAM at depth 8.

> **Sanctity (BUC):** every item is secretly **blessed**, **uncursed**, or **cursed**. Blessed
> gear hits / guards / heals harder; **cursed** gear is a trap — wield or wear it and it
> **welds on** (you can't unequip or drop it until it's cleansed), a cursed ring betrays you,
> and a cursed scroll of enchantment *corrodes* your blade. You don't know an item's sanctity
> until you learn it: set it on **Gavin's altar** (`_`) to read the glow, **identify** it, or just
> risk equipping it. To break a curse, **pray** at an altar (`P`) or read a **scroll of formal
> verification** (audit) — relics and shop wares come pre-audited.

**On-chain (Paseo):** `AscendBank` (`0x3D35694e…FcD31`) takes shop payments — each purchase
is a **direct wallet transaction** in PAS (you confirm in your wallet; the game blocks until
it's mined). `AscendLedger` (`0x56068D…ccaa5`) is the gasless run record + bones, and
`AscendGear` (`0xFbE3c0de…2d7D`) is the tradeable ERC-721 relic NFT — forged **directly from your
wallet** (permissionless, on-chain rarity roll). `AscendLedger` still records runs gaslessly via the
Datum relay.

**Co-op (P2P, experimental):** a serverless **WebRTC** lobby links two players directly
browser-to-browser (paste an offer code, get an answer code back — no matchmaking server).
Pick a mode and Host/Join, and you drop into **one shared, live dungeon**: host-authoritative
(the host runs the sim and streams frames; the guest is a thin terminal), **interleave-by-speed**
turns (each acts on their own ticks; the world briefly pauses if one opens a menu), **union FOV**,
and per-mode interaction — **co-op** (no friendly fire), **co-op + friendly fire**, or **race to
the JAM**. You see each other on the map (host = cream `@`, guest = teal `@`); monsters target the
nearest of you; a fallen partner is down but the survivor fights on. *(v1: shops, forging, and
pets are solo-only; restart is host-driven.)*

**Mobile:** on touch / narrow screens an on-screen control deck appears — a D-pad (move + wait),
quick actions (pick / buy / stairs / pack), and a **⌨ more** drawer with the item verbs and an
a–t letter strip for inventory selections. The canvas scales to fit.

## Play it

```bash
npm install
npm run dev      # http://localhost:5180
```

**Character (Phase 6):** pick an **archetype** (Validator / Nominator / Cypherpunk / Builder) in the
top bar, each with its own six attributes (**STR/DEX/CON/INT/WIS/CHA**) and starting kit. Kills grant
**XP** → **epochs** (levels) that raise max HP; combat now rolls a **d20 to-hit** (your level + DEX +
weapon enchant vs the foe's dodge — misses happen), and **STR** adds to your melee damage. Press `@`
for your character sheet.

**Corpses & afflictions (Phase 7a):** slain monsters leave **corpses** (`%`) — stand on one and press
`e` to eat for nutrition, and maybe an **intrinsic** (poison resistance, intrinsic speed). But eat with
care: a **freezer** (`c`) corpse **petrifies** you (`Ston` — a deadly countdown), and rotten corpses make
you **ill** (`Ill`). Race the clock: **pray** or read a **scroll of cleansing** to cure before it kills you.

**Armor & erosion (Phase 7b):** there are now **seven armor slots** — shirt, body, cloak, helm, gloves,
boots, shield — wear one of each (`W`) and remove a chosen piece with `T`. **AC is evasion** now (more
armor = harder to hit, not less damage taken). Watch out for **rust bugs** (`x`): their touch **corrodes**
a worn piece (rusty → badly corroded), dropping its AC — **pray** to repair it, or read a blessed **scroll
of formal verification** to repair *and* rust-proof ("audit") your gear.

**Wands & the ray engine (Phase 7d):** beyond finality/banish/slow/dig, find a **wand of immolation**
(a **fire ray** that bounces off walls and burns everything in line — including *you* if it caroms back),
**stasis** (sleep a foe), **forking** (polymorph a monster into a random other one), **nullification**
(strip a foe's special powers), and **state-read** (probe a monster's HP + traits). Zap with `z`.

**Tools (Phase 7c):** **apply** (`a`) a **tool** (`(`) — an **excavator** (reusable pick-axe; dig walls
in a direction), an **auditor's horn** (cure poison / confusion / **stoning** / **illness** + a small
mend — your lifeline against eating the wrong corpse), a **contract deployer** (write a chosen scroll,
spending its gas), or a **state reader** (probe an adjacent foe's HP + traits).

**Blindness & telepathy (Phase 7e):** a **potion of obfuscation** blinds you — your sight shrinks to
arm's reach (`Blind`) and you swing less accurately; **throw** it to blind a monster so it can't find
you. Eat a **censor imp** corpse for **telepathy**, which lets you *sense every monster's mind while
blind*. Cure blindness with prayer, the **auditor's horn**, a scroll of cleansing, or just wait it out.

**Spellcasting (Phase 8a):** you have **energy** (Pw, from INT + epoch — it regenerates). Find a
**runtime** (spellbook `+`) and **read** (`r`) it to *study* the spell (INT-gated — retry if it eludes
you), then **cast** (`Z`) it for energy: **finality bolt** (a directional blast), **self-mend** (heal),
**light client** (map the level), **sense minds** (reveal monsters), **XCM jump** (teleport), or
**overclock** (haste). Builders and Cypherpunks start knowing one; higher **Throughput** (INT) means
fewer fizzles.

**Faith & Fortune (Phase 8c):** you have a **Fortune** stat (Luck, −13..+13) that sways every to-hit
and dodge. Raise it by **offering** (`O`) a corpse on (or beside) a **Gavin altar** — burn it for the
Architect's favor (a rare blessed **gift**, or a mend; rotten offerings displease him). A **HODL stone**
is a gamble: blessed it's a **luckstone** (+Fortune), cursed it's a **loadstone** you can't drop — and you
won't know which until you check it on an altar. Prayer also steadies bad Fortune.

**Polymorph / "fork" (Phase 8b):** read a **scroll of hard fork** (or step on a **fork trap**) to
transform *into a monster* — you take its glyph, attacks, speed, and HP pool for a couple dozen turns,
then snap back. Become a **whale** to tank a hard fight, a **fork daemon** to blur past foes — and don't
panic if the form's HP hits zero: you collapse back to your true form and may well survive.

**Faith & crowning (Phase 8d):** your archetype has an **ethos** — Order, Balance, or Chaos. Prayer and
altar **offerings** build **favor** with Gavin; earn enough and he may **induct you into the Technical
Fellowship** (as an **Architect** / **Fellow** / **Adept**, by ethos), granting a rank/title, a Fortune
boost, an intrinsic, and a blessed gift. But **don't pray too often** — praying before the cooldown lapses now brings his **wrath**
(a smite, a cursed item, or soured Fortune), so save it for when you truly need it.

**Faucets & thrones (Phase 9a):** the dungeon now holds **testnet faucets** (`{`) — stand on one and
**quaff** (`q`) for a gamble: refreshing water (heal), a HODL stone, a **faucet bot**, tainted (poison),
or it runs dry. And the **Sudo Throne** (`\`) — **sit** (`s`) on it for raw privilege: a full heal +
Fortune, an instant level or pack-identify… or a curse, a teleport, a guardian, or the throne crumbling.

**Chests (Phase 9b):** **chests** (`(`) appear in rooms — stand on one and **open** (`o`) it (locked ones
take a few tries to force); the loot spills onto the floor to pick up. And you can now **walk past the
Marketmaker** — stepping into a peaceful NPC (or your nominator) **swaps places** instead of attacking, so
no more accidental shop brawls; you only fight the keeper once you've provoked it by shoplifting.

**Doors (Phase 9c):** doorways are now open (`'`), **closed** (`+` — blocks line of sight; walk into it to
push it open and reveal the room), or **locked** (orange `+` — walk into it to **kick** it open; your
**Stake-weight** (STR) decides how easily it bursts, and you might stub your foot). Closed doors keep
monsters out of a room until you open them — useful for picking your fights.

**The Mempool & searching (Phase 9d/9f):** depth 5 is now a **special level — THE MEMPOOL**, one vast
open chamber teeming with a swarm and strewn with loot (NetHack's Big Room). And **search** with `s`:
your **Insight** (WIS) reveals **hidden traps** and **hidden doors** (which look just like walls), and you
**disarm** (DEX) any revealed trap next to you. So a **reorg trap** blocking a corridor is no longer a dead
end — step up beside it, press `s` to disarm it, and walk on.

**Controls:** move **arrows/hjkl/yubn** · pick up `,` · inventory `i` · sheet `@` · wield `w` ·
wear `W` · take off `T` · quaff `q` · read/study `r` · eat `e` · drop `d` · zap `z` · cast `Z` ·
throw `t` · apply tool `a` · engrave `E` · pray `P` · offer `O` · descend `>` · ascend/up `<` · wait `.` · restart `R`.

`npm run build` → typecheck + production bundle in `dist/`.

## Stack

TypeScript + Vite + [rot-js](https://ondras.github.io/rot.js/) (MIT) for the
roguelike engine (display, dungeon generation, FOV, pathfinding, turn scheduling).
No framework in the engine; the chain layer reuses the Datum relay.

## Roadmap (abridged)

0. **Foundation** *(now)* — dungeon, FOV, monsters, combat, permadeath.
1. **Core systems** — inventory, items, hunger, identification, depth.
2. **Web3 economy** — wallet connect, direct-wallet PAS shop payments, earn↔spend.
3. **Mythology & endgame** — full theming, the JAM, altars (Gavin), the Censor, ascension.
4. **Persistence & social** — on-chain runs/leaderboard, bones, **tradeable NFT gear** ✓.
5. **Toward parity** — spells, traps, pets, alignment, special levels.

Full design + theming bible in **[DESIGN.md](./DESIGN.md)**. The complete
**[NetHack ↔ Ascend parity map + Phase 6–13 roadmap](./NETHACK-PARITY.md)** tracks every
canonical NetHack subsystem against Ascend's status and plans the missing ones in Polkadot flavor.

## License

GPL-3.0-or-later.
