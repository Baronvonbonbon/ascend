// Wire messages for peer-authoritative co-op (deterministic lockstep). Both clients
// run the full simulation from a shared RNG seed and exchange only keystrokes — each
// renders its own player's view locally. No frames or logs cross the wire.

export type CoopMode = "solo" | "coop" | "coop-ff" | "race";

/** One drawn map cell: x, y, glyph, fg colour. (Local rendering only — never sent.) */
export type Cell = [number, number, string, string];

export type NetMsg =
  // lobby handshake self-test
  | { t: "hello"; role: string; mode: CoopMode }
  | { t: "ping"; at: number }
  | { t: "pong"; at: number }
  // host → guest: build the shared world from this seed + the host's archetype (and on a restart)
  | { t: "start"; mode: CoopMode; seed: number; archetype: string }
  | { t: "restart"; seed: number; archetype: string }
  // either → other: a keystroke the sender's own avatar just EXECUTED (broadcast-on-consume lockstep)
  | { t: "input"; key: string };
