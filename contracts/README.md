# Ascend contracts — Paseo Asset Hub

Two contracts, both optional to the game. If neither is deployed, `hasContracts()` is false and
every chain feature silently switches off; the game plays exactly as it does offline.

| Contract | Purpose |
|---|---|
| `AscendRuns.sol` | Ascension leaderboard + the ring of the recently fallen that seeds other players' bones |
| `AscendRelics.sol` | ERC-721 relics struck at the in-game forge (`F`), with on-chain `data:` metadata |
| `AscendInvites.sol` | Co-op rendezvous — replaces copy/pasting WebRTC handshake codes with a 1-click invite |

### Why there is an invite contract

The intent was to use the Polkadot app's contact messaging for co-op invites, but that messaging
API **is not documented for third-party apps**. `AscendInvites` does the same job with primitives
that are documented: address-addressed storage anyone can read. You invite an address, it appears
in their inbox, they accept — one click each.

Only the WebRTC handshake (a deflate-compressed SDP blob, a couple of KB) goes through it. Moves,
world state and chat all stay on the direct peer link, exactly as before. **SDP is public**, and it
contains candidate IP addresses — true of the copy/paste flow too, but there it was visible only to
whoever you handed the code to. The lobby says so plainly. Invites expire after an hour and either
party can clear one.

## Two constraints that shaped these

**Reads must never scan logs.** Players may connect through Pine-RPC, a smoldot light client with
no historical state — its `eth_getLogs` only serves a window collected since that client connected.
A leaderboard rebuilt from events would be empty for every new player. So `leaderboard()` and
`recentBones()` return **bounded arrays from storage** in a single `eth_call` at `latest`. Events
are emitted as well, but purely so a real indexer can be added later; nothing reads them today.

**NFT metadata is not on the Bulletin chain.** Bulletin storage expires (~14 days by default)
unless renewed. `tokenURI` therefore composes JSON + SVG **on chain** and returns a `data:` URI.
Relics are a glyph, a name and a few numbers, so this is cheap and it is permanent.

## Build

```bash
npm run contracts:build     # solc -> contracts/out/*.abi.json + *.bin
```

This uses stock `solc`, which is enough to typecheck the sources and produce ABIs for diffing
against `src/chain/contracts.ts`. **It is not the deploy artifact.** Asset Hub runs PolkaVM via
`pallet-revive`, which needs `resolc` output, not solc's EVM bytecode.

## Deploy

Deployment goes through the Community Foundation's `cdm` CLI, which builds with `resolc`, publishes
the ABI to the Bulletin chain, deploys to Asset Hub, and registers the contract in the on-chain
ContractRegistry — atomically.

```bash
npm i -g @polkadot-community-foundation/cdm-cli    # needs Node 22+
cdm setup
cdm account map                                    # map your account for pallet-revive
# fund it first: https://faucet.polkadot.io/paseo?parachain=1000
cdm deploy --env devnet
```

Register them as `@ascend/runs` and `@ascend/relics`. **The CDM registry is append-only and
first-come**: a name cannot be renamed, reassigned or deleted once claimed, so claim deliberately.

## Wire the addresses in

Either bake them into `src/chain/config.ts`:

```ts
export const CONTRACTS = { runs: "0x…", relics: "0x…", invites: "0x…" };
```

…or set them at runtime without a rebuild, which is what the localStorage overrides exist for:

```js
localStorage.setItem("ascend.chain.runs",    "0x…");
localStorage.setItem("ascend.chain.relics",  "0x…");
localStorage.setItem("ascend.chain.invites", "0x…");
```

Each is independent: deploy only `AscendInvites` and you get 1-click co-op with no leaderboard;
deploy none and every chain feature switches itself off.

## If you change a signature

`src/chain/contracts.ts` holds the ABI in ethers' human-readable form. It is not generated — run
`npm run contracts:build` and diff `contracts/out/*.abi.json` against it.

## Trust model

Runs are **self-reported and signed by the player**. Anyone can forge a submission; the cost is
gas. This is a deliberate, stated trade-off: it needs no backend, which is what lets the whole game
ship as a static bundle on the Bulletin chain.

Each run stores its `seed` and a `runHash` (keccak of the input log). The game is deterministic
from a seed, so a verifier can replay a submitted run off-chain and confirm the claimed result —
that can be added later, and marked on the leaderboard, **without a storage migration**.
