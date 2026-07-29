// End-to-end sealing for co-op invites.
//
// WHY. A WebRTC offer carries ICE candidates, and those include your public IP. An invite is a
// transaction signed by your account, so a plaintext offer would write "this address had this IP
// at this time" into block history permanently — public, and impossible to withdraw, because
// clearing contract storage does not clear calldata or events. Sealing the payload puts the chain
// back to where the old copy/paste flow was: your address is visible, your IP is not.
//
// SCHEME. ECIES over P-256, entirely on WebCrypto — no new dependency, and nothing hand-rolled:
//
//   sender:    ephemeral P-256 keypair -> ECDH with the recipient's published key
//              -> HKDF-SHA256 (salt = ephemeral pubkey, info = context string)
//              -> AES-256-GCM
//   on chain:  ephemeralPubKey(65) ‖ iv(12) ‖ ciphertext‖tag
//   recipient: ECDH with their stored private key -> same HKDF -> open
//
// The AES-GCM tag also authenticates: a tampered payload fails to open rather than decrypting to
// something attacker-chosen. It does NOT authenticate *who* sent it — the contract does that, by
// recording `msg.sender`, and a sealed payload from the wrong sender is simply an invite you
// decline.
//
// KEY MANAGEMENT. The long-term key is generated locally and kept in localStorage; it is NOT
// derived from your wallet key, so compromising one does not expose the other. Losing it (cleared
// browser, new device) just means republishing — one cheap transaction — and any invite already
// in flight becomes undecryptable, which is harmless since invites expire within the hour.

const STORE = "ascend.chain.invitekey"; // JWK of the long-term private key, this device only
const CONTEXT = new TextEncoder().encode("ascend-coop-invite-v1");
const EPH_LEN = 65; // uncompressed P-256 point
const IV_LEN = 12;  // AES-GCM nonce

const subtle = (): SubtleCrypto | null => globalThis.crypto?.subtle ?? null;

const ECDH = { name: "ECDH", namedCurve: "P-256" } as const;

/** The long-term keypair for this device, generated on first use and reused after. */
async function localKeys(): Promise<{ priv: CryptoKey; pub: Uint8Array } | null> {
  const s = subtle();
  if (!s) return null;
  try {
    const saved = localStorage.getItem(STORE);
    if (saved) {
      const jwk = JSON.parse(saved) as JsonWebKey;
      const priv = await s.importKey("jwk", jwk, ECDH, true, ["deriveBits"]);
      return { priv, pub: await publicOf(s, jwk) };
    }
  } catch { /* unreadable or from an older scheme — fall through and mint a fresh one */ }

  const pair = await s.generateKey(ECDH, true, ["deriveBits"]);
  const jwk = await s.exportKey("jwk", pair.privateKey);
  try { localStorage.setItem(STORE, JSON.stringify(jwk)); } catch { /* storage blocked: key lives for this session only */ }
  const pub = new Uint8Array(await s.exportKey("raw", pair.publicKey));
  return { priv: pair.privateKey, pub };
}

/** Recover the raw public point from a private JWK (x/y are carried in the JWK itself). */
async function publicOf(s: SubtleCrypto, jwk: JsonWebKey): Promise<Uint8Array> {
  const pubJwk: JsonWebKey = { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y, ext: true };
  const key = await s.importKey("jwk", pubJwk, ECDH, true, []);
  return new Uint8Array(await s.exportKey("raw", key));
}

/** This device's public key, to publish on chain. Null if WebCrypto is unavailable. */
export async function localPublicKey(): Promise<Uint8Array | null> {
  return (await localKeys())?.pub ?? null;
}

/** Derive the AES key shared between `priv` and `theirPub`. */
async function sharedKey(s: SubtleCrypto, priv: CryptoKey, theirPub: Uint8Array, salt: Uint8Array): Promise<CryptoKey> {
  const pub = await s.importKey("raw", bytes(theirPub), ECDH, false, []);
  const bits = await s.deriveBits({ name: "ECDH", public: pub }, priv, 256);
  const hkdfKey = await s.importKey("raw", bits, "HKDF", false, ["deriveKey"]);
  return s.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: bytes(salt), info: CONTEXT },
    hkdfKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

/** Copy into an ArrayBuffer-backed view — WebCrypto will not take a SharedArrayBuffer-backed one. */
function bytes(a: Uint8Array): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(new ArrayBuffer(a.byteLength));
  out.set(a);
  return out;
}

/**
 * Seal `plain` so that only the holder of `theirPub` can read it.
 * Returns null if WebCrypto is missing or the key is malformed — callers must treat that as
 * "cannot send", never as "send it in the clear".
 */
export async function seal(theirPub: Uint8Array, plain: Uint8Array): Promise<Uint8Array | null> {
  const s = subtle();
  if (!s || theirPub.length !== EPH_LEN) return null;
  try {
    const eph = await s.generateKey(ECDH, true, ["deriveBits"]);
    const ephPub = new Uint8Array(await s.exportKey("raw", eph.publicKey));
    const key = await sharedKey(s, eph.privateKey, theirPub, ephPub);
    const iv = crypto.getRandomValues(new Uint8Array(IV_LEN));
    const ct = new Uint8Array(await s.encrypt({ name: "AES-GCM", iv: bytes(iv) }, key, bytes(plain)));

    const out = new Uint8Array(EPH_LEN + IV_LEN + ct.length);
    out.set(ephPub, 0);
    out.set(iv, EPH_LEN);
    out.set(ct, EPH_LEN + IV_LEN);
    return out;
  } catch { return null; }
}

/** Open a payload sealed to this device's key. Null on any failure — including tampering. */
export async function open(sealed: Uint8Array): Promise<Uint8Array | null> {
  const s = subtle();
  if (!s || sealed.length <= EPH_LEN + IV_LEN) return null;
  try {
    const keys = await localKeys();
    if (!keys) return null;
    const ephPub = sealed.subarray(0, EPH_LEN);
    const iv = sealed.subarray(EPH_LEN, EPH_LEN + IV_LEN);
    const ct = sealed.subarray(EPH_LEN + IV_LEN);
    const key = await sharedKey(s, keys.priv, ephPub, ephPub);
    return new Uint8Array(await s.decrypt({ name: "AES-GCM", iv: bytes(iv) }, key, bytes(ct)));
  } catch { return null; } // wrong key, truncated, or tampered — all indistinguishable, all "no"
}

/** Whether sealing is possible at all here. Without it, invites must fall back to copy/paste. */
export function sealingAvailable(): boolean {
  return !!subtle();
}
