// Resolving "how do we reach Paseo Asset Hub", in four flavours.
//
//   host     — the game is running inside the Polkadot app; signing goes to the host wallet
//   injected — a browser extension (Talisman / SubWallet / MetaMask) on window.ethereum
//   pine     — Pine-RPC: a smoldot light client in the page, no hosted provider at all
//   rpc      — a hosted Ethereum-JSON-RPC endpoint (read-only; there is no key to sign with)
//
// The first three can sign; `rpc` is read-only, which is enough for the leaderboard and bones.
// Everything here returns null rather than throwing — "no chain" is a normal, supported state.

import { BrowserProvider, JsonRpcProvider, type Eip1193Provider } from "ethers";
import { PASEO, LS, type ProviderKind } from "./config";

export interface Connection {
  kind: ProviderKind;
  /** Reads always work. */
  provider: BrowserProvider | JsonRpcProvider;
  /** Present only when this connection can sign — `rpc` cannot. */
  address?: string;
  canSign: boolean;
}

let current: Connection | null = null;
let pine: { disconnect(): Promise<void> } | null = null;

export function connection(): Connection | null { return current; }

const injected = (): Eip1193Provider | null =>
  (globalThis as { ethereum?: Eip1193Provider }).ethereum ?? null;

/** Is the page running inside the Polkadot host app? Cheap synchronous sniff, no import cost. */
export function inHostApp(): boolean {
  const g = globalThis as { __POLKADOT_HOST__?: unknown };
  if (g.__POLKADOT_HOST__) return true;
  try { return window.self !== window.top && /dev-dot\.li|polkadot/i.test(document.referrer); }
  catch { return false; } // cross-origin referrer check threw — assume not hosted
}

/** Which strategies could plausibly work right now, best first. */
export function available(): ProviderKind[] {
  const out: ProviderKind[] = [];
  if (inHostApp()) out.push("host");
  if (injected()) out.push("injected");
  out.push("pine", "rpc");
  return out;
}

/** Ask an injected wallet to move to Paseo Asset Hub, adding the network if it is unknown. */
async function ensureNetwork(eth: Eip1193Provider): Promise<void> {
  try {
    await eth.request({ method: "wallet_switchEthereumChain", params: [{ chainId: PASEO.chainIdHex }] });
  } catch {
    // 4902 (unknown chain) and friends — offer to add it, then let the caller retry the read.
    await eth.request({
      method: "wallet_addEthereumChain",
      params: [{
        chainId: PASEO.chainIdHex, chainName: PASEO.name,
        nativeCurrency: PASEO.nativeCurrency, rpcUrls: [...PASEO.rpcUrls],
      }],
    }).catch(() => { /* the player declined — reads still work over the hosted RPC */ });
  }
}

async function connectInjected(): Promise<Connection | null> {
  const eth = injected();
  if (!eth) return null;
  const accounts = (await eth.request({ method: "eth_requestAccounts" })) as string[];
  if (!accounts?.length) return null;
  await ensureNetwork(eth);
  const provider = new BrowserProvider(eth, PASEO.chainId);
  return { kind: "injected", provider, address: accounts[0], canSign: true };
}

async function connectHost(): Promise<Connection | null> {
  // The Polkadot host exposes an EIP-1193 surface to embedded apps; when it does, it behaves
  // exactly like an injected wallet, so we reuse that path rather than pulling in the whole SDK.
  const g = globalThis as { __POLKADOT_HOST__?: { ethereum?: Eip1193Provider } };
  const eth = g.__POLKADOT_HOST__?.ethereum ?? injected();
  if (!eth) return null;
  const accounts = (await eth.request({ method: "eth_requestAccounts" })) as string[];
  if (!accounts?.length) return null;
  const provider = new BrowserProvider(eth, PASEO.chainId);
  return { kind: "host", provider, address: accounts[0], canSign: true };
}

/** A light client in the page. Slow to start (10–60s sync) but beholden to no RPC operator. */
async function connectPine(onStep?: (s: string) => void): Promise<Connection | null> {
  const { PineProvider } = await import("pine-rpc");
  const p = new PineProvider({ chain: PASEO.pinePreset });
  await p.connect((step) => onStep?.(String(step)));
  pine = p;
  // Pine speaks EIP-1193, so ethers can drive it directly.
  const provider = new BrowserProvider(p as unknown as Eip1193Provider, PASEO.chainId);
  return { kind: "pine", provider, canSign: false };
}

function connectRpc(): Connection {
  let url = PASEO.rpcUrls[0] as string;
  try { url = localStorage.getItem(LS.rpc) || url; } catch { /* storage blocked */ }
  // staticNetwork: never re-probe the chain id — one fewer round trip, and it cannot drift.
  const provider = new JsonRpcProvider(url, PASEO.chainId, { staticNetwork: true });
  return { kind: "rpc", provider, canSign: false };
}

/**
 * Connect using `kind`, or try each available strategy in order. Returns null only if every
 * strategy failed — which is a supported outcome, not an error.
 */
export async function connect(kind?: ProviderKind, onStep?: (s: string) => void): Promise<Connection | null> {
  const order = kind ? [kind] : available();
  for (const k of order) {
    try {
      const c = k === "host" ? await connectHost()
        : k === "injected" ? await connectInjected()
        : k === "pine" ? await connectPine(onStep)
        : connectRpc();
      if (c) {
        current = c;
        try { localStorage.setItem(LS.autoConnect, "1"); localStorage.setItem(LS.kind, c.kind); } catch { /* */ }
        return c;
      }
    } catch { /* try the next strategy — a declined prompt is not a failure worth surfacing */ }
  }
  return null;
}

/** Reconnect silently on boot, but only to a strategy that needs no prompt. */
export async function autoConnect(): Promise<Connection | null> {
  try { if (localStorage.getItem(LS.autoConnect) !== "1") return null; } catch { return null; }
  const eth = injected();
  if (eth) {
    // eth_accounts (unlike eth_requestAccounts) never pops a dialog.
    const accounts = await (eth.request({ method: "eth_accounts" }) as Promise<string[]>).catch(() => []);
    if (accounts?.length) return connect(inHostApp() ? "host" : "injected");
  }
  return null;
}

export async function disconnect(): Promise<void> {
  current = null;
  try { localStorage.removeItem(LS.autoConnect); } catch { /* */ }
  if (pine) { await pine.disconnect().catch(() => { /* */ }); pine = null; }
}

/** A read-only connection for leaderboard/bones when the player has not connected a wallet. */
export async function readOnly(): Promise<Connection> {
  return current ?? connectRpc();
}
