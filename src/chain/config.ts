// Paseo + AscendBank config. Reuses the Datum relay for gasless spends.

export const CHAIN = {
  id: 420420417,
  rpcHttp: "https://eth-rpc-testnet.polkadot.io/",
  rpcWss: "wss://eth-rpc-testnet.polkadot.io/", // Nova / Substrate-native wallets need WS
  explorer: "https://blockscout-testnet.polkadot.io/",
  ascendBank: "0x3D35694e11d2D5E3B6977C3Fd2683f52E57FcD31",
  ascendLedger: "0x56068D03943fD76D4D6D86A81e31895b884ccaa5",
  ascendGear: "0xFbE3c0de4C67d19Ea366f2Bf69BC5a4c83492d7D",
  relayUrl: "https://relay.javcon.io",
};

// AscendGear (ERC-721) — tradeable on-chain relics. Permissionless direct forge
// (no relay): the player pays PAS and the contract rolls rarity on-chain. Standard
// transfer/approve so any marketplace can list them; gearOf() is the in-game read.
export const GEAR_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function gearOf(address) view returns (uint256[] ids, string[] items, uint8[] enchants, uint8[] rarities)",
  "function forge(string id, uint8 baseEnchant) payable returns (uint256)",
  "function forgePrice(uint8 baseEnchant) view returns (uint256)",
  "event Forged(address indexed to, uint256 indexed tokenId, string itemId, uint8 enchant, uint8 rarity)",
];

/** Rarity tiers rolled on-chain at forge time. */
export const RARITY = ["common", "rare", "epic", "legendary"] as const;

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
