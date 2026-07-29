// The invite sealing has one job: keep a player's IP address out of public block history.
// These tests pin the properties that job depends on.

import { describe, it, expect, beforeEach, vi } from "vitest";

// crypto.ts keeps the long-term key in localStorage; jsdom is not in play here, so provide the
// smallest thing that behaves like it. Each test starts from a clean store.
class MemStore {
  private m = new Map<string, string>();
  getItem(k: string) { return this.m.get(k) ?? null; }
  setItem(k: string, v: string) { this.m.set(k, v); }
  removeItem(k: string) { this.m.delete(k); }
  clear() { this.m.clear(); }
}

beforeEach(() => {
  vi.stubGlobal("localStorage", new MemStore());
  vi.resetModules();
});

/** Load a fresh copy of the module, i.e. a fresh device with its own key. */
async function device() {
  vi.resetModules();
  vi.stubGlobal("localStorage", new MemStore());
  return import("./crypto");
}

const text = (s: string) => new TextEncoder().encode(s);
const str = (b: Uint8Array) => new TextDecoder().decode(b);

// A realistic payload: an SDP offer is what actually travels, IP addresses and all.
const SDP = `v=0\r\no=- 4611731400430051336 2 IN IP4 127.0.0.1\r\ns=-\r\n` +
  `a=candidate:1 1 udp 2122260223 192.168.1.42 51234 typ host\r\n` +
  `a=candidate:2 1 udp 1686052607 203.0.113.77 51234 typ srflx raddr 192.168.1.42\r\n` +
  `a=ice-ufrag:aBcD\r\na=ice-pwd:sOmEpAsSwOrD\r\na=fingerprint:sha-256 AB:CD:EF\r\n`;

describe("invite sealing", () => {
  it("is available in this runtime", async () => {
    const c = await device();
    expect(c.sealingAvailable()).toBe(true);
  });

  it("round-trips a payload back to the exact bytes", async () => {
    const recipient = await device();
    const theirPub = (await recipient.localPublicKey())!;
    expect(theirPub).toBeTruthy();
    expect(theirPub.length).toBe(65); // uncompressed P-256 point

    const sealed = (await recipient.seal(theirPub, text(SDP)))!;
    expect(sealed).toBeTruthy();
    const opened = await recipient.open(sealed);
    expect(opened).toBeTruthy();
    expect(str(opened!)).toBe(SDP);
  });

  it("does not leak the plaintext into the sealed bytes", async () => {
    // The whole point: a chain observer must not be able to read the IP out of the payload.
    const c = await device();
    const pub = (await c.localPublicKey())!;
    const sealed = (await c.seal(pub, text(SDP)))!;
    const asText = new TextDecoder("utf-8", { fatal: false }).decode(sealed);
    expect(asText).not.toContain("203.0.113.77"); // the public IP
    expect(asText).not.toContain("192.168.1.42"); // the host candidate
    expect(asText).not.toContain("ice-pwd");
    expect(asText).not.toContain("candidate");
  });

  it("cannot be opened by a different device", async () => {
    const recipient = await device();
    const theirPub = (await recipient.localPublicKey())!;
    const sealed = (await recipient.seal(theirPub, text(SDP)))!;

    const eavesdropper = await device();          // a fresh key, i.e. anyone else on the chain
    expect(await eavesdropper.open(sealed)).toBeNull();
  });

  it("rejects a tampered payload rather than returning garbage", async () => {
    const c = await device();
    const pub = (await c.localPublicKey())!;
    const sealed = (await c.seal(pub, text(SDP)))!;

    for (const at of [0, 70, sealed.length - 1]) {  // ephemeral key, iv, and ciphertext regions
      const bad = new Uint8Array(sealed);
      bad[at] ^= 0xff;
      expect(await c.open(bad), `flipping byte ${at} should not open`).toBeNull();
    }
  });

  it("refuses a malformed recipient key instead of sealing to nothing", async () => {
    const c = await device();
    expect(await c.seal(new Uint8Array(64), text("x"))).toBeNull(); // wrong length
    expect(await c.seal(new Uint8Array(65), text("x"))).toBeNull(); // not a valid point
  });

  it("keeps the same key across reloads, so invites stay readable", async () => {
    const c = await device();
    const first = (await c.localPublicKey())!;
    vi.resetModules();                         // reload the page, same localStorage
    const again = await import("./crypto");
    expect([...(await again.localPublicKey())!]).toEqual([...first]);
  });

  it("truncated input is rejected", async () => {
    const c = await device();
    expect(await c.open(new Uint8Array(10))).toBeNull();
    expect(await c.open(new Uint8Array(0))).toBeNull();
  });
});
