# Ascend ↔ NetHack Feature Parity & Roadmap

A working map from **canonical NetHack** ([NetHack/NetHack @ `NetHack-5.0`](https://github.com/NetHack/NetHack/tree/NetHack-5.0/src),
133 source files) to **Ascend**, the ASCII roguelike on Polkadot. Each NetHack
`src/*.c` file is roughly one subsystem; we inventory every one, mark Ascend's
status, and plan the missing parts in the Polkadot/web3 idiom.

**Status legend:** ✅ implemented · 🟡 partial · ❌ missing · ⤬ intentionally adapted/cut

> This is a living design doc. It is the source of truth for the post-Phase-5
> roadmap (Phases 6–13). Implement top-down; keep the homage faithful but always
> in the idiom of **privacy, independence, resiliency, JAM, and Gavin Wood**.

---

## 0. The flavor dictionary (NetHack → Ascend)

Every adaptation routes through this table so the theming stays coherent.

| NetHack | Ascend (Polkadot) | Status |
|---|---|---|
| Amulet of Yendor | **the JAM** (trustless finality) | ✅ |
| Dungeons of Doom | **the Legacy Stack** → Parachain Reaches → Kusama Deeps | ✅ |
| gold (`$`) | **PAS** (on-chain, real wallet) | ✅ |
| Gnomish Mines (branch) | **the Mempool Mines** (MEV, sludge, gnome miners → bots) | ❌ |
| Sokoban (branch) | **the Consensus Vault** (push *blocks* into order; reward = wallet/amulet) | ❌ |
| Oracle (level) | **the Oracle** parachain — pay PAS for a major/minor consultation | 🟡 (oracle is a *monster* today) |
| The Quest (per-role) | role **Quest** — homeland, portal, nemesis, your artifact | ❌ |
| Fort Ludios | **Fort Treasury** (Interlay/BTC vault, soldiers → Council guards) | ❌ |
| Vlad's Tower | **the Validator's Tower** (Vlad → a slashing lord) | ❌ |
| Wizard of Yendor | **THE CENSOR** (recurring antagonist, resurrects, steals the JAM) | 🟡 (boss exists; no resurrection/hunt) |
| Gehennom | **the Dark Forest** (the centralized hells; mazes, demon lords) | ❌ |
| Elemental Planes | **the Relay Planes** (Network / Consensus / Compute / Storage) | ❌ |
| Astral Plane | **the Genesis Plane** — offer the JAM on your Architect's altar | ❌ |
| Gods + alignment (Law/Neutral/Chaos) | **Architects** + **ethos**: Order (Polkadot governance) / Balance (Builders) / Chaos (Kusama/cypherpunk) | 🟡 (Gavin altars exist; no alignment) |
| Roles (Valkyrie, Wizard…) | **archetypes**: Validator, Nominator, Builder, Cypherpunk, Researcher, Whale, Auditor, Oracle-Seer | ❌ |
| Races (Human/Elf/Dwarf/Gnome/Orc) | **ecosystems**: Substrate-native, EVM, Bitcoiner, Kusaman, Goblin/bot | ❌ |
| Pet dog/cat | **nominator** (`d`) | ✅ |
| Steed (horse, #ride) | **validator steed** (ride into battle) | ❌ |
| Polymorph (self/other) | **fork** / **runtime upgrade** (poly self = hard fork) | ❌ |
| Spellbooks + spells + Pw | **runtimes** + extrinsics + **energy/gas** | ❌ |
| Wands | on-chain **primitives** (bolt, banish, slow, dig…) | 🟡 (4 of ~20) |
| Rings | **rings** (resilience, regen, privacy…) | 🟡 (3 of ~28) |
| Artifacts (Excalibur, Stormbringer…) | legendary **NFT relics** (Gavin's Gavel, the Genesis Blade, the Gray Paper) | 🟡 (forge + on-chain rarity; no named/intrinsic artifacts) |
| Prayer to your god | **pray** to your Architect (Gavin) | 🟡 (heal/uncurse; no luck/alignment/trouble model) |
| Sacrifice on altar | **burn** a corpse/item to your Architect (a burn address) for favor | ❌ |
| Luck / luckstone | **Fortune** / a **HODL stone** | ❌ |
| Conducts | **vows** (self-custody, no-MEV, pacifist, illiterate…) | ❌ |
| Shopkeeper | **the Marketmaker** (`$`) | ✅ |
| Priest (altar minister) | **the Architect's Acolyte** | ❌ |
| Vault + guard | **the Treasury** + a **Council Guard** | ❌ |
| Nymph (steals items) | **rug puller** (`r`) | ✅ |
| Leprechaun (steals gold) | **airdrop farmer** (steals PAS) | ❌ |
| Mind flayer (brain) | **the Censor-spawn** (identity/seed attack) | ❌ |
| Cockatrice/Medusa (petrify) | **the Freezer / the Regulator** (freeze funds = petrification) | ❌ |
| Fountain (#quaff/#dip) | **a faucet** (`{`) — drink for chaos; dip for Excalibur-equivalent | ❌ |
| Sink | **a burn sink** | ❌ |
| Throne (#sit) | **the Sudo Throne** | ❌ |
| Altar | **Gavin's altar** (`_`) | ✅ |
| Bag of holding | **a multisig vault** (weightless container) | ❌ |
| Bag of tricks | **a faucet bag** (spits monsters) | ❌ |
| Loadstone (cursed, can't drop) | **a rug token** (loadstone) | 🟡 (welded gear exists; no weight) |
| Gems / glass | **tokens** (real vs worthless airdrops) | ❌ |
| Light (lamp/candle) | **block explorer** light sources; **the Genesis Candelabrum** | ❌ |
| Invocation items (Bell, Candelabrum, Book of the Dead) | **the Bell of Finality, the Genesis Candelabrum, the Gray Paper** | ❌ |
| Bones files | ✅ on-chain bones | ✅ |
| Topten / scoring | ✅ on-chain Hall of Fame | ✅ |
| Engrave Elbereth | **engrave a Gray-Paper clause** (`§`) ward | ✅ |

---

## 1. Subsystem inventory (by NetHack source file)

### A. Character & attributes
- **`attrib.c`, `u_init.c`, `role.c`, `exper.c`** — STR/DEX/CON/INT/WIS/CHA, role/race/gender/alignment, XP levels, attribute gain/loss, exercise. → **❌ Ascend has no attributes, role, race, alignment, or XP.** Today the player is a single fixed avatar (20 HP, fixed damage). **Plan (Phase 6):** add the six attributes (Polkadot-flavored display: STR=Stake-weight, DEX=Latency, CON=Resilience, INT=Throughput, WIS=Insight, CHA=Reputation), an XP/level curve (levels = "epochs"), and per-archetype starting kits/stats. Attributes feed to-hit, AC, carry capacity, spell success, prayer.
- **`attrib.c` intrinsics** — speed, see invisible, fire/cold/shock/poison/sleep/disint resistance, telepathy, teleport(itis/control), searching, warning, etc. → **❌ none** (we have ad-hoc ring effects). **Plan (Phase 8):** an intrinsics bitset on the player, gained from corpses (eat → intrinsic), rings, and XP; flavored as "protocol upgrades you've internalized."
- **`insight.c`** (enlightenment/conduct dump) → **❌**. **Plan:** an "audit report" (`#audit`) listing your attributes, intrinsics, vows, and on-chain stats.

### B. Dungeon structure
- **`dungeon.c`, `mklev.c`, `mkroom.c`, `mkmap.c`, `mkmaze.c`, `extralev.c`, `sp_lev.c`/`nhlua.c`** — multi-branch dungeon graph, room/corridor gen, mazes, themed rooms, Lua-scripted **special levels**. → **🟡** Ascend has single-track procedural rooms (rot-js Digger) + XCM portal "branches" (parachains with difficulty/loot mults) + miniboss/boss placement. **Missing:** real branches (Mines, Sokoban, Quest, Fort, Vlad, Tower, Gehennom, Planes), mazes, themed/special hand-built levels, big room, shop/temple/zoo/morgue/beehive/barracks/throne-room special rooms. **Plan (Phase 9):** a level-definition layer (JSON, our Lua-equivalent) + a branch graph; build the Mempool Mines and the Consensus Vault (Sokoban) first.
- **`mkroom.c` special rooms** — shop, temple, throne room, zoo, morgue, beehive, barracks, swamp, leprechaun hall, anthole, cockatrice nest. → **🟡** only shops (with the Marketmaker). **Plan:** add temple (altar + Acolyte), throne room (Sudo Throne + Council guards), morgue (undead + bones), "validator barracks", "MEV swamp".
- **`fountain.c`** (fountains & sinks; quaff/dip/wish-from-water-demon/Excalibur) → **❌**. **Plan (Phase 9):** **faucets** (`{`) — `#quaff` for a random effect (heal, summon a "fountain bot", curse, gem, or — rarely — a *testnet wish*), `#dip` a weapon to draw the lawful artifact. Sinks = "burn sinks" (ring identification by dropping).
- **`dbridge.c`** drawbridges → **❌** → "consensus bridges" raised/lowered by levers; crush on close.
- **`vault.c`** vaults + guard → **❌** → **the Treasury**: a sealed 2×2 of PAS, teleport-in only, a **Council Guard** escorts you out (and confiscates if you grabbed loot you can't account for).
- **`region.c`** gas clouds / force fields / engulf regions → **🟡** (gas trap exists) → MEV gas clouds, "blacklist regions".
- **`light.c`, `vision.c`** line-of-sight + light radius + lit rooms + dark areas → **🟡** FOV exists (shadowcasting, radius 8, union FOV for co-op) but **no light sources, no lit rooms, no darkness/blindness model**. **Plan (Phase 7):** lamps/candles ("block explorers"), lit vs dark rooms, blindness (no vision), infravision/telepathy.
- **`stairs.c`, `do.c`** stairs, trapdoors, level teleport, branch stairs → **🟡** up/down stairs + portal "calls" + reorg-trap teleport. **Missing:** branch stairs, trapdoors as terrain, magic portals between branches, `#overview`.

### C. Traps — **`trap.c`**
Canonical ~25 trap types (arrow, dart, falling rock, squeaky board, bear, land mine, sleeping gas, rust, fire, pit/spiked pit, hole/trapdoor, teleport, level teleport, magic, anti-magic, polymorph, web, statue, magic portal, vibrating square, rolling boulder…). → **🟡** Ascend has 3 (gas-fee / slash / reorg-teleport). **Plan (Phase 9):** expand to a Polkadot trap table: **rug pit** (fall + lose PAS), **slashing trap** (✅), **gas-fee cloud** (✅), **reorg teleport** (✅), **fork trap** (polymorph), **honeypot web** (held in place), **front-running dart**, **anti-magic field** (drains energy), **the vibrating square** (marks the Invocation spot), **statue trap** (a frozen validator animates).

### D. Items & objects
- **`objects.c`, `o_init.c`, `objnam.c`, `mkobj.c`** — full object catalog across classes: **weapons, armor, rings, amulets, tools, food/corpses, potions, scrolls, spellbooks, wands, gems/rocks, coins, the quest/invocation/unique items**. → **🟡** Ascend has weapons, armor, rings(3), wands(4), potions(3), scrolls(6), food(2), the JAM amulet. **Missing whole classes:** amulets (variety), tools, gems/rocks, spellbooks, corpses, coins-as-objects, containers. **Plan (Phase 7):** broaden each class to ~NetHack breadth using the flavor dictionary.
- **Identification — `o_init.c`, `pager.c`** randomized appearances, formal identify, price-ID in shops, use-ID, BUC detection. → **🟡** appearance randomization for potions/scrolls + scroll/identify + altar BUC + use-learn. **Missing:** price identification (the Marketmaker quotes a tell-tale price), `#name` items/types, gem/wand/ring/amulet appearance pools, partial ID.
- **BUC + enchant + erosion — `do_wear.c`, `wield.c`, `worn.c`** blessed/uncursed/cursed, +N enchantment, erosion (rust/corrode/burn/rot), erosion-proofing, greasing, oilskin. → **🟡** BUC ✅, enchant ✅, welded cursed ✅. **Missing:** erosion/corrosion + proofing, grease, multi-slot armor (we have one armor slot — NetHack has shirt/body/cloak/helm/gloves/boots/shield). **Plan (Phase 7):** 7 armor slots; erosion from acid/rust/fire monsters; "audited" (erosion-proof) gear.
- **Containers — `pickup.c` (`#loot`)** bag of holding, bag of tricks, sacks, chests, ice box, oilskin sack. → **❌**. **Plan (Phase 7):** **multisig vault** (bag of holding, weight reduction), **chest/cold wallet** (locked, `#force` or a key), **faucet bag** (bag of tricks).
- **Charging / naming — `read.c` (charging), `do_name.c`** scroll of charging, naming items & monsters. → **❌** (wands have fixed charges). **Plan:** scroll of charging ("top-up"), `#name`.
- **Weight & encumbrance — `invent.c`, `hack.c`** carry cap from STR/CON, Burdened→Overtaxed. → **❌** (pack is a 20-slot count). **Plan (Phase 6):** weight + encumbrance tied to STR/CON.

### E. Combat & magic
- **`uhitm.c`, `mhitu.c`, `mhitm.c`, `weapon.c`** — to-hit (AC + level + DEX + weapon skill + Luck), damage by weapon/STR, multi-attacks, special attacks (drain, steal, paralyze, petrify, digest/engulf, disease, sliming, stoning, rust, seduce, were-infection…). → **🟡** Ascend: flat damage ranges, AC flat soak, status inflict (poison/confuse), ranged, thief steal, mimic. **Missing:** the real to-hit formula, weapon skills, the rich special-attack matrix. **Plan (Phase 6/10):** adopt d20-style to-hit (AC, level, DEX, skill, Luck) and a special-attack framework; add petrify (Freezer/Regulator), drain (slashing/MEV), digest/engulf (a "liquidity pool" that swallows you), paralysis (network stall), disease.
- **`dothrow.c`, `dokick.c`, `mthrowu.c`** throwing, multishot, kicking, boomerang, monster ranged volleys. → **🟡** throw (weapon/potion) ✅; **no kicking, no multishot, no monster thrown volleys (only the oracle's bolt).** **Plan (Phase 11):** `#kick` (doors, monsters, sinks, shop theft), multishot by skill, monster archers/casters that throw.
- **`do_wear.c` two-weapon, `wield.c`** two-weapon combat, wielding tools/weapons, welded. → **🟡** wield + welded. **Plan:** `#twoweapon`.
- **`spell.c`, `read.c` (spellbooks), `mcastu.c`, `minion.c`** player spellcasting (Pw/energy, fail rate by INT/skill/armor, ~40 spells across schools), spellbook study (can fail/explode), monster spellcasting (clerical + arcane). → **❌** none. **Plan (Phase 8):** **runtimes** (spellbooks) you *study* to learn **extrinsics** (spells) cast from **energy/gas** (Pw): attack ("finality bolt", "slashing", "fireball"), healing, divination ("light client" = magic mapping, detection), escape ("teleport", "XCM jump"), enchantment ("haste self"), clerical ("turn undead" = "slash the unfinalized"). Monster casters: the Censor and oracles gain a spell list.
- **`zap.c`** wand/spell beam engine: rays bounce/reflect, beam effects (striking, digging, polymorph, cancellation, death, sleep, slow, speed, undead turning, light, locking, probing, opening, secret-door detection, create monster, wishing). → **🟡** our `zapWand` is a simple traveling bolt (bolt/banish/slow/dig). **Plan (Phase 7/8):** ray engine with reflection (a "ZK mirror"/reflection amulet), the full wand list incl. **wand of wishing** (the ultimate, vanishingly rare), polymorph, cancellation ("nullify"), striking, sleep, death/"finality", probing ("read state").
- **`polyself.c`, `were.c`** polymorph self into monsters (new abilities/attacks/forms), system shock, lycanthropy. → **❌**. **Plan (Phase 8):** **fork** — poly-self into a monster form (e.g., become a whale, a dragon = "a JAM-era validator"); lycanthropy = "you've been forked" (uncontrolled were-validator transformations curable by prayer).
- **`exper.c`, `attrib.c`** life-saving (amulet), drain resistance. → **❌** (permadeath only; we have bones + on-chain record). **Plan (Phase 7):** **amulet of life saving** ("a recovery seed") — single-use death cheat.

### F. Prayer, religion, luck — **`pray.c`, `priest.c`, `sit.c`**
- Alignment record, prayer timeout, "trouble" resolution priority list, godly anger/wrath, sacrifice (corpses on altar → favor, artifacts gifted, crowning, summon minions), altar BUC/conversion, water-blessing, priests, donations. → **🟡** Ascend: prayer heals + uncurses + sometimes identifies, with a cooldown; altars reveal BUC. **Missing:** alignment record, the trouble model (prayer fixes your *worst* affliction), wrath for over-praying or sacrilege, **sacrifice/burn for favor + artifact gifts + crowning**, holy/unholy water, the Acolyte NPC, conversion. **Plan (Phase 8):** full prayer/sacrifice loop in the burn-address idiom; crowning = your Architect names you ("the Cypherpunk made Champion").
- **`attrib.c` Luck, `mkobj.c` luckstone`** Luck (−13..+13) modifies to-hit/damage/RNG; luckstone, gremlins steal Luck, Luck timeouts. → **❌**. **Plan (Phase 8):** **Fortune** stat; the **HODL stone** (luckstone); unlucky acts (breaking a "consensus mirror", killing your nominator) tank Fortune.

### G. Monsters — **`monst.c`, `makemon.c`, `mon.c`, `mondata.c`, `monmove.c`, `dog.c`, `dogmove.c`, `muse.c`, `steal.c`, `mplayer.c`, `worm.c`, `steed.c`**
- ~400 monsters across classes with attributes, resistances, attacks, speed, size, gen flags. → **🟡** Ascend has ~12 + 2 minibosses + boss + shopkeeper. **Plan (Phase 10):** grow to a few dozen across themed classes: bots/sybils (✅ swarm, tamed), validators/golems, oracles (✅ ranged), whales (✅), rug pullers (✅ thief), censor-imps, 51%-attackers, mind-flayer-equivalent, petrifiers (Freezer/Regulator), dragons ("JAM-era validators" with breath = a `zap` ray), demons/devils (Gehennom), `@` humans (mercenaries → "mercenary nodes", watchmen, soldiers), `;` sea monsters in swamps, were-validators, **monster pickup/use of items** (`muse.c` — drink, zap, throw, wear), **monster casting**, **breeding** (sybils ✅-ish), **the @ pet/steed line**.
- **`steed.c`** riding → **❌** → ride a validator steed (`#ride`).
- **`were.c`** lycanthropy → **❌** (see fork above).
- **`shk.c`, `shknam.c`** shopkeeper economy: billing, theft anger, "pay before leaving", credit, named shops, services. → **🟡** the Marketmaker guards + turns hostile on theft + direct-wallet pay. **Missing:** the *billing ledger* (carry unpaid items, pay at the door), credit, price-ID, the door-block. **Plan (Phase 9):** a bill ledger so you can browse/loot then settle in one PAS tx at the exit.
- **`priest.c`** temple priests → **❌**. **`mplayer.c`** "player monsters" in the endgame → **❌** → rival adventurers in the deep.

### H. Food, time, status — **`eat.c`, `timeout.c`, `botl.c`, `decl.c`**
- Hunger clock (Satiated→Fainting), corpses (eat for nutrition/intrinsic/poison/stun/petrify/lycanthropy/acid), tins (need a tin opener), eating conducts, choking when over-satiated, food poisoning, the timeout engine (poison, stoning, sliming, illness, sleep, withering countdowns), `botl` status line. → **🟡** Ascend: hunger clock ✅, starving damage ✅; status = poison/confuse + Psn/Cfz indicators. **Missing:** corpses & eating effects, the rich **timeout/affliction** engine (stoning, sliming, illness with countdowns you must cure), satiation/choking, status flicker. **Plan (Phase 7):** corpses drop on kill; eating yields nutrition + chance of intrinsic or affliction (rotten = "bad block"); add the timeout engine so petrify/slime/illness are *countdowns* you race to cure (prayer, potions).

### I. Detection & info — **`detect.c`, `pager.c`, `do_name.c`**
- Detect food/objects/gold/monsters/traps, magic mapping, clairvoyance, identify, `/` what-is, `;` farlook, `^` trap ID, `#overview`, discoveries list. → **🟡** scroll of magic mapping ✅, identify ✅. **Missing:** detection scrolls/potions/spells (object/monster/gold/trap detection, clairvoyance), `;` farlook, `/` whatis, discoveries (`\`). **Plan (Phase 7/8):** detection family + farlook/whatis + a discoveries screen.

### J. Commands & UI — **`cmd.c`, `iactions.c`, `apply.c`, `lock.c`, `engrave.c`, `pickup.c`, `do.c`**
NetHack's ~120 commands. Ascend has: move (8-dir/diag), `,` pickup, `i` inventory, `w/W/T` wield/wear/takeoff, `q/r/e/d` quaff/read/eat/drop, `z` zap, `t` throw, `E` engrave, `P` pray, `p` buy, `F` forge, `</>` stairs, `.` wait, `H` hall of fame, `R` restart. **Missing high-value commands:** `a`pply (tools/instruments), `#dip`, `#loot`, `#force`, `#kick`, `o`pen/`c`lose/`#unlock` doors, `s`earch (hidden doors/traps), `#sit`, `#chat`, `#offer` (sacrifice), `#pray`(have), `#ride`, `#twoweapon`, `#jump`, `#wipe`, `#name`, `Q`uiver + `f`ire, `#enhance` (skills), `^`/`;`/`/` info, `#wield`/`#monster` (special form attack), `#turn` (undead). **Plan (Phase 11):** add the interaction commands; reuse the verb/letter selection UI; mobile deck gets the new verbs.
- **`lock.c`** locked doors/chests, `#force`, picking, kicking open, the magic key/lock-pick/credit-card. → **❌** (doors are always open `+`). **Plan (Phase 9):** lockable doors + chests; pick-lock tool ("a seed-phrase skeleton key"), `#force`, kick.
- **`engrave.c`** engraving types (dust/burn/etch with wands), Elbereth, scare monster, headstones. → **🟡** dust ward ✅. **Missing:** permanent engraving (etch with a "wand of finality"), reading old engravings, the "scare monster" scroll.
- **`apply.c`** tools: instruments (music → "drum of consensus", charm, tame), whistles, magic whistle, leash (for the nominator), mirror (scare/petrify-reflect), camera (blind), pick-axe (dig), unicorn horn (cure), towel, can of grease, bullwhip, expensive camera, crystal ball (gaze), magic marker (write scrolls), tinning kit, stethoscope ("read a contract's state"), figurines, bell, candelabrum. → **❌** none. **Plan (Phase 7/11):** a tools class with the headline tools (pick-axe = dig anywhere; unicorn horn = "an auditor's horn" cures status; magic marker = "a contract deployer" writes scrolls; crystal ball = "an indexer"; leash for your nominator; stethoscope = "a state reader").

### K. Endgame — **`mkmaze.c` (invocation), `end.c`, `rip.c`**
- The Invocation: bring the **Bell of Opening**, **Candelabrum of Invocation** (7 candles), and the **Book of the Dead** to the **vibrating square** above Moloch's Sanctum; perform the ritual to open Gehennom's bottom → the Amulet → climb the Planes → Astral → #offer the Amulet on your aligned altar → **ascension**. Death (`end.c`/`rip.c`) tombstone, scoring. → **🟡** Ascend wins by grabbing the JAM at depth 8 and climbing out; bones + on-chain Hall of Fame + tombstone-ish log. **Missing the entire mid/endgame:** Gehennom, the three invocation items + ritual, the Planes, the Astral offer, the high priests, Moloch-equivalent. **Plan (Phase 12):** **the Bell of Finality + the Genesis Candelabrum + the Gray Paper (Book)** → ritual at **the vibrating square** → descend the **Dark Forest (Gehennom)** → the **Relay Planes** → **the Genesis Plane**, where you **#offer the JAM** on your Architect's altar to *truly* ascend (and mint the run as a legendary on-chain artifact).

### L. Persistence, RNG, misc — **`save.c`, `restore.c`, `bones.c`, `topten.c`, `rnd.c`/`isaac64.c`, `options.c`, `rumors.c`, `mail.c`, `music.c`, `dig.c`, `ball.c`, `steal.c`**
- Save/restore → **⤬ permadeath by design** (no save-scumming; runs are etched on-chain). Bones ✅ (on-chain). Topten ✅ (on-chain Hall of Fame). RNG: NetHack uses ISAAC64 + a seedable display RNG; Ascend uses rot-js RNG (seedable — useful for shared-seed co-op/daily runs). Options → a settings panel. Rumors/oracle hints → fortune-cookie "rumors" + Oracle consultations. Mail (`mail.c`) → ⤬ (or a fun "you've got an airdrop" gimmick). Music/instruments → "drums of consensus". `dig.c` digging (down/through; pick-axe; dig-resistant levels). `ball.c` punishment ball & chain → "a slashing ball & chain" for sacrilege. `steal.c` ✅ (rug puller).

---

## 2. Phased roadmap (post-Phase-5)

Each phase is independently shippable through the existing build → deploy → verify-live loop. Order maximizes "feels like NetHack" per unit of work.

- **Phase 6 — The character sheet.** 🟡 *v1 shipped:* six attributes (STR/DEX/CON/INT/WIS/CHA, flavored), XP/levels ("epochs", max-HP growth on level-up), a **d20 to-hit layer** (level + DEX + enchant vs dodge; STR adds melee damage; misses now happen), a **character sheet** (`@`), and four **archetypes** (Validator, Nominator, Cypherpunk, Builder) with distinct stats + starting kits, pickable in the top bar. *Still to do:* weight + encumbrance, attribute gain/loss & exercise, AC→NetHack evasion model, more archetypes/races.
- **Phase 7 — Items, deep.** 🟡 *7a + 7b shipped.* **7a:** **corpses** drop on kill (eat in place with `e`) → nutrition + **intrinsics** (poison resistance, intrinsic speed) or danger; the **affliction/timeout engine** — a **freezer** (cockatrice) corpse starts **stoning** (`Ston`, deadly countdown), rotten corpses cause **illness** (`Ill`), both cured by prayer/cleanse. **7b:** **seven armor slots** (shirt/body/cloak/helm/gloves/boots/shield — wear one of each); **AC is now evasion** (NetHack-faithful: armor makes you harder to hit, feeding the d20 layer — no more flat soak); **erosion** — a rust bug's touch corrodes worn pieces (rusty→badly corroded), cutting their AC, repaired by prayer and rust-**proofed** ("audited") by a blessed scroll of formal verification; `T` now picks which worn piece to remove. **7d:** the **ray/zap engine** — a **wand of immolation** fires a **bouncing fire ray** that sears every monster (and *you*, if it caroms back off a wall) in its path; plus a wider wand list: **stasis** (sleep a foe), **forking** (polymorph a monster into a random other one), **nullification** (cancel a foe's special powers — splits/steal/ranged/poison/corrode), and **state-read** (probe HP + traits). *Still to do (7c/7e):* tools (pick-axe, unicorn-horn, magic marker, leash, crystal ball, lamp); containers (multisig vault, chest); light/darkness/blindness; detection family; amulets (life-saving, reflection); more wands (wishing, death, striking).
- **Phase 8 — Magic & faith.** Energy/Pw; spellbooks ("runtimes") + ~20 spells across schools; intrinsics/resistances; polymorph ("fork") + lycanthropy; the full prayer/sacrifice/luck/alignment model (burn-address sacrifice, crowning, Fortune, the HODL stone).
- **Phase 9 — The dungeon, branched.** A level-definition layer + branch graph; build **the Mempool Mines** and **the Consensus Vault (Sokoban)**; faucets/sinks/thrones/temples/vaults; lockable doors + chests; expanded trap table; the shop **bill ledger**.
- **Phase 10 — The bestiary.** Grow to dozens of monsters across classes; monster item-use (`muse`) + casting + breeding; petrifiers, dragons (breath = ray), demons; mercenary/watch `@`-folk; riding/steeds; priests/guards.
- **Phase 11 — The verb set.** `apply`, `#dip`, `#loot`, `#force`, `#kick`, door open/close/lock/search, `#sit`, `#chat`, `#offer`, `#ride`, `#twoweapon`, `Quiver`+`fire`, `#enhance` (weapon skills), `;`/`/`/`^` info, `#name`, discoveries screen.
- **Phase 12 — The true endgame.** The three invocation relics + the ritual at the vibrating square; **the Dark Forest (Gehennom)**; **the Relay Planes**; **the Genesis Plane** + #offer-the-JAM ascension; the Censor's resurrection/hunt; legendary on-chain artifact minted on a real win.
- **Phase 13 — Quests, conducts, polish.** Per-archetype **Quests** (homeland portal, nemesis, your artifact); **vows** (conducts) tracked and shown on the tombstone/Hall of Fame; rumors/Oracle consultations; options panel; daily seeded run (leveraging seedable RNG + on-chain leaderboard).

---

## 3. Intentionally adapted or cut (⤬)

- **Save/restore** — permadeath is the point; on-chain run records + bones replace save files. No save-scumming.
- **The full 13 roles / 5 races at once** — we phase in archetypes; not all of NetHack's classes ship day one.
- **Exact RNG / ISAAC64 parity** — rot-js RNG is fine; we *gain* seedable shared-seed/daily runs.
- **Terminal-specific UI** (`windows.c`, `options.c`, tty/curses/Qt ports, colors symbols sets) — we have one canvas renderer + a mobile deck; options become a small settings panel.
- **`mail.c`** real mail daemon — at most a cosmetic "airdrop incoming" gag.
- **dlb/file/config plumbing** (`dlb.c`, `files.c`, `cfgfiles.c`, `sys.c`, `mdlib.c`, `utf8map.c`, build tooling) — N/A to a browser TS build.
- **Wizard/debug mode & wizcmds** (`wizard.c`, `wizcmds.c`) — optional dev-only cheats; low priority.
- **Gehennom's full ~25–50 maze levels** — we compress the Dark Forest to a tense handful rather than a slog.

---

## 4. Where Ascend already *exceeds* NetHack (keep leaning in)

- **On-chain economy** — PAS is a real testnet asset; shops are real wallet transactions.
- **Tradeable NFT relics** — `forge` mints artifacts as ERC-721s with on-chain rarity rolls; they persist across runs and trade on any marketplace. (NetHack artifacts are local save state.)
- **On-chain Hall of Fame + bones** — your deaths seed *other players'* dungeons, permanently, trustlessly.
- **Live P2P co-op** — two adventurers in one host-authoritative dungeon (NetHack is single-player). Friendly-fire and race modes have no NetHack analog.
- **Mobile** — a touch control deck; NetHack is keyboard-bound.

Keep every new NetHack subsystem wired to this spine: if it touches value, make it on-chain; if it's an artifact, make it a tradeable relic; if it's a milestone, etch it in the Hall of Fame.
