// Paseo + AscendBank config. Reuses the Datum relay for gasless spends.

export const CHAIN = {
  id: 420420417,
  rpcHttp: "https://eth-rpc-testnet.polkadot.io/",
  rpcWss: "wss://eth-rpc-testnet.polkadot.io/", // Nova / Substrate-native wallets need WS
  explorer: "https://blockscout-testnet.polkadot.io/",
  ascendBank: "0x3D35694e11d2D5E3B6977C3Fd2683f52E57FcD31",
  relayUrl: "https://relay.javcon.io",
};

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
