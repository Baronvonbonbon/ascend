// Compile the Asset Hub contracts and drop ABI + bytecode into contracts/out/.
//
// This uses stock solc, which is enough to typecheck the sources and generate ABIs. Deploying to
// Asset Hub needs a second step: PolkaVM runs `resolc` output, NOT solc's EVM bytecode, and the
// deploy itself goes through `cdm deploy` (which also publishes metadata to the Bulletin chain and
// registers the contract). See contracts/README.md.
//
//   npm run contracts:build

import solc from "solc";
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";

const SRC = "contracts";
const OUT = join(SRC, "out");

const sources = Object.fromEntries(
  readdirSync(SRC).filter((f) => f.endsWith(".sol"))
    .map((f) => [f, { content: readFileSync(join(SRC, f), "utf8") }]),
);

const out = JSON.parse(solc.compile(JSON.stringify({
  language: "Solidity",
  sources,
  settings: {
    optimizer: { enabled: true, runs: 200 },
    outputSelection: { "*": { "*": ["abi", "evm.bytecode.object"] } },
  },
})));

const errors = (out.errors ?? []).filter((e) => e.severity === "error");
for (const e of out.errors ?? []) console.log(`${e.severity.toUpperCase()}: ${e.formattedMessage.trim()}`);
if (errors.length) process.exit(1);

mkdirSync(OUT, { recursive: true });
for (const file of Object.keys(out.contracts)) {
  for (const [name, c] of Object.entries(out.contracts[file])) {
    if (!c.evm.bytecode.object) continue; // interfaces have no code
    writeFileSync(join(OUT, `${name}.abi.json`), JSON.stringify(c.abi, null, 2));
    writeFileSync(join(OUT, `${name}.bin`), c.evm.bytecode.object);
    console.log(`${name}: ${c.evm.bytecode.object.length / 2} bytes, ${c.abi.length} ABI entries`);
  }
}
