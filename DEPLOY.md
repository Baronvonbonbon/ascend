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
| Content CID (root) | `bafybeiaigqh3etqlgscahujhqyeuoeonfs7nndx3pwxgf2gcx4skpdz5ye` |
| Content CID (`app.` subname) | `bafybeigxpspm3qkjbnbvwe6rolpwqvooasbliu4e6bkn6wir7oqi7a5v6a` |
| Icon CID | `bafk2bzacebryaxhhaftvjebpzpnwb2rn562rz3ec57hf7tknpqaophso5fmha` |

Manifest and executable text records are written on chain and verified independently against the
DotNS content resolver (`0x326bdE29315199c814B1c58b431D84D16EA5cE41`), not merely trusted from the
deploy tool's output.

The root and the `app.` subname **may or may not carry the same CID**, and both states are correct.
A redeploy re-embeds the manifest, so the root hash can move even when no source file did; whether
the two end up equal depends on what that pass rewrote. They matched on the deploy recorded above
and differed on the one before it. The gateway resolves the root; the Polkadot app resolves `app.`.
Both work either way — do not treat a mismatch as a failed deploy.

**Verify the CID from the chain, not from the deploy log.** Read `contenthash(namehash(name))` off
the DotNS content resolver (`0x326bdE29315199c814B1c58b431D84D16EA5cE41`) over the Asset Hub RPC and
compare it to the CID the tool printed. The record is an ENS-style contenthash, so it comes back as
`0x` + `e3` (ipfs) + the CID bytes — a base32 CIDv1 decodes to exactly the tail after `e3`.

Redeploys are incremental — a no-op republish uploads 0.0 MB across 2 chunks instead of 5.1 MB —
and always re-point the SAME name, so the URL never changes.

**A redeploy can look like it did not take.** The PWA service worker precaches the app, so a
browser that has loaded the site before will serve the previous build until the worker updates.
`registerType: "autoUpdate"` picks it up on the next load; a hard reload forces it. This wasted
real debugging time once — the fix was live and the cache was lying.

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
npx pad login                 # scan the QR with the app; `pad` is a devDependency, so run it
npx pad whoami                # from the repo — from $HOME npx resolves an unrelated `pad` package
npm run deploy:bulletin -- --publish            # now succeeds
npx pad transfer ascendyendor00.dot --env devnet # hand the name to that account
```

`--env devnet` is not optional: the CLI defaults to `paseo-next-v2` and this name lives on devnet.
`transfer` signs with the built-in dev phrase unless given `--mnemonic`, and sends to the signed-in
session unless given `--to` — so from a logged-in shell it needs no other arguments. Read the
consequences below before running it.

### Who owns what, and why the two halves disagree

Read from the DotNS registry (`0x527b08a640b527a3dae0C4BE04D7344E430B6E50`, `owner(namehash(name))`),
not from the deploy log:

| Name | Owner | |
|---|---|---|
| `ascendyendor00.dot` | `0xff54a5a1fdac91bb4f2b4fbf4bfff37cdbea333f` | the personhood-proven app account (`5DoMJAZMGSJfTpC2hV4irP9G4R1iSoJvKq1xriPa984TLT43`) |
| `app.ascendyendor00.dot` | `0x35cdb23ff7fc86e8dccd577ca309bfea9c978d20` | still the public dev-phrase account |

`pad transfer` moves the registrar token for a 2LD label and **nothing beneath it**. Subnames are
registry nodes, not registrar tokens, so `app.` stayed where it was. Both halves still resolve to the
current CID, so nothing is visibly broken — but no single signer can now complete a full publish:

- the **root manifest** text record needs the root owner (the app account);
- the **`app.` contenthash + executable** records need the subname owner (the dev account).

**A deploy in this state aborts.** The manifest-publish step checks subname ownership and throws
`Subname app.ascendyendor00.dot is owned by 0x35cd…, not the publisher. Aborting.` rather than
reclaiming it — it only calls `setSubnodeOwner` when the subname has **no** owner at all. Deploying
without the config file found (so the manifest step never runs) updates the root contenthash only,
and leaves whatever the Polkadot app resolves to go stale.

Getting back to one signer means either transferring the root back, or reclaiming `app.` with a
one-off `setSubnodeOwner` from the parent owner — the registry allows it, the CLI never asks for it.
Note that transferring the root back needs the *current* owner's signature, so it depends on the
phone channel working too — the split cannot be undone from the dev key alone.

#### Deploying each half separately, which is how the split is worked around

Until the two are reunited, one publish cannot cover both — but two can, because the deploy path
handles a subname target on its own and never touches the parent:

```bash
npm run build:bulletin

# 1. the app. subname — the dev key still owns it, so this needs no phone at all
npx pad ./dist app.ascendyendor00.dot --env devnet --js-merkle

# 2. the root — signed from the phone. NOTE the build dir is copied OUTSIDE the repo
cp -r dist /tmp/ascend-deploy/dist
npx pad /tmp/ascend-deploy/dist ascendyendor00.dot --env devnet --js-merkle \
  --no-transfer-to-signedin-user
```

The copy is the load-bearing part of step 2. `--config` walks up from the build directory, and when
it finds `polkadot-app-deploy.config.ts` it runs the manifest step — the step that aborts on the
subname mismatch. From a directory with no config above it, the deploy sets the root contenthash and
stops, which is all the root needs.

The two halves end up on **different CIDs from one identical build**, and that is correct: the root
re-embeds the manifest and the subname does not.

### The phone signature will time out silently if the app is not open

`Mobile signing rejected: createTransaction timed out — queue freed`, then
`setContenthash timed out after 300000ms`. Nothing reaches the phone; the request sits in a queue
and expires. The Bulletin upload has already succeeded by then, so only the DotNS write is lost.

**`pad whoami` is not evidence the channel works.** It reads the session file under
`~/.polkadot-apps/` and never contacts the app, so it reports a logged-in identity just the same.
Open the Polkadot app and leave it in the foreground *before* deploying. If it still times out, the
session itself is stale — `npx pad logout && npx pad login` and scan again.

The CLI gates each signature behind an interactive `Press Y when ready`, which makes a non-TTY shell
abort with `aborted by user`. Piping `yes` into it is safe: the gate resolves **before** the request
is pushed to the phone (it exists to make sure you are holding it), so auto-confirming does not race
the approval. The approval wait itself is unbounded and deliberately outside every timeout.

Each retry re-embeds the manifest with a fresh nonce, so failed attempts leave unreferenced root CIDs
uploaded to Bulletin. Harmless — nothing resolves to them and they expire with the retention window.

### Ownership and the weekly renewal are in direct conflict

This is the constraint to design around, not a bug to fix:

| | needs |
|---|---|
| the weekly cron renewal | a signer whose **mnemonic** can live in `BULLETIN_MNEMONIC` |
| Browse listing (`--publish`), the short name | a signer with **personhood**, which exists only inside the Polkadot app |

A phone-held personhood account has no mnemonic to give CI. And CI cannot simply skip the DotNS
phase: the deploy path calls `checkOwnership(name)` and, when the signer does not own the name,
tries to **register** it — which reverts on a name that already exists. There is no upload-only
flag (`--publish`/`--unpublish` are the only DotNS toggles), so the whole job fails.

Two details make this less bad than it sounds, both verified:

- **The build is byte-for-byte deterministic.** Building twice from the same commit produced an
  identical `dist/` tree hash, so an unchanged source really does yield an unchanged CID.
- **An unchanged CID writes no transaction** — the tool logs `Contenthash already set: … skipping tx`.

So a renewal is *almost* signature-free; what blocks it is purely the ownership pre-check, not the
work it would do. Whoever holds the name must hold it as a mnemonic if the cron is to run unattended.
The honest fix is a **dedicated deploy account** — a fresh keypair whose mnemonic goes in
`BULLETIN_MNEMONIC` and which holds the name. That is strictly better than today's public dev phrase
(the name becomes genuinely ours) and keeps renewal alive; the cost is that Browse listing, which
wants personhood on the signer, stays out of reach for that name.

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
