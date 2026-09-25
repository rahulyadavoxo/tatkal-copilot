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
  const out: number[] = [];
  for (let i = 0; i < clean.length; i += 4) {
    const n =
      (B64.indexOf(clean[i]) << 18) |
      (B64.indexOf(clean[i + 1]) << 12) |
      ((clean[i + 2] === '=' ? 0 : B64.indexOf(clean[i + 2])) << 6) |
      (clean[i + 3] === '=' ? 0 : B64.indexOf(clean[i + 3]));
    out.push((n >> 16) & 255);
    if (clean[i + 2] !== '=') out.push((n >> 8) & 255);
    if (clean[i + 3] !== '=') out.push(n & 255);
  }
  return new Uint8Array(out);
}

export function createVault(keyProvider: KeyProvider) {
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
    const nonce = randomBytes(NONCE_LEN);
    const plaintext = new TextEncoder().encode(JSON.stringify(value));
    const ciphertext = gcm(key, nonce).encrypt(plaintext);
    return `${ENVELOPE_VERSION}.${b64encode(nonce)}.${b64encode(ciphertext)}`;
  }

  /** Decrypt an envelope. Throws on wrong key, tampering, or bad format. */
  async function decryptJSON<T>(envelope: string): Promise<T> {
    const key = await readKey();
    const parts = envelope.split('.');
    if (parts.length !== 3 || parts[0] !== ENVELOPE_VERSION) {
      throw new Error('vault: malformed envelope');
    }
    const nonce = b64decode(parts[1]);
    const ciphertext = b64decode(parts[2]);
    if (nonce.length !== NONCE_LEN) throw new Error('vault: bad nonce');
    const plaintext = gcm(key, nonce).decrypt(ciphertext); // throws on auth failure
    return JSON.parse(new TextDecoder().decode(plaintext)) as T;
  }

  return { encryptJSON, decryptJSON };
}
