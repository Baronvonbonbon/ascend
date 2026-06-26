import { BrowserProvider, JsonRpcProvider } from "ethers";
import { CHAIN } from "./config";

declare global {
  interface Window { ethereum?: { request?: (...a: unknown[]) => Promise<unknown> } & Record<string, unknown>; }
}

let read: JsonRpcProvider | null = null;
export function readProvider(): JsonRpcProvider {
  return (read ??= new JsonRpcProvider(CHAIN.rpcHttp, CHAIN.id, { staticNetwork: true }));
}

export interface Wallet { address: string; provider: BrowserProvider; }

/** Connect an injected wallet (MetaMask/Nova) and ensure it's on Paseo. */
export async function connectWallet(): Promise<Wallet> {
  if (!window.ethereum) throw new Error("No wallet found — install MetaMask, or open in Nova's dApp browser.");
  const provider = new BrowserProvider(window.ethereum as never);
  await provider.send("eth_requestAccounts", []);

  const net = await provider.getNetwork();
  if (Number(net.chainId) !== CHAIN.id) {
    const hex = "0x" + CHAIN.id.toString(16);
    try {
      await provider.send("wallet_switchEthereumChain", [{ chainId: hex }]);
    } catch {
      await provider.send("wallet_addEthereumChain", [{
        chainId: hex,
        chainName: "Paseo Asset Hub",
        nativeCurrency: { name: "Paseo", symbol: "PAS", decimals: 18 },
        rpcUrls: [CHAIN.rpcHttp, CHAIN.rpcWss],
        blockExplorerUrls: [CHAIN.explorer],
      }]);
    }
  }

  const signer = await provider.getSigner();
  const address = await signer.getAddress();
  return { address, provider };
}
