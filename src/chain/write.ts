// One place where a contract write chooses its rails.
//
// There are two, and they are not interchangeable at the ethers level: a browser wallet signs an EVM
// transaction, while the Polkadot app signs a pallet-revive `Revive.call` extrinsic (see ./host.ts).
// Rather than branch at every call site, each write goes through `sendWrite` and states what it
// wants — contract, ABI, function, arguments — leaving the transport to this module.
//
// Every path resolves to a tx hash or null. Nothing here throws, and nothing here is on a turn path.

import { Contract } from "ethers";
import { connection } from "./provider";
import { contractAddress, withTimeout, type ContractName } from "./config";
import { hostLink } from "./host";

/** How long a signed write may take before we stop waiting. Phone approval is a human in the loop. */
const WRITE_TIMEOUT_MS = 90_000;

/**
 * Send a contract write over whichever signer is live.
 *
 * @returns the transaction hash, or null if there was no signer, no deployed contract, or the
 *          dispatch did not succeed. Callers treat null as "it did not happen".
 */
export async function sendWrite(
  which: ContractName,
  abi: readonly string[],
  fn: string,
  args: unknown[],
): Promise<string | null> {
  // Inside the Polkadot app the host link is the only thing that can sign, and it waits for
  // inclusion itself, so it is not wrapped in the ethers timeout below.
  const host = hostLink();
  if (host) return host.write(which, abi, fn, args);

  const conn = connection();
  const at = contractAddress(which);
  if (!conn?.canSign || !/^0x[0-9a-fA-F]{40}$/.test(at)) return null;

  const out = await withTimeout((async () => {
    const signer = await (conn.provider as { getSigner(): Promise<unknown> }).getSigner();
    const c = new Contract(at, abi as unknown as string[], signer as never);
    const tx = await c[fn](...args);
    const receipt = await tx.wait();
    return (receipt?.hash as string | undefined) ?? (tx.hash as string);
  })(), WRITE_TIMEOUT_MS);

  return out ?? null;
}

/** Whether anything at all can sign right now — the host link, or a wallet connection. */
export function canWrite(): boolean {
  return !!hostLink() || !!connection()?.canSign;
}
