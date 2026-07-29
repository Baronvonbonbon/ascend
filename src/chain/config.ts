// Paseo devnet — the Polkadot Community Foundation network Ascend targets.
//
// Nothing in src/chain is ever required for play. The whole layer is optional, lazily loaded,
// and every entry point fails soft: no wallet, no extension, no network, or a chain that is
// simply down must all leave the game behaving exactly as it does offline.

export const PASEO = {
  /** EVM chain id of Paseo Asset Hub, where the contracts live (pallet-revive / PolkaVM). */
  chainId: 420420417,
  chainIdHex: "0x190f1b41",   // == 420420417; verified against eth_chainId, do not hand-compute
  name: "Paseo Asset Hub",
  nativeCurrency: { name: "Paseo", symbol: "PAS", decimals: 18 },
  /** Hosted Ethereum-JSON-RPC endpoints, tried in order. */
  rpcUrls: ["https://paseo-assethub-rpc.laissez-faire.trade"],
  /** Pine-RPC preset — a smoldot light client, no hosted provider in the path at all. */
  pinePreset: "paseo-asset-hub" as const,
  faucet: "https://faucet.polkadot.io/paseo?parachain=1000",
} as const;

/**
 * Deployed contract addresses. Empty until `cdm deploy` has run; every read is guarded on
 * `hasContracts()` so an undeployed build simply behaves like a build with no chain at all.
 *
 * Overridable at runtime (`localStorage["ascend.chain.runs"]`) so a redeploy does not need a
 * rebuild — the CDM registry is append-only, but addresses still change between deployments.
 */
export const CONTRACTS = {
  // Deployed to Paseo Asset Hub. Redeploying changes these; the localStorage overrides below
  // exist so that does not force a rebuild.
  runs:    "0x28ED6F4bC53575DeABB7b1E457c46DFd94507648", // AscendRuns    — leaderboard + bones ring
  relics:  "0x67EEbcE6C8CA3eb2b9b50C152277a0D83A39e2Aa", // AscendRelics  — ERC-721 relics from the forge
  invites: "0x35c7D2bC9eB1180a0e0486ed913308389c4d9C5e", // AscendInvites — co-op rendezvous
};

export type ContractName = keyof typeof CONTRACTS;

/** How we reach the chain. Resolution order is host app → extension → light client → hosted RPC. */
export type ProviderKind = "host" | "injected" | "pine" | "rpc";

export const LS = {
  kind: "ascend.chain.kind",       // preferred ProviderKind ("" = auto)
  autoConnect: "ascend.chain.auto", // "1" once the player has connected at least once
  rpc: "ascend.chain.rpc",         // custom hosted endpoint
  runs: "ascend.chain.runs",       // contract address overrides
  relics: "ascend.chain.relics",
  invites: "ascend.chain.invites",
  name: "ascend.chain.name",       // the name signed onto the leaderboard
} as const;

export function contractAddress(which: ContractName): string {
  try {
    const override = localStorage.getItem(LS[which]);
    if (override && /^0x[0-9a-fA-F]{40}$/.test(override)) return override;
  } catch { /* storage blocked — fall through to the built-in */ }
  return CONTRACTS[which];
}

export function hasContracts(): boolean {
  return /^0x[0-9a-fA-F]{40}$/.test(contractAddress("runs"));
}

/** Wrap any chain promise so a hung endpoint can never stall a turn. */
export function withTimeout<T>(p: Promise<T>, ms = 8000): Promise<T | null> {
  return Promise.race([
    p.catch(() => null),
    new Promise<null>((res) => setTimeout(() => res(null), ms)),
  ]);
}
