// Compile every contracts/*.sol with standalone solc → artifacts/<Name>.json.
import solc from "solc";
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from "node:fs";

const files = readdirSync("contracts").filter((f) => f.endsWith(".sol"));
const sources = Object.fromEntries(files.map((f) => [f, { content: readFileSync(`contracts/${f}`, "utf8") }]));

const input = {
  language: "Solidity",
  sources,
  settings: {
    optimizer: { enabled: true, runs: 200 },
    evmVersion: "cancun",
    outputSelection: { "*": { "*": ["abi", "evm.bytecode.object"] } },
  },
};

const out = JSON.parse(solc.compile(JSON.stringify(input)));
for (const e of out.errors ?? []) console.log(e.formattedMessage);
if ((out.errors ?? []).some((e) => e.severity === "error")) process.exit(1);

mkdirSync("artifacts", { recursive: true });
for (const f of files) {
  for (const [name, c] of Object.entries(out.contracts[f])) {
    writeFileSync(`artifacts/${name}.json`, JSON.stringify({ abi: c.abi, bytecode: "0x" + c.evm.bytecode.object }, null, 2));
    console.log(`compiled ${name} — bytecode bytes:`, c.evm.bytecode.object.length / 2);
  }
}
