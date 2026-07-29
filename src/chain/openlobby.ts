// The open table: announce that you are looking for a game, and see who else is.
//
// A listing is three fields — address, self-chosen name, timestamp — and nothing else. No SDP, no
// ICE candidates, no IP. Joining someone's table does not happen here: it triggers the ordinary
// sealed invite through AscendInvites, so the handshake stays encrypted end-to-end and the two
// players' network addresses are seen only by each other.
//
// What a listing does unavoidably reveal is that an address wants to play, and roughly when.
// Opening a table is a signed transaction, so that is inherent — the UI says so, and inviting by
// address remains the private alternative.

import { Contract, encodeBytes32String, decodeBytes32String } from "ethers";
import { connection, readOnly } from "./provider";
import { contractAddress, withTimeout } from "./config";
import { sendWrite } from "./write";
import { playerName, encodeName } from "./runs";

const ABI = [
  "function open(bytes32 name)",
  "function close()",
  // `openedAt`, not `at`: ethers' Result extends Array, so a field called `at` resolves to
  // Array.prototype.at and every timestamp silently decodes as NaN. Names are positional here.
  "function tables() view returns (tuple(address host, bytes32 name, uint40 openedAt)[])",
  "function isOpen(address who) view returns (bool)",
  "function TTL() view returns (uint40)",
] as const;

export interface OpenTable { host: string; name: string; at: number }

export function lobbyAddress(): string { return contractAddress("lobby"); }
export function hasLobby(): boolean { return /^0x[0-9a-fA-F]{40}$/.test(lobbyAddress()); }

// Browsing tables is a plain read, so it goes through readOnly() rather than the player's own
// connection: you can see who is looking for a game before you have connected anything at all.
// Only opening/closing your own table needs a signer.
async function read(): Promise<Contract | null> {
  if (!hasLobby()) return null;
  const conn = await readOnly();
  return new Contract(lobbyAddress(), ABI as unknown as string[], conn.provider);
}

/** Writes go through sendWrite, which picks the EVM wallet or the Polkadot app's host signer. */
async function send(fn: string, args: unknown[]): Promise<boolean> {
  if (!hasLobby()) return false;
  return (await sendWrite("lobby", ABI, fn, args)) !== null;
}

/** Every table still within its TTL, newest first. Empty on any failure. */
export async function fetchTables(): Promise<OpenTable[]> {
  const c = await read();
  if (!c) return [];
  const rows = await withTimeout(c.tables(), 10_000);
  if (!rows) return [];
  return (rows as { host: string; name: string; openedAt: bigint }[])
    .map((t) => ({
      host: String(t.host),
      name: (() => { try { return decodeBytes32String(t.name) || "an adventurer"; } catch { return "an adventurer"; } })(),
      at: Number(t.openedAt),
    }))
    .sort((a, b) => b.at - a.at);
}

/** Announce a table under the name the player chose in Options. Re-opening refreshes it. */
export async function openTable(): Promise<boolean> {
  return send("open", [encodeName(playerName())]);
}

export async function closeTable(): Promise<boolean> {
  return send("close", []);
}

/** Do we currently have a table up? Drives Open/Close in the UI. */
export async function tableIsOpen(): Promise<boolean> {
  const conn = connection();
  if (!conn?.address) return false;
  const c = await read();
  if (!c) return false;
  return (await withTimeout(c.isOpen(conn.address), 10_000)) === true;
}

// re-exported so the UI can label a table with the same name the roll uses
export { playerName, encodeBytes32String };
