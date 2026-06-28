// Deploy AscendDeed (soulbound proof-of-ascension NFT) to Paseo.
//   node scripts/compile.mjs        # builds artifacts/AscendDeed.json
//   node scripts/deploy-deed.mjs    # deploys it (raw provider; Paseo receipts are flaky)
// Then paste the printed address into src/chain/config.ts (CHAIN.ascendDeed).
// Key: DEPLOYER_PRIVATE_KEY (reuses the Datum deployer's .env by default).
import { JsonRpcProvider, Wallet, ContractFactory, getCreateAddress, formatEther } from "ethers";
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const RPC = "https://eth-rpc-testnet.polkadot.io/";
const KEY_ENV = process.env.DEPLOYER_ENV || "/home/k/Documents/datum/alpha-core/.env";
function loadKey() {
  if (process.env.DEPLOYER_PRIVATE_KEY) return process.env.DEPLOYER_PRIVATE_KEY;
  if (existsSync(KEY_ENV)) {
    for (const line of readFileSync(KEY_ENV, "utf8").split("\n")) {
      const m = line.match(/^\s*DEPLOYER_PRIVATE_KEY\s*=\s*(.+?)\s*$/);
      if (m) return m[1].replace(/^["']|["']$/g, "");
    }
  }
  throw new Error("DEPLOYER_PRIVATE_KEY not found");
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const p = new JsonRpcProvider(RPC);
  const dep = new Wallet(loadKey(), p);
  const art = JSON.parse(readFileSync("artifacts/AscendDeed.json", "utf8"));
  console.log("deployer", dep.address, formatEther(await p.getBalance(dep.address)), "PAS");

  const factory = new ContractFactory(art.abi, art.bytecode, dep);
  const nonce = await p.getTransactionCount(dep.address);
  const addr = getCreateAddress({ from: dep.address, nonce });
  const tx = await factory.getDeployTransaction();
  const gas = { gasLimit: 3_000_000n, maxFeePerGas: 2_000_000_000_000n, maxPriorityFeePerGas: 0n, nonce };
  try { await dep.sendTransaction({ ...tx, ...gas }); } catch (e) { console.log("send note:", (e.shortMessage || e.message || "").slice(0, 80)); }

  for (let i = 0; i < 120; i++) {
    await sleep(2000);
    if ((await p.getCode(addr).catch(() => "0x")) !== "0x") {
      console.log("AscendDeed deployed →", addr);
      console.log("→ paste this into src/chain/config.ts as CHAIN.ascendDeed");
      writeFileSync("deployed-deed.json", JSON.stringify({ network: "paseo", AscendDeed: addr, deployedAt: new Date().toISOString() }, null, 2));
      return;
    }
  }
  throw new Error("deploy stuck");
}
main().catch((e) => { console.error(e); process.exit(1); });
