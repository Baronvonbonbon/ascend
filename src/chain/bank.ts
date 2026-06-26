import { BrowserProvider, Contract, formatEther, parseEther } from "ethers";
import { CHAIN, BANK_ABI, TX } from "./config";
import { readProvider } from "./wallet";

/** The player's spendable purse (AscendBank balance) in whole PAS. */
export async function bankBalancePas(address: string): Promise<number> {
  const c = new Contract(CHAIN.ascendBank, BANK_ABI, readProvider());
  return Number(formatEther(await c.balanceOf(address)));
}

/** Load PAS into the purse (one on-chain tx). After this, shopping is gasless. */
export async function depositPas(provider: BrowserProvider, pas: number): Promise<void> {
  const signer = await provider.getSigner();
  const c = new Contract(CHAIN.ascendBank, BANK_ABI, signer);
  const tx = await c.deposit({ value: parseEther(String(pas)), ...TX });
  await tx.wait();
}

/** Gasless spend: sign a Spend authorization; the relay submits + pays gas. */
export async function spendPas(provider: BrowserProvider, address: string, pas: number): Promise<{ ok: boolean; error?: string }> {
  const c = new Contract(CHAIN.ascendBank, BANK_ABI, readProvider());
  const nonce = await c.spendNonce(address);
  const amount = parseEther(String(pas));
  const deadline = Math.floor(Date.now() / 1000) + 3600;

  const signer = await provider.getSigner();
  const sig = await signer.signTypedData(
    { name: "AscendBank", version: "1", chainId: BigInt(CHAIN.id), verifyingContract: CHAIN.ascendBank },
    { Spend: [
      { name: "user", type: "address" }, { name: "amount", type: "uint256" },
      { name: "nonce", type: "uint256" }, { name: "deadline", type: "uint256" },
    ] },
    { user: address, amount, nonce, deadline },
  );

  let res: Response;
  try {
    res = await fetch(`${CHAIN.relayUrl}/ascend/spend`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ user: address, amount: amount.toString(), deadline: String(deadline), sig }),
    });
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "relay unreachable" };
  }
  const body = await res.json().catch(() => ({}));
  return res.ok ? { ok: true } : { ok: false, error: (body as { error?: string }).error ?? `relay ${res.status}` };
}
