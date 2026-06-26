import { BrowserProvider, Contract, formatEther, parseEther } from "ethers";
import { CHAIN, BANK_ABI, TX } from "./config";
import { readProvider } from "./wallet";

/** The player's spendable PAS — their actual wallet balance on Paseo. */
export async function walletBalancePas(address: string): Promise<number> {
  return Number(formatEther(await readProvider().getBalance(address)));
}

/** A direct, on-chain shop payment: the player's wallet sends `price` PAS to the
 *  AscendBank (the house till) and we wait for it to confirm. No relay, no purse —
 *  the player signs and pays in their wallet, and nothing is granted until the
 *  transaction is mined. `onSubmit` fires once it's broadcast (for flavor text). */
export async function buyDirect(
  provider: BrowserProvider,
  price: number,
  onSubmit?: (hash: string) => void,
): Promise<{ ok: boolean; hash?: string; error?: string }> {
  try {
    const signer = await provider.getSigner();
    const bank = new Contract(CHAIN.ascendBank, BANK_ABI, signer);
    const tx = await bank.deposit({ value: parseEther(String(price)), ...TX });
    onSubmit?.(tx.hash);
    await tx.wait();
    return { ok: true, hash: tx.hash };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "transaction failed";
    // Surface the common wallet rejection cleanly.
    return { ok: false, error: /reject|denied|user/i.test(msg) ? "you waved the terminal away" : msg };
  }
}
