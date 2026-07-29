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
| Content CID | `bafybeibb2nim7jae6z52r5iky6jvf6fkjobal6dlrpt2uu3fp6wnwxmuka` |
| Icon CID | `bafk2bzacebryaxhhaftvjebpzpnwb2rn562rz3ec57hf7tknpqaophso5fmha` |

Manifest and executable text records are written on chain and verified.

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
