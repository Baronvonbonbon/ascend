// Signing from inside the Polkadot app.
//
// The app is not a browser wallet. It injects no `window.ethereum` and exposes no EIP-1193 surface
// at all — its boundary is `@parity/product-sdk-host` over TruAPI, and the wallet it hands out is a
// Substrate `PolkadotSigner`. The old `connectHost()` looked for `window.__POLKADOT_HOST__.ethereum`,
// found nothing, and fell through the strategy list to the read-only hosted RPC. That is why the app
// reported "rpc — read-only" and every signing feature quietly vanished.
//
// So a write cannot be handed over as an EVM transaction. It goes out as a pallet-revive
// `Revive.call` extrinsic, which is what `@parity/product-sdk-contracts` builds and signs.
//
// READS DELIBERATELY DO NOT COME THROUGH HERE. They stay on ethers over the hosted JSON-RPC, the
// same path every other environment uses. It is the same contract state either way, and one read
// path means the leaderboard, the bones ring and the table list behave identically inside the app
// and outside it — worth far more than routing them through a second stack for symmetry's sake.
//
// Everything is dynamically imported: this SDK is large, and a player who never connects must not
// pay for it.

import type { ContractName } from "./config";

export interface HostLink {
  /** The Substrate account the host selected. */
  ss58: string;
  /** Its pallet-revive H160 — what the rest of the chain layer means by "address". */
  address: string;
  name: string | null;
  /**
   * Send a contract write. Resolves to a transaction hash, or null if it did not land —
   * matching the ethers write paths, which also report failure rather than throwing.
   */
  write(which: ContractName, abi: readonly string[], fn: string, args: unknown[]): Promise<string | null>;
}

let link: HostLink | null = null;

export function hostLink(): HostLink | null { return link; }
export function clearHostLink(): void { link = null; }

/** Are we running inside the Polkadot app's container at all? Cheap, and never throws. */
export async function insideHost(): Promise<boolean> {
  try {
    const { isInsideContainerSync } = await import("@parity/product-sdk-host");
    return isInsideContainerSync();
  } catch { return false; }
}

/**
 * Connect to the host wallet. Returns null whenever that is not possible — outside the app, with no
 * account, or if any part of the SDK is unavailable — so the caller can fall through to the next
 * strategy exactly as before.
 */
export async function connectHost(onStep?: (s: string) => void): Promise<HostLink | null> {
  if (!(await insideHost())) return null;
  try {
    onStep?.("reaching the host wallet");
    const [signerMod, clientMod, contractMod, descriptorMod, ethersMod] = await Promise.all([
      import("@parity/product-sdk-signer"),
      import("@parity/product-sdk-chain-client"),
      import("@parity/product-sdk-contracts"),
      import("@parity/product-sdk-descriptors/devnet-asset-hub"),
      import("ethers"),
    ]);

    const manager = new signerMod.SignerManager();
    await manager.connect(); // defaults to the Host API, which is the only provider in the app
    const state = manager.getState();
    // The host may or may not have restored a selection; either way we need one before signing.
    const account = state.selectedAccount ?? state.accounts[0];
    if (!account) return null;
    if (!state.selectedAccount) manager.selectAccount(account.address);

    onStep?.("connecting to Asset Hub");
    const descriptor = descriptorMod.devnet_asset_hub;
    const chain = await clientMod.createChainClient({ chains: { assetHub: descriptor } });
    const runtime = contractMod.createContractRuntimeFromClient(chain.raw.assetHub, descriptor);

    // pallet-revive addresses a Substrate account by a derived H160, and that mapping has to exist
    // on chain before a call from it will dispatch. It is one extrinsic, once per account, and a
    // no-op afterwards — but skipping it makes the FIRST write of a fresh account fail for a reason
    // nothing in the error text explains.
    onStep?.("checking the account mapping");
    await contractMod.ensureContractAccountMapped(runtime, account.address, account.getSigner(), {
      onStatus: (s) => onStep?.(s),
    });

    const { contractAddress } = await import("./config");

    link = {
      ss58: account.address,
      address: account.h160Address,
      name: account.name,
      async write(which, abi, fn, args) {
        try {
          const at = contractAddress(which);
          if (!/^0x[0-9a-fA-F]{40}$/.test(at)) return null;
          // Our ABIs are ethers' human-readable form (they read as documentation and keep JSON
          // blobs out of the bundle). The SDK wants the JSON form, so convert rather than
          // maintaining a second copy that could drift.
          const json = JSON.parse(ethersMod.Interface.from(abi as string[]).formatJson());
          const contract = contractMod.createContract(runtime, at as `0x${string}`, json, {
            signerManager: manager,
          });
          const method = (contract as unknown as Record<string, { tx: (...a: unknown[]) => Promise<unknown> }>)[fn];
          if (!method) return null;
          const res = (await method.tx(...args)) as {
            isOk?: () => boolean;
            value?: { txHash: string; ok: boolean };
          };
          if (res.isOk && !res.isOk()) return null;
          const value = res.value;
          // `.tx()` already waits for inclusion, so there is no separate receipt to await —
          // but a dispatch can be included and still have failed.
          return value?.ok ? value.txHash : null;
        } catch { return null; }
      },
    };
    return link;
  } catch {
    link = null;
    return null;
  }
}
