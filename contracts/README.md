# Ascend contracts — Paseo Asset Hub

Three contracts, all optional to the game. With none deployed, `hasContracts()` is false and every
chain feature silently switches off; the game plays exactly as it does offline.

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

## Deployed — Paseo Asset Hub

| Contract | Address |
|---|---|
| `AscendRuns` | `0xB222B8a4fb0B91e16E323ba80b2dB184eda9eF2C` |
| `AscendRelics` | `0xB20D49AEb55276BE6acF2D1BD6b77dE84B220A79` |
| `AscendInvites` | `0x9EF9A4676A8B8Ad4B39EA052031C7ffa6031eeD6` |

Wired into `src/chain/config.ts`. All three were exercised after deployment — a run submitted and
read back off the leaderboard, a relic forged and its on-chain `tokenURI` decoded, and an invite
key published and read back. Gas is negligible (13k–33k per write).

> The leaderboard holds one smoke-test entry — *"the Verifier"*, ascended at depth 48 — and relic
> #1 is the matching test mint. Harmless, and proof the path works end to end; redeploy if you
> want a clean slate.

## Build

Two compilers, and the difference matters:

```bash
npm run contracts:build     # solc   -> contracts/out/*.abi.json + *.bin   (typecheck + ABIs)
npm run contracts:revive    # resolc -> contracts/out/*.polkavm.json       (the deploy artifact)
```

Asset Hub runs PolkaVM via `pallet-revive`, which executes **`resolc`** output. Stock `solc` EVM
bytecode **will not deploy**; `contracts:build` exists only to typecheck sources fast and to print
the real ABI for diffing against `src/chain/contracts.ts`. PolkaVM blobs are much larger than the
EVM equivalent (22–56 kB here versus 4–8 kB), which is normal.

## Deploy

```bash
npm run contracts:key       # generate a deployer into .env (chmod 600, gitignored)
                            # -> prints the address; fund it from the faucet
npm run contracts:revive    # compile to PolkaVM
npm run contracts:deploy    # deploy, and write the addresses back into .env
```

`contracts:deploy` skips anything already recorded in `.env`; pass `--force` to redeploy, or
`--only=AscendRuns` for one contract. Faucet: <https://faucet.polkadot.io/paseo?parachain=1000>.

This deploys over Asset Hub's Ethereum JSON-RPC, so ethers drives it like any EVM chain — the only
difference is the bytecode. No account mapping was needed: an Ethereum-native key works directly.

### The `cdm` alternative

`cdm deploy` also publishes the ABI to the Bulletin chain and registers the contract in the on-chain
ContractRegistry. Worth doing if you want contracts discoverable by name, but note the registry is
**append-only and first-come** — a name cannot be renamed, reassigned or deleted once claimed. The
plain deployment above avoids burning `@ascend/*` names before the design has settled.

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
