// Generate the contract deploy key into .env (gitignored, chmod 600). Testnet only.
// Prints the ADDRESS so it can be funded; never prints the private key.
import { Wallet } from "ethers";
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const path = ".env";
let env = existsSync(path) ? readFileSync(path, "utf8") : "";
const found = env.match(/^DEPLOYER_PRIVATE_KEY=(.*)$/m);
if (found) {
  console.log("A key already exists in .env — leaving it alone.");
  console.log("address:", new Wallet(found[1].trim()).address);
  process.exit(0);
}
const w = Wallet.createRandom();
env += (env && !env.endsWith("\n") ? "\n" : "")
  + "# Ascend contract deploy key — Paseo Asset Hub (TESTNET ONLY).\n"
  + "# Generated locally; never committed (.env is gitignored). Not used by the game at runtime.\n"
  + `DEPLOYER_PRIVATE_KEY=${w.privateKey}\n`
  + `DEPLOYER_ADDRESS=${w.address}\n`;
writeFileSync(path, env, { mode: 0o600 });
console.log("key written to .env (chmod 600)");
console.log("address:", w.address);
