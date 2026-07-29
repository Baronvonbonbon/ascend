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

/**
 * Is the page running inside the Polkadot host app?
 *
 * This used to sniff `window.__POLKADOT_HOST__` and the referrer. Neither is real: the app sets no
 * such global, and the referrer check was a guess. The authoritative answer comes from the host SDK
 * itself, which is already in the bundle for the statement store — but it is behind a dynamic
 * import, so this stays a cheap heuristic for ordering `available()` and the real check happens in
 * ./host.ts before anything is attempted.
 */
export function inHostApp(): boolean {
  try { return window.self !== window.top; } catch { return true; } // cross-origin frame — assume embedded
}

/**
 * Which strategies could plausibly work right now, best first.
 *
 * `host` is always first and never gated on a synchronous guess. Whether the app embeds us in an
 * iframe or a native web view is not something the page can reliably tell, and getting it wrong is
 * what stranded the app on the read-only RPC. `connectHostApp` asks the host SDK and returns null in
 * a plain browser, so the only cost of trying is one dynamic import on an explicit Connect.
 */
export function available(): ProviderKind[] {
  const out: ProviderKind[] = ["host"];
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

/**
 * The Polkadot app. Signing goes through the host SDK (see ./host.ts) rather than an EVM provider,
 * because the app has none — but reads still go over the hosted RPC, so the Connection we hand back
 * carries the ordinary read provider and an address that can sign through the host link.
 */
async function connectHostApp(onStep?: (s: string) => void): Promise<Connection | null> {
  const { connectHost } = await import("./host");
  const link = await connectHost(onStep);
  if (!link) return null;
  return { kind: "host", provider: connectRpc().provider, address: link.address, canSign: true };
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
      const c = k === "host" ? await connectHostApp(onStep)
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
  try { const { clearHostLink } = await import("./host"); clearHostLink(); } catch { /* never connected */ }
}

/** A read-only connection for leaderboard/bones when the player has not connected a wallet. */
export async function readOnly(): Promise<Connection> {
  return current ?? connectRpc();
}
