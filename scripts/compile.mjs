// Compile AscendBank.sol with standalone solc → artifacts/AscendBank.json.
import solc from "solc";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

const src = readFileSync("contracts/AscendBank.sol", "utf8");
const input = {
  language: "Solidity",
  sources: { "AscendBank.sol": { content: src } },
  settings: {
    optimizer: { enabled: true, runs: 200 },
    evmVersion: "cancun",
    outputSelection: { "*": { "*": ["abi", "evm.bytecode.object"] } },
  },
};

const out = JSON.parse(solc.compile(JSON.stringify(input)));
for (const e of out.errors ?? []) console.log(e.formattedMessage);
if ((out.errors ?? []).some((e) => e.severity === "error")) process.exit(1);

const c = out.contracts["AscendBank.sol"]["AscendBank"];
mkdirSync("artifacts", { recursive: true });
writeFileSync(
  "artifacts/AscendBank.json",
  JSON.stringify({ abi: c.abi, bytecode: "0x" + c.evm.bytecode.object }, null, 2),
);
console.log("compiled AscendBank — bytecode bytes:", c.evm.bytecode.object.length / 2);
