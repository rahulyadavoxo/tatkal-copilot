/**
 * Passenger vault — AES-256-GCM encryption for stored passenger details.
 * Pure logic: the key comes from a KeyProvider so this module stays testable
 * and never touches native storage itself. In the app, the provider reads
 * expo-secure-store; the key never leaves the device and is never logged.
 */
import { gcm } from '@noble/ciphers/aes.js';
import { randomBytes } from '@noble/ciphers/utils.js';

export interface KeyProvider {
  getKey(): Promise<Uint8Array>; // must resolve to exactly 32 bytes
}

/**
 * Random-byte source. Injectable because the default (noble's randomBytes,
 * which needs `crypto.getRandomValues`) does NOT exist on React Native's
 * Hermes engine — on device the app MUST pass expo-crypto's native RNG.
 * The default keeps Node/Jest and the headless harness working.
 */
export type Rng = (byteLength: number) => Promise<Uint8Array>;

const defaultRng: Rng = async (n) => randomBytes(n);

const NONCE_LEN = 12;
const ENVELOPE_VERSION = 'v1';

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function b64encode(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i];
    const b = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const c = i + 2 < bytes.length ? bytes[i + 2] : 0;
    const n = (a << 16) | (b << 8) | c;
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63];
    out += i + 1 < bytes.length ? B64[(n >> 6) & 63] : '=';
    out += i + 2 < bytes.length ? B64[n & 63] : '=';
  }
  return out;
}

function b64decode(s: string): Uint8Array {
  const clean = s.replace(/[^A-Za-z0-9+/=]/g, '');
  if (clean.length === 0 || clean.length % 4 !== 0) {
    throw new Error('vault: malformed envelope (bad base64 length)');
  }
  const out: number[] = [];
  for (let i = 0; i < clean.length; i += 4) {
    const a = B64.indexOf(clean[i]);
    const b = B64.indexOf(clean[i + 1]);
    const c = clean[i + 2] === '=' ? 0 : B64.indexOf(clean[i + 2]);
    const d = clean[i + 3] === '=' ? 0 : B64.indexOf(clean[i + 3]);
    if (a < 0 || b < 0 || c < 0 || d < 0) {
      throw new Error('vault: malformed envelope (bad base64 data)');
    }
    const n = (a << 18) | (b << 12) | (c << 6) | d;
    out.push((n >> 16) & 255);
    if (clean[i + 2] !== '=') out.push((n >> 8) & 255);
    if (clean[i + 3] !== '=') out.push(n & 255);
  }
  return new Uint8Array(out);
}

/**
 * `slot` binds every envelope to its storage slot: it is passed as AES-GCM
 * additional authenticated data (AAD), so an envelope copied into a
 * different slot fails authentication. The envelope format stays
 * `v1.<nonce>.<ciphertext>` — the AAD is never stored, only checked.
 *
 * Legacy envelopes (written before AAD binding existed) decrypt via
 * `decryptJSONWithUpgrade`, which retries without AAD and flags the caller
 * to re-encrypt. When no `slot` is given the vault behaves exactly as the
 * legacy unbound version (used by tests).
 */
export function createVault(keyProvider: KeyProvider, rng: Rng = defaultRng, slot?: string) {
  const aad = slot === undefined ? undefined : new TextEncoder().encode(slot);

  async function readKey(): Promise<Uint8Array> {
    const key = await keyProvider.getKey();
    if (!(key instanceof Uint8Array) || key.length !== 32) {
      throw new Error('vault: key must be a 32-byte Uint8Array');
    }
    return key;
  }

  /** Encrypt any JSON-serializable value. Returns an opaque envelope string. */
  async function encryptJSON(value: unknown): Promise<string> {
    const key = await readKey();
    const nonce = await rng(NONCE_LEN);
    const plaintext = new TextEncoder().encode(JSON.stringify(value));
    const ciphertext = gcm(key, nonce, aad).encrypt(plaintext);
    return `${ENVELOPE_VERSION}.${b64encode(nonce)}.${b64encode(ciphertext)}`;
  }

  function parseEnvelope(envelope: string): { nonce: Uint8Array; ciphertext: Uint8Array } {
    const parts = envelope.split('.');
    if (parts.length !== 3 || parts[0] !== ENVELOPE_VERSION) {
      throw new Error('vault: malformed envelope');
    }
    const nonce = b64decode(parts[1]);
    const ciphertext = b64decode(parts[2]);
    if (nonce.length !== NONCE_LEN) throw new Error('vault: bad nonce');
    return { nonce, ciphertext };
  }

  /**
   * Decrypt an envelope. First tries with the slot AAD; if authentication
   * fails AND the vault is slot-bound, retries WITHOUT AAD so pre-AAD
   * envelopes keep working. `upgraded` is true when the caller should
   * re-encrypt (self-healing upgrade to a bound envelope).
   */
  async function decryptJSONWithUpgrade<T>(envelope: string): Promise<{ value: T; upgraded: boolean }> {
    const key = await readKey();
    const { nonce, ciphertext } = parseEnvelope(envelope);
    if (aad !== undefined) {
      try {
        const plaintext = gcm(key, nonce, aad).decrypt(ciphertext);
        return { value: JSON.parse(new TextDecoder().decode(plaintext)) as T, upgraded: false };
      } catch {
        // Auth failed with AAD: either tampering or a legacy envelope.
        // Fall through to the legacy path; it throws on real tampering.
      }
    }
    const plaintext = gcm(key, nonce).decrypt(ciphertext); // throws on auth failure
    return { value: JSON.parse(new TextDecoder().decode(plaintext)) as T, upgraded: aad !== undefined };
  }

  /** Decrypt an envelope. Throws on wrong key, tampering, or bad format. */
  async function decryptJSON<T>(envelope: string): Promise<T> {
    const { value } = await decryptJSONWithUpgrade<T>(envelope);
    return value;
  }

  return { encryptJSON, decryptJSON, decryptJSONWithUpgrade };
}
