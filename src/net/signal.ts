// How two adventurers find each other before the peer link exists.
//
// Three transports, because no single one reaches everybody:
//
//   statement — the People chain statement store. Ephemeral by design ("statements never enter
//               block storage"), free, push-delivered, and exactly how the Polkadot app signals
//               its own calls. Only available INSIDE the Polkadot app: publishing needs a
//               statement allowance, and claiming one requires a personhood alias the host owns.
//   contract  — AscendInvites on Asset Hub. Works with any EVM wallet, and unlike the statement
//               store it is a real mailbox: an invite waits an hour for someone who is offline.
//               Payloads are sealed, because the chain remembers everything forever.
//   paste     — the original offer/answer codes. Needs no wallet at all and always works.
//
// `paste` is driven by textareas in the lobby and has no address to send to, so it is not modelled
// here; this interface covers the two ADDRESSED transports. The lobby picks the best available and
// always leaves paste on screen as a fallback.

import type { Peer } from "./peer";

export type SignalId = "statement" | "contract";

/** An invitation waiting for us. `offer` is the raw SDP the transport carried. */
export interface Invite {
  from: string;
  at: number;
  offer: string;
}

/** Why an invite could not be sent. Each has a different fix, so they stay distinct. */
export type SendResult =
  | "sent"
  | "no-wallet"
  | "no-recipient-key"   // contract: nothing to seal to
  | "no-crypto"
  | "offline"            // statement: nobody is listening on the other end
  | "failed";

export interface AddressedSignal {
  readonly id: SignalId;
  /** Shown in the lobby so the player knows which rail they are on. */
  readonly label: string;
  /** Whether an invite waits for an offline player, or needs them present right now. */
  readonly mailbox: boolean;

  /** Offer to play. Resolves once the invite is out; `onPeer` fires when the link forms. */
  invite(to: string, onPeer: (p: Peer) => void): Promise<SendResult>;
  /** Invitations addressed to us, newest first. */
  inbox(): Promise<Invite[]>;
  /** Accept one. `onPeer` fires when the link forms. */
  accept(inv: Invite, onPeer: (p: Peer) => void): Promise<SendResult>;
  decline(inv: Invite): Promise<void>;
  /** Stop any subscriptions or polling. */
  stop(): void;
}

/**
 * The best transport available right now, or null for paste-only.
 *
 * Statement store first: it is free, it leaves no permanent trace, and it is the rail the host
 * app itself uses. The contract is the fallback for players outside the app, who have no
 * personhood alias and therefore no statement allowance.
 */
export async function pickSignal(): Promise<AddressedSignal | null> {
  try {
    const { statementSignal } = await import("./signal-statement");
    const s = await statementSignal();
    if (s) return s;
  } catch { /* not in the host app, or the People chain is unreachable */ }
  try {
    const { contractSignal } = await import("./signal-contract");
    return await contractSignal();
  } catch { return null; }
}
