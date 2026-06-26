// Paseo + AscendBank config. Reuses the Datum relay for gasless spends.

export const CHAIN = {
  id: 420420417,
  rpcHttp: "https://eth-rpc-testnet.polkadot.io/",
  rpcWss: "wss://eth-rpc-testnet.polkadot.io/", // Nova / Substrate-native wallets need WS
  explorer: "https://blockscout-testnet.polkadot.io/",
  ascendBank: "0x3D35694e11d2D5E3B6977C3Fd2683f52E57FcD31",
  ascendLedger: "0x56068D03943fD76D4D6D86A81e31895b884ccaa5",
  ascendGear: "0xd029aeecA4493D8753eD6A0d58c7297f4162B7c3",
  relayUrl: "https://relay.javcon.io",
};

// AscendGear (ERC-721) — tradeable on-chain relics. Standard transfer/approve so
// any marketplace can list them; gearOf() is the in-game read.
export const GEAR_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function gearOf(address) view returns (uint256[] ids, string[] items, uint8[] enchants)",
];

export const LEDGER_ABI = [
  "function recordNonce(address) view returns (uint256)",
  "function runCount() view returns (uint256)",
  "function runsRange(uint256 start, uint256 n) view returns (tuple(address player, uint16 depth, bool won, uint64 time)[])",
];

export const BANK_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function spendNonce(address) view returns (uint256)",
  "function deposit() payable",
];

// Paseo wants a fully-specified EIP-1559 tx (no fee estimation) — see the tavern.
export const TX = {
  gasLimit: 1_000_000n,
  maxFeePerGas: 2_000_000_000_000n,
  maxPriorityFeePerGas: 0n,
};
