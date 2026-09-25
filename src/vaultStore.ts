/**
 * L4 — on-device storage layer.
 *
 * - Vault key: 32 random bytes from @noble/ciphers, stored in
 *   expo-secure-store under 'tatkal-vault-key' (base64). Generated once on
 *   first run; cached in memory afterwards. The key NEVER leaves the device
 *   and is never logged (hard line).
 * - Passenger list + trip list: encrypted with createVault().encryptJSON()
 *   from src/core/vault.ts and stored as opaque envelope strings. This
 *   module reuses the vault's crypto — it does not reimplement it.
 *
 * Storage keys are versioned ('-v1') so a future schema change can migrate.
 */
import * as SecureStore from 'expo-secure-store';
import { randomBytes } from '@noble/ciphers/utils.js';
import { createVault, type KeyProvider } from './core/vault';

const VAULT_KEY_ITEM = 'tatkal-vault-key';
const PASSENGERS_ITEM = 'tatkal-passengers-v1';
const TRIPS_ITEM = 'tatkal-trips-v1';
const PNRS_ITEM = 'tatkal-pnrs-v1';

export type Gender = 'M' | 'F' | 'O';

export interface Passenger {
  id: string;
  name: string;
  age: number;
  gender: Gender;
  berthPref: string; // 'LB' | 'MB' | 'UB' | 'SL' | 'SU' | 'WS'
}

export interface Trip {
  id: string;
  trainNo: string;
  from: string; // station code, e.g. 'NDLS'
  to: string; // station code, e.g. 'LKO'
  journeyDate: string; // YYYY-MM-DD
  classCode: string; // '3A' | '2A' | 'SL' | ...
  isAC: boolean;
  passengerIds: string[]; // refs into the passenger vault, max 4 (Tatkal PNR cap)
  createdAt: number;
}

/** A PNR the user wants to track after booking. */
export interface TrackedPnr {
  id: string;
  pnr: string; // exactly 10 digits (validated by isValidPnr)
  departureISO?: string; // ISO datetime for chart reminders, optional
  label?: string; // free text, e.g. 'NDLS → LKO'
  createdAt: number;
}

// ---------------------------------------------------------------------------
// base64 helpers (local copy — vault.ts keeps its own private pair)
// ---------------------------------------------------------------------------
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function bytesToB64(bytes: Uint8Array): string {
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

function b64ToBytes(s: string): Uint8Array {
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

// ---------------------------------------------------------------------------
// Key provider (the KeyProvider shape from src/core/vault.ts)
// ---------------------------------------------------------------------------
let cachedKey: Uint8Array | null = null;

/** Returns the KeyProvider used by every vault operation in the app. */
export function getVaultKeyProvider(): KeyProvider {
  return {
    getKey: async (): Promise<Uint8Array> => {
      if (cachedKey) return cachedKey;
      const stored = await SecureStore.getItemAsync(VAULT_KEY_ITEM);
      if (stored) {
        const bytes = b64ToBytes(stored);
        if (bytes.length !== 32) {
          // Fail closed: never derive or downgrade — the vault stays shut.
          throw new Error('vaultStore: stored vault key is not 32 bytes');
        }
        cachedKey = bytes;
      } else {
        const fresh = randomBytes(32);
        await SecureStore.setItemAsync(VAULT_KEY_ITEM, bytesToB64(fresh));
        cachedKey = fresh;
      }
      return cachedKey;
    },
  };
}

const vault = () => createVault(getVaultKeyProvider());

// ---------------------------------------------------------------------------
// Encrypted collections
// ---------------------------------------------------------------------------
export async function loadPassengers(): Promise<Passenger[]> {
  const envelope = await SecureStore.getItemAsync(PASSENGERS_ITEM);
  if (!envelope) return [];
  return vault().decryptJSON<Passenger[]>(envelope);
}

export async function savePassengers(list: Passenger[]): Promise<void> {
  const envelope = await vault().encryptJSON(list);
  await SecureStore.setItemAsync(PASSENGERS_ITEM, envelope);
}

export async function loadTrips(): Promise<Trip[]> {
  const envelope = await SecureStore.getItemAsync(TRIPS_ITEM);
  if (!envelope) return [];
  return vault().decryptJSON<Trip[]>(envelope);
}

export async function saveTrips(list: Trip[]): Promise<void> {
  const envelope = await vault().encryptJSON(list);
  await SecureStore.setItemAsync(TRIPS_ITEM, envelope);
}

export async function loadPnrs(): Promise<TrackedPnr[]> {
  const envelope = await SecureStore.getItemAsync(PNRS_ITEM);
  if (!envelope) return [];
  return vault().decryptJSON<TrackedPnr[]>(envelope);
}

export async function savePnrs(list: TrackedPnr[]): Promise<void> {
  const envelope = await vault().encryptJSON(list);
  await SecureStore.setItemAsync(PNRS_ITEM, envelope);
}

export function newId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
}
