# Deploying Ascend

Ascend ships to two places. **Bulletin is canonical; GitHub Pages is a mirror** kept because
Bulletin content is immutable per CID and expires unless renewed — an escape hatch is worth having.

| Target | URL | Built by |
|---|---|---|
| Bulletin chain (canonical) | `https://ascendyendor00.dot.li`, or `ascendyendor00.dot` in the Polkadot app | `npm run build:bulletin` (base `/`) |
| GitHub Pages (mirror) | `https://<user>.github.io/ascend/` | `npm run build:pages` (base `/ascend/`) |

The two differ only in base path, which is why there are two build scripts.

## The thing that will bite you

**Bulletin storage expires.** The chain retains data for a configurable period — **~14 days by
default** — and automatically cleans it up when it expires without renewal. Publishing is not
fire-and-forget: with no periodic re-deploy, the game goes dark about a fortnight after the last
push. `.github/workflows/deploy-bulletin.yml` therefore runs **weekly on a cron** as well as on
push. Uploads are incremental, so a no-op renewal is cheap.

If you disable that schedule, you own the consequence.

## One-time setup

Requires **Node ≥ 22** (the deploy CLI enforces it).

```bash
npm install -g @polkadot-community-foundation/polkadot-app-deploy
```

1. **Fund an account** on Paseo Asset Hub — <https://faucet.polkadot.io/paseo?parachain=1000>
2. **Sign in** (optional on this devnet; no mnemonic on disk):
   ```bash
   npx pad login     # scan the QR with the Polkadot app
   npx pad whoami
   ```
   Without a session the CLI falls back to a local worker account, which is enough for the devnet.
3. **Storage authorization.** Writing to Bulletin needs a granted quota — reading never does. A raw
   `not authorized` chain error on a first deploy is almost always this.

### Why the name looks like that

**`ascend.dot` is not available to us.** Short `.dot` labels are gated on proof of personhood:

> `ascend.dot requires ProofOfPersonhoodFull, but this signer is NoStatus`

A signer with no personhood status can only register a label whose base is **≥ 9 characters with
exactly two trailing digits** — hence `ascendyendor00.dot`. The alternatives are to sign in with a
personhood-proven Polkadot app account (`npx pad login`), or to request a whitelist at
<https://github.com/paritytech/dotns/>. Either would free up the short name; the registration below
is permanent and first-come, so switching later means a new name, not a rename.

## Deployed

| | |
|---|---|
| Domain | `ascendyendor00.dot` (+ subname `app.ascendyendor00.dot`) |
| Gateway | <https://ascendyendor00.dot.li> |
| Content CID (root) | `bafybeibpx6m2dfpolbxdtwsos5lvqpnzqpoium2geb6cnoex6sw7eibggq` |
| Content CID (`app.` subname) | `bafybeibb2nim7jae6z52r5iky6jvf6fkjobal6dlrpt2uu3fp6wnwxmuka` |
| Icon CID | `bafk2bzacebryaxhhaftvjebpzpnwb2rn562rz3ec57hf7tknpqaophso5fmha` |

Manifest and executable text records are written on chain and verified independently against the
DotNS content resolver (`0x326bdE29315199c814B1c58b431D84D16EA5cE41`), not merely trusted from the
deploy tool's output.

The root and the `app.` subname point at **different CIDs**. Both are valid uploads of byte-identical
files — a redeploy re-embeds the manifest, which changes the root hash even when nothing else moved.
The gateway resolves the root; the Polkadot app resolves `app.`. Both work.

Redeploys are incremental: the second deploy uploaded 0.0 MB across 2 chunks instead of 5.1 MB.

## Everything else is gated on proof of personhood

Three separate things are refused without it, and they all fail differently, so it is worth naming
them together:

| Want | Error | Needs |
|---|---|---|
| the short name `ascend.dot` | `requires ProofOfPersonhoodFull, but this signer is NoStatus` | PoP Full |
| listing in the app's **Browse** | `Publisher.publish reverted: NoPersonhood` | PoP |
| the statement-store invite rail | no statement allowance | a personhood alias |

**Personhood cannot be obtained outside the Polkadot app.** Its docs say only that *"A user
completes PoP once (in the Polkadot App)"*, and the TestNet guide states plainly that *"The process
for obtaining a Statement Store allowance on TestNet is not yet documented."*

The app **is** available now: **Android on Google Play** (`io.pcf.polkadotapp`), iOS "coming soon",
and Polkadot Web at `dot.li`. Once an account there has PoP:

```bash
npx pad login                 # scan the QR with the app
npx pad whoami
npm run deploy:bulletin -- --publish     # now succeeds
npx pad transfer ascendyendor00.dot      # hand the name to that account
```

### The name is currently owned by a public dev account

`ascendyendor00.dot` is owned by `5DfhGyQdFobKM8NsWvEeAKk5EQQgYe9AydgJ7rMB6E1EqRzV` — the **base
account of the well-known Substrate dev phrase**, which the deploy CLI falls back to when no session
exists. That phrase is public, so on this devnet the name is not meaningfully *ours*: anyone can
re-point or transfer it. Fine for a testnet; transfer it to a real account before it matters.

### What "badge" is, and is not

`badge` in this toolchain is a field on the **environment** descriptor (a UI label like "testnet"),
not app metadata — there is nothing for an app to set. What Browse would show comes from the
`manifest` text record (display name, description, icon CID), and that **is** set and verified. The
only thing missing for Browse is the Publisher listing, which is personhood-gated.

**First load through the gateway is slow.** It resolves DotNS with a smoldot light client, which
syncs the Paseo relay chain before it will answer — minutes from cold. The loader offers
*"Use Trusted Provider"* to skip verification and resolve immediately. Nothing is wrong when it
sits at a low percentage; it is syncing.

## Deploy

```bash
npm run deploy:bulletin
```

which is `build:bulletin` followed by:

```bash
polkadot-app-deploy ./dist ascendyendor00.dot --env devnet --js-merkle
```

`--js-merkle` does content addressing in pure JavaScript, so no IPFS Kubo binary is needed.

Settings live in `polkadot-app-deploy.config.ts` (domain, display name, description, icon). The
icon must be **PNG or JPEG** — the manifest schema rejects SVG, which is why `public/icon-512.png`
is generated next to `public/icon.svg`.

Environments are presets; the default is `paseo-next-v2`. `--list-environments` prints them.

## CI

| Workflow | Trigger | Does |
|---|---|---|
| `deploy-pages.yml` | push to `main` | test → build → publish the Pages mirror |
| `deploy-bulletin.yml` | push to `main`, **weekly cron**, manual | test → build → upload to Bulletin, update DotNS |

The Bulletin job needs repository secret **`BULLETIN_MNEMONIC`** (the DotNS owner account). Without
it the job **skips rather than fails**, so forks and pull requests stay green.

## Contracts

Deployed separately and independently — see [`contracts/README.md`](contracts/README.md). The game
runs fine with no contracts deployed: every chain feature switches itself off.

## Sanity check before shipping

The one property worth protecting is that **the game is complete without any of this**. Before a
release, load the built bundle with the wallet extension disabled and the network offline, then:
start a run, die, restart, open the Hall of Fame (`H`), and host a paste-signalled co-op game.
All of it must behave exactly as it does today.
