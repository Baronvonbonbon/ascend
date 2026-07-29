// Compile the contracts for Asset Hub with `resolc` — the revive Solidity compiler.
//
// This is the artifact that actually deploys. Asset Hub runs PolkaVM via pallet-revive, which
// executes resolc output, NOT stock solc's EVM bytecode. `npm run contracts:build` (plain solc)
// stays around because it is the fast way to typecheck sources and diff ABIs; it cannot deploy.
//
//   npm run contracts:revive
//
// Output: contracts/out/<Name>.polkavm.json  ({ abi, bytecode })

import { compile } from "@parity/resolc";
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";

const SRC = "contracts";
const OUT = join(SRC, "out");

const sources = Object.fromEntries(
  readdirSync(SRC).filter((f) => f.endsWith(".sol"))
    .map((f) => [f, { content: readFileSync(join(SRC, f), "utf8") }]),
);

console.log("compiling with resolc…");
const out = await compile(sources, { optimizer: { enabled: true, runs: 200 } });

const errors = (out.errors ?? []).filter((e) => e.severity === "error");
for (const e of out.errors ?? []) console.log(`${e.severity.toUpperCase()}: ${(e.formattedMessage ?? e.message).trim()}`);
if (errors.length) process.exit(1);

mkdirSync(OUT, { recursive: true });
let wrote = 0;
for (const file of Object.keys(out.contracts ?? {})) {
  for (const [name, c] of Object.entries(out.contracts[file])) {
    const bytecode = c.evm?.bytecode?.object;
    if (!bytecode) continue; // interfaces carry no code
    writeFileSync(join(OUT, `${name}.polkavm.json`), JSON.stringify({ abi: c.abi, bytecode }, null, 2));
    console.log(`  ${name}: ${bytecode.length / 2} bytes of PolkaVM code`);
    wrote++;
  }
}
if (!wrote) { console.error("resolc produced no deployable code"); process.exit(1); }
