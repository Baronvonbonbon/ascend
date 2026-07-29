// Typed handles onto the two Asset Hub contracts.
//
// ABIs are written in ethers' human-readable form rather than imported from contracts/out — they
// are small, they read as documentation, and it keeps the browser bundle free of JSON blobs. They
// must stay in step with contracts/*.sol; `npm run contracts:build` prints the real ABI to diff
// against if you change a signature.

import { Contract, type ContractRunner } from "ethers";
import { contractAddress } from "./config";

/** The Run tuple, spelled once — it appears in three signatures. */
const RUN_TUPLE =
  "tuple(address player, bytes32 name, uint64 seed, bytes32 runHash, uint32 turns," +
  " uint16 depth, uint16 maxDepth, bool ascended, uint40 recordedAt, bytes32 bonesCid)";

export const RUNS_ABI = [
  `function submitRun(bytes32 name, uint64 seed, bytes32 runHash, uint32 turns, uint16 depth, uint16 maxDepth, bool ascended, bytes32 bonesCid)`,
  `function leaderboard() view returns (${RUN_TUPLE}[])`,
  `function recentBones(uint16 count) view returns (${RUN_TUPLE}[])`,
  `function totalRuns() view returns (uint64)`,
  `function totalAscensions() view returns (uint64)`,
] as const;

export const RELICS_ABI = [
  `function forge(bytes32 itemName, bytes32 glyph, int8 enchant, uint8 buc, uint16 depth, bytes32 runHash) returns (uint256)`,
  `function relicsOf(address owner) view returns (uint256[])`,
  `function relicOf(uint256 tokenId) view returns (bytes32 itemName, bytes32 glyph, int8 enchant, uint8 buc, uint16 depth, uint40 forgedAt, bytes32 runHash, address forger)`,
  `function tokenURI(uint256 tokenId) view returns (string)`,
  `function totalSupply() view returns (uint256)`,
] as const;

export function runsContract(runner: ContractRunner): Contract | null {
  const at = contractAddress("runs");
  return at ? new Contract(at, RUNS_ABI as unknown as string[], runner) : null;
}

export function relicsContract(runner: ContractRunner): Contract | null {
  const at = contractAddress("relics");
  return at ? new Contract(at, RELICS_ABI as unknown as string[], runner) : null;
}
