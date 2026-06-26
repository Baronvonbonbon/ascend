import { BrowserProvider, Contract } from "ethers";
import { CHAIN, LEDGER_ABI } from "./config";
import { readProvider } from "./wallet";

export interface RunEntry { player: string; depth: number; won: boolean; time: number; }

/** Record a finished run gaslessly: sign Record, the relay submits + pays gas. */
export async function recordRun(provider: BrowserProvider, address: string, depth: number, won: boolean): Promise<{ ok: boolean; error?: string }> {
  const c = new Contract(CHAIN.ascendLedger, LEDGER_ABI, readProvider());
  const nonce = await c.recordNonce(address);
  const deadline = Math.floor(Date.now() / 1000) + 3600;

  const signer = await provider.getSigner();
  const sig = await signer.signTypedData(
    { name: "AscendLedger", version: "1", chainId: BigInt(CHAIN.id), verifyingContract: CHAIN.ascendLedger },
    { Record: [
      { name: "player", type: "address" }, { name: "depth", type: "uint16" },
      { name: "won", type: "bool" }, { name: "nonce", type: "uint256" }, { name: "deadline", type: "uint256" },
    ] },
    { player: address, depth, won, nonce, deadline },
  );

  let res: Response;
  try {
    res = await fetch(`${CHAIN.relayUrl}/ascend/record`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ player: address, depth, won, deadline: String(deadline), sig }),
    });
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "relay unreachable" };
  }
  const body = await res.json().catch(() => ({}));
  return res.ok ? { ok: true } : { ok: false, error: (body as { error?: string }).error ?? `relay ${res.status}` };
}

/** Read the most recent `n` runs (newest first) for the Hall of Fame / bones. */
export async function readRecent(n = 10): Promise<RunEntry[]> {
  const c = new Contract(CHAIN.ascendLedger, LEDGER_ABI, readProvider());
  const count = Number(await c.runCount().catch(() => 0n));
  if (count === 0) return [];
  const start = Math.max(0, count - n);
  const rows = await c.runsRange(start, n);
  return rows
    .map((r: { player: string; depth: bigint; won: boolean; time: bigint }) => ({
      player: r.player, depth: Number(r.depth), won: r.won, time: Number(r.time),
    }))
    .reverse();
}
