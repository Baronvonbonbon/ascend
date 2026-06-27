// Wire messages for host-authoritative co-op. The host runs the simulation and
// streams render frames + log lines; the guest forwards keystrokes.

export type CoopMode = "solo" | "coop" | "coop-ff" | "race";

/** One drawn map cell: x, y, glyph, fg colour. */
export type Cell = [number, number, string, string];

export type NetMsg =
  // lobby handshake self-test
  | { t: "hello"; role: string; mode: CoopMode }
  | { t: "ping"; at: number }
  | { t: "pong"; at: number }
  // host → guest
  | { t: "start"; mode: CoopMode }
  | { t: "frame"; cells: Cell[]; huds: [string, string] }
  | { t: "log"; text: string; cls?: string }
  // guest → host
  | { t: "input"; key: string };
