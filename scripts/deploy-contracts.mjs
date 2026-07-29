// Deploy the Ascend contracts to Paseo Asset Hub (pallet-revive / PolkaVM).
//
//   npm run contracts:revive     # compile to PolkaVM first
//   npm run contracts:deploy
//
// Reads DEPLOYER_PRIVATE_KEY from .env (gitignored, testnet only). Deployment goes over the
// Ethereum JSON-RPC that Asset Hub exposes, so ethers drives it exactly as it would any EVM chain
// — the only difference is the bytecode, which must be resolc output, not solc's.
//
// Idempotent-ish: pass --only=AscendRuns to deploy a single contract, and already-deployed
// addresses in .env are reported rather than redeployed unless --force is given.

import { JsonRpcProvider, Wallet, ContractFactory, formatEther } from "ethers";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const RPC = process.env.ASCEND_RPC ?? "https://paseo-assethub-rpc.laissez-faire.trade";
const CHAIN_ID = 420420417;
const OUT = "contracts/out";
const ORDER = ["AscendRuns", "AscendRelics", "AscendInvites"];
const ENV_KEY = { AscendRuns: "RUNS_ADDRESS", AscendRelics: "RELICS_ADDRESS", AscendInvites: "INVITES_ADDRESS" };

const args = process.argv.slice(2);
const only = args.find((a) => a.startsWith("--only="))?.split("=")[1];
const force = args.includes("--force");

// ── env ─────────────────────────────────────────────────────────────────────
function readEnv() {
  if (!existsSync(".env")) return {};
  return Object.fromEntries(
    readFileSync(".env", "utf8").split("\n")
      .filter((l) => l.trim() && !l.trim().startsWith("#") && l.includes("="))
      .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
  );
}

function writeEnvVar(key, value) {
  let env = existsSync(".env") ? readFileSync(".env", "utf8") : "";
  const line = `${key}=${value}`;
  env = new RegExp(`^${key}=.*$`, "m").test(env)
    ? env.replace(new RegExp(`^${key}=.*$`, "m"), line)
    : env + (env.endsWith("\n") || !env ? "" : "\n") + line + "\n";
  writeFileSync(".env", env, { mode: 0o600 });
}

const env = readEnv();
const pk = env.DEPLOYER_PRIVATE_KEY;
if (!pk) {
  console.error("No DEPLOYER_PRIVATE_KEY in .env. Run: npm run contracts:key");
  process.exit(1);
}

// ── connect ─────────────────────────────────────────────────────────────────
const provider = new JsonRpcProvider(RPC, CHAIN_ID, { staticNetwork: true });
const wallet = new Wallet(pk, provider);

console.log(`rpc      ${RPC}`);
console.log(`deployer ${wallet.address}`);

const balance = await provider.getBalance(wallet.address);
console.log(`balance  ${formatEther(balance)} PAS`);
if (balance === 0n) {
  console.error(`\nThe deployer has no funds. Send PAS to ${wallet.address} on Paseo Asset Hub:`);
  console.error("  https://faucet.polkadot.io/paseo?parachain=1000");
  process.exit(1);
}

// ── deploy ──────────────────────────────────────────────────────────────────
const deployed = {};
for (const name of ORDER) {
  if (only && name !== only) continue;

  const existing = env[ENV_KEY[name]];
  if (existing && !force) {
    console.log(`\n${name}: already at ${existing} (use --force to redeploy)`);
    deployed[name] = existing;
    continue;
  }

  const artifactPath = join(OUT, `${name}.polkavm.json`);
  if (!existsSync(artifactPath)) {
    console.error(`\n${name}: missing ${artifactPath} — run: npm run contracts:revive`);
    process.exit(1);
  }
  const { abi, bytecode } = JSON.parse(readFileSync(artifactPath, "utf8"));

  console.log(`\n${name}: deploying (${bytecode.length / 2} bytes)…`);
  const factory = new ContractFactory(abi, bytecode.startsWith("0x") ? bytecode : `0x${bytecode}`, wallet);
  try {
    const contract = await factory.deploy();
    console.log(`  tx ${contract.deploymentTransaction()?.hash}`);
    await contract.waitForDeployment();
    const address = await contract.getAddress();
    console.log(`  -> ${address}`);
    writeEnvVar(ENV_KEY[name], address);
    deployed[name] = address;
  } catch (e) {
    console.error(`  FAILED: ${e.shortMessage ?? e.message}`);
    if (e.info?.error) console.error(`  detail: ${JSON.stringify(e.info.error)}`);
    process.exit(1);
  }
}

// ── report ──────────────────────────────────────────────────────────────────
console.log("\n─── deployed ───");
for (const [name, addr] of Object.entries(deployed)) console.log(`${name.padEnd(14)} ${addr}`);
console.log(`
Wire them into the game by editing src/chain/config.ts:

  export const CONTRACTS = {
    runs:    "${deployed.AscendRuns ?? ""}",
    relics:  "${deployed.AscendRelics ?? ""}",
    invites: "${deployed.AscendInvites ?? ""}",
  };

…or without a rebuild, in the browser console:

  localStorage.setItem("ascend.chain.runs",    "${deployed.AscendRuns ?? ""}");
  localStorage.setItem("ascend.chain.relics",  "${deployed.AscendRelics ?? ""}");
  localStorage.setItem("ascend.chain.invites", "${deployed.AscendInvites ?? ""}");
`);
