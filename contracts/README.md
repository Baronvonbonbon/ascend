# Ascend contracts — Paseo Asset Hub

Two contracts, both optional to the game. If neither is deployed, `hasContracts()` is false and
every chain feature silently switches off; the game plays exactly as it does offline.

| Contract | Purpose |
|---|---|
| `AscendRuns.sol` | Ascension leaderboard + the ring of the recently fallen that seeds other players' bones |
| `AscendRelics.sol` | ERC-721 relics struck at the in-game forge (`F`), with on-chain `data:` metadata |
| `AscendInvites.sol` | Co-op rendezvous — replaces copy/pasting WebRTC handshake codes with a 1-click invite |

### Why there is an invite contract *and* a statement-store rail

The Polkadot app signals its own calls over the **People chain statement store** — *"the call
offer, answer, and connection candidates as encrypted chat messages over the statement-store
channel."* That is the right rail, and `src/net/signal-statement.ts` uses it. It is free, it is
push-delivered, and statements *"never enter block storage"* — so signalling leaves no permanent
record at all, which is strictly better than encrypting something that lives forever.

But it cannot be the only rail. Publishing a statement requires a statement allowance, and
claiming one requires a personhood alias:

> `resources.setStatementStoreAccount` — *"The origin must be `Origin::StmtStoreAlias`, produced by
> the `AsResources` (`RegisterStatementStoreAllowance(..)`) transaction extension **after proof
> validation**."*

Inside the Polkadot app the host has already onboarded the player. In a plain browser nobody has,
and `peopleLite.attest` needs an authority with attestation allowance — you cannot self-onboard.
(This is live and in use: 131 statement allowances and 146 lite people on Paseo People.)

So `AscendInvites` remains the rail for everyone outside the app. It is also the only **mailbox**:
statements default to a 30-second TTL with 1024 bytes live per account, so they only reach someone
who has the lobby open *right now*, whereas a contract invite waits an hour for a player who is
offline. `src/net/signal.ts` picks whichever is available; copy/paste codes remain for players with
no wallet at all.

Only the WebRTC handshake (a deflate-compressed SDP blob, a couple of KB) goes through it. Moves,
world state and chat all stay on the direct peer link, exactly as before.

**Payloads are sealed end-to-end**, and this is not optional. An SDP offer contains ICE candidates,
which include your **public IP**, and an invite is a transaction signed by your account. A plaintext
payload would therefore write *"this address had this IP at this time"* into block history
permanently — readable by anyone, and impossible to withdraw, since clearing contract storage does
not clear calldata or events. That is a deanonymisation vector and strictly worse than the
copy/paste flow it replaces, where your IP went only to the person you handed the code to.

So each player publishes a P-256 ECDH public key once (`publishInviteKey`), and senders seal the
SDP to it — ECIES over WebCrypto, HKDF-SHA256 into AES-256-GCM, scheme in `src/chain/crypto.ts`.
The chain sees ciphertext. **The client refuses to send to an address with no published key** rather
than silently falling back to plaintext; a quiet downgrade would defeat the entire point. The
contract cannot enforce that — it treats payloads as opaque bytes — so the refusal lives in
`sendInvite()`, and `src/chain/crypto.test.ts` pins the properties it depends on.

What is still public: your address, the recipient's address, and the fact and timing of an invite.
Only the handshake contents are hidden.

The long-term key is generated locally and is **not** derived from your wallet key, so compromising
one does not expose the other. It lives in `localStorage`; losing it means republishing (one cheap
transaction), and any in-flight invite becomes undecryptable — harmless, since invites expire after
an hour and either party can clear one.

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
