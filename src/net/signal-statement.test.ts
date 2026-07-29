// The statement rail splits a WebRTC handshake across 512-byte statements and puts it back
// together on the far side. Statements arrive out of order and can be dropped, so a reassembly
// bug shows up as "co-op sometimes doesn't connect" — effectively undiagnosable in the wild.
// These tests pin the behaviour that prevents that.

import { describe, it, expect } from "vitest";
import { chunks, makeReassembler, CHUNK } from "./signal-statement";

const payload = (n: number) => Array.from({ length: n }, (_, i) => String.fromCharCode(33 + (i % 90))).join("");

describe("statement chunking", () => {
  it("never exceeds the statement budget", () => {
    for (const n of [0, 1, CHUNK - 1, CHUNK, CHUNK + 1, 4000]) {
      for (const c of chunks(payload(n))) expect(c.length).toBeLessThanOrEqual(CHUNK);
    }
  });

  it("always produces at least one piece, so an empty payload still sends", () => {
    expect(chunks("")).toEqual([""]);
  });

  it("round-trips a realistically sized SDP offer", () => {
    const sdp = payload(1800);
    const parts = chunks(sdp);
    expect(parts.length).toBeGreaterThan(1);

    const r = makeReassembler();
    let out: string | null = null;
    parts.forEach((d, i) => { out = r.add("o:alice:0", { i, n: parts.length, d }) ?? out; });
    expect(out).toBe(sdp);
    expect(r.pending).toBe(0); // completed sets are released, not leaked
  });
});

describe("statement reassembly", () => {
  it("tolerates chunks arriving out of order", () => {
    const sdp = payload(1000);
    const parts = chunks(sdp);
    const r = makeReassembler();
    const order = [...parts.keys()].reverse();
    let out: string | null = null;
    for (const i of order) out = r.add("k", { i, n: parts.length, d: parts[i] }) ?? out;
    expect(out).toBe(sdp);
  });

  it("yields nothing while a piece is still missing", () => {
    const parts = chunks(payload(1000));
    const r = makeReassembler();
    for (let i = 0; i < parts.length - 1; i++) {
      expect(r.add("k", { i, n: parts.length, d: parts[i] })).toBeNull();
    }
    expect(r.pending).toBe(1);
  });

  it("keeps two messages apart when both are in flight", () => {
    // This is the bug the `q` message id exists to prevent: two candidates mid-handshake must
    // not merge into one corrupt blob.
    const a = chunks(payload(700));
    const b = chunks(payload(700).split("").reverse().join("")); // distinct content, same shape
    const r = makeReassembler();
    let outA: string | null = null, outB: string | null = null;
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      if (i < a.length) outA = r.add("c:bob:0", { i, n: a.length, d: a[i] }) ?? outA;
      if (i < b.length) outB = r.add("c:bob:1", { i, n: b.length, d: b[i] }) ?? outB;
    }
    expect(outA).toBe(a.join(""));
    expect(outB).toBe(b.join(""));
    expect(outA).not.toBe(outB);
  });

  it("passes through an unchunked payload", () => {
    const r = makeReassembler();
    expect(r.add("k", { d: "hello" })).toBe("hello");
  });

  it("ignores malformed framing rather than corrupting a set", () => {
    const r = makeReassembler();
    expect(r.add("k", { i: 5, n: 2, d: "x" })).toBeNull();  // index past the end
    expect(r.add("k", { i: -1, n: 2, d: "x" })).toBeNull(); // negative index
    expect(r.add("k", { i: 0, n: 0, d: "x" })).toBeNull();  // zero-length set
    expect(r.pending).toBe(0);
  });

  it("restarts cleanly if the sender resends with a different chunk count", () => {
    const r = makeReassembler();
    expect(r.add("k", { i: 0, n: 3, d: "a" })).toBeNull();
    // a retry, split differently — the stale partial must not poison it
    expect(r.add("k", { i: 0, n: 2, d: "x" })).toBeNull();
    expect(r.add("k", { i: 1, n: 2, d: "y" })).toBe("xy");
  });
});
