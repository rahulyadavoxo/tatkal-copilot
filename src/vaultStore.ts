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
import * as Crypto from 'expo-crypto';
import { createVault, type KeyProvider, type Rng } from './core/vault';

const VAULT_KEY_ITEM = 'tatkal-vault-key';
// audit #30: ONE key for the app's lifetime — no rotation. The `v1` envelope
// tag versions the format, not the key. If the key ever leaks, the only
// remediation today is uninstall/reinstall (which generates a fresh key and
// loses the old data — audit #32). Rotation is future work, not designed in.
// audit #32: key + envelopes live in app-private SecureStore; uninstall wipes
// them with NO recovery. Users must re-enter everything after reinstall.
const PASSENGERS_ITEM = 'tatkal-passengers-v1';
const TRIPS_ITEM = 'tatkal-trips-v1';
const PNRS_ITEM = 'tatkal-pnrs-v1';
const CREDENTIALS_ITEM = 'tatkal-irctc-creds-v1';
const PREFS_ITEM = 'tatkal-prefs-v1';

export type Gender = 'M' | 'F' | 'O';

export interface Passenger {
  id: string;
  name: string;
  age: number;
  gender: Gender;
  berthPref: string; // 'LB' | 'MB' | 'UB' | 'SL' | 'SU' | 'WS'
  /** Meal choice for IRCTC's mandatory catering dropdown on premium trains
   *  ('Veg' | 'Non Veg' | 'Jain Meal' | 'Veg (Diabetic)' | 'Non Veg (Diabetic)').
   *  Optional — older saved passengers simply default to 'Veg' at fill time. */
  mealPref?: string;
}

export interface Trip {
  id: string;
  trainNo: string;
  from: string; // station code, e.g. 'NDLS'
  to: string; // station code, e.g. 'LKO'
  journeyDate: string; // YYYY-MM-DD
  classCode: string; // '3A' | '2A' | 'SL' | ...
  quota: string; // IRCTC quota, e.g. 'TATKAL' (see IRCTC_QUOTAS)
  isAC: boolean;
  passengerIds: string[]; // refs into the passenger vault, max 4 (Tatkal PNR cap)
  contactMobile: string; // contact-details mobile, filled into IRCTC's form
  travelInsurance: boolean; // true = take travel insurance (IRCTC default)
  /** "Consider for auto upgradation" — ticked only when the user selected it
   *  in trip setup; otherwise the script leaves IRCTC's default untouched. */
  autoUpgradation: boolean;
  /** Payment-mode choice for the review page: 'default' leaves IRCTC's
   *  selection alone; 'cards' picks the Cards/NetBanking/Wallets/UPI option;
   *  'bhim' picks BHIM/UPI. The user always pays by hand afterwards. */
  paymentMode: PaymentMode;
  /** Payment-method choice for IRCTC's "Payment Methods" page (after the
   *  Review Journey page): 'default' leaves IRCTC's selection alone. */
  paymentMethod: PaymentMethod;
  /** Payment-provider choice for the provider list (PayU / Paytm / PhonePe /
   *  Razorpay): 'default' leaves IRCTC's selection alone, then the script
   *  taps "Pay & Book" and STOPS — the user pays by hand on the gateway. */
  paymentProvider: PaymentProvider;
  createdAt: number;
}

/**
 * The passengers a trip will actually book.
 *
 * A trip uses its explicitly linked passengers when they still exist in the
 * vault (the TripSetup picker). Otherwise it falls back to the saved
 * passengers (Tatkal PNR cap: 4) — so a traveller saved once is usable on
 * every trip without re-linking, and deleting a passenger can't strand a
 * trip on a dangling id.
 */
export function resolveTripPassengers(trip: Trip, all: Passenger[]): Passenger[] {
  const linked = trip.passengerIds
    .map((id) => all.find((p) => p.id === id))
    .filter((p): p is Passenger => !!p);
  if (linked.length > 0) return linked;
  return all.slice(0, 4);
}

/** Payment-mode preference saved on the trip (review-page radio). */
export type PaymentMode = 'default' | 'cards' | 'bhim';

export const PAYMENT_MODE_LABELS: Record<PaymentMode, string> = {
  default: "IRCTC default (don't change)",
  cards: 'Cards / NetBanking / Wallets / UPI',
  bhim: 'BHIM / UPI',
};

/** Payment-method preference saved on the trip (IRCTC "Payment Methods" page). */
export type PaymentMethod = 'default' | 'ipay' | 'multiple' | 'bhimUssd';

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  default: "IRCTC default (don't change)",
  ipay: 'IRCTC iPay (Card / Debit Card / UPI)',
  multiple: 'Multiple Payment Service',
  bhimUssd: 'BHIM / UPI / USSD',
};

/** Payment-provider preference saved on the trip (provider list page). */
export type PaymentProvider = 'default' | 'payu' | 'paytm' | 'phonepe' | 'razorpay';

export const PAYMENT_PROVIDER_LABELS: Record<PaymentProvider, string> = {
  default: "IRCTC default (don't change)",
  payu: 'PayU',
  paytm: 'Paytm',
  phonepe: 'PhonePe',
  razorpay: 'Razorpay',
};

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
  if (clean.length === 0 || clean.length % 4 !== 0) {
    throw new Error('vaultStore: malformed envelope (bad base64 length)');
  }
  const out: number[] = [];
  for (let i = 0; i < clean.length; i += 4) {
    const a = B64.indexOf(clean[i]);
    const b = B64.indexOf(clean[i + 1]);
    const c = clean[i + 2] === '=' ? 0 : B64.indexOf(clean[i + 2]);
    const d = clean[i + 3] === '=' ? 0 : B64.indexOf(clean[i + 3]);
    if (a < 0 || b < 0 || c < 0 || d < 0) {
      throw new Error('vaultStore: malformed envelope (bad base64 data)');
    }
    const n = (a << 18) | (b << 12) | (c << 6) | d;
    out.push((n >> 16) & 255);
    if (clean[i + 2] !== '=') out.push((n >> 8) & 255);
    if (clean[i + 3] !== '=') out.push(n & 255);
  }
  return new Uint8Array(out);
}

// ---------------------------------------------------------------------------
// Key provider (the KeyProvider shape from src/core/vault.ts)
//
// SECURITY BOUNDARY (audit #34): the 32-byte key is generated once from
// expo-crypto's native CSPRNG and stored in expo-secure-store. There is NO
// KDF and NO passphrase/PIN/biometric gate: whoever holds the unlocked
// device (or a rooted device) gets the key. The real boundary is the device
// unlock + the OS keystore — not anything the user knows or is. An app lock
// (PIN/biometric) is a PENDING PRODUCT DECISION (audit #35), deliberately
// not built unprompted.
// ---------------------------------------------------------------------------
let cachedKey: Uint8Array | null = null; // audit #31: raw key stays in process memory for the app's lifetime (accepted tradeoff for speed)

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
        // Native secure RNG (expo-crypto). noble's randomBytes needs
        // crypto.getRandomValues, which does not exist on Hermes — using it
        // here silently broke every save on real devices (2026-09-26).
        const fresh = await Crypto.getRandomBytesAsync(32);
        await SecureStore.setItemAsync(VAULT_KEY_ITEM, bytesToB64(fresh));
        cachedKey = fresh;
      }
      return cachedKey;
    },
  };
}

// Device RNG: expo-crypto's native secure random (works on Hermes).
const deviceRng: Rng = (n: number) => Crypto.getRandomBytesAsync(n);

// Each collection gets its own slot-bound vault: the slot name is AES-GCM
// AAD, so an envelope transplanted into another slot fails authentication
// (audit #29). `loadSlot` self-heals legacy (pre-AAD) envelopes by
// re-encrypting them on first read.
const vaultFor = (slot: string) => createVault(getVaultKeyProvider(), deviceRng, slot);

async function loadSlot<T>(slot: string): Promise<T | null> {
  const envelope = await SecureStore.getItemAsync(slot);
  if (!envelope) return null;
  const v = vaultFor(slot);
  const { value, upgraded } = await v.decryptJSONWithUpgrade<T>(envelope);
  if (upgraded) {
    await SecureStore.setItemAsync(slot, await v.encryptJSON(value));
  }
  return value;
}

// ---------------------------------------------------------------------------
// Encrypted collections
// ---------------------------------------------------------------------------
export async function loadPassengers(): Promise<Passenger[]> {
  return (await loadSlot<Passenger[]>(PASSENGERS_ITEM)) ?? [];
}

export async function savePassengers(list: Passenger[]): Promise<void> {
  const envelope = await vaultFor(PASSENGERS_ITEM).encryptJSON(list);
  await SecureStore.setItemAsync(PASSENGERS_ITEM, envelope);
}

export async function loadTrips(): Promise<Trip[]> {
  return (await loadSlot<Trip[]>(TRIPS_ITEM)) ?? [];
}

export async function saveTrips(list: Trip[]): Promise<void> {
  const envelope = await vaultFor(TRIPS_ITEM).encryptJSON(list);
  await SecureStore.setItemAsync(TRIPS_ITEM, envelope);
}

export async function loadPnrs(): Promise<TrackedPnr[]> {
  return (await loadSlot<TrackedPnr[]>(PNRS_ITEM)) ?? [];
}

export async function savePnrs(list: TrackedPnr[]): Promise<void> {
  const envelope = await vaultFor(PNRS_ITEM).encryptJSON(list);
  await SecureStore.setItemAsync(PNRS_ITEM, envelope);
}

export function newId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
}

// ---------------------------------------------------------------------------
// IRCTC credentials — encrypted with the same AES-256-GCM vault.
// The user types these into the app's own IRCTC-account screen; they are
// filled into IRCTC's official login page only, never logged, never sent
// anywhere else, and the assistant never sees them.
// ---------------------------------------------------------------------------
export interface IrctcCredentials {
  username: string;
  password: string;
}

export async function saveIrctcCredentials(creds: IrctcCredentials): Promise<void> {
  const envelope = await vaultFor(CREDENTIALS_ITEM).encryptJSON(creds);
  await SecureStore.setItemAsync(CREDENTIALS_ITEM, envelope);
}

export async function loadIrctcCredentials(): Promise<IrctcCredentials | null> {
  return loadSlot<IrctcCredentials>(CREDENTIALS_ITEM);
}

export async function clearIrctcCredentials(): Promise<void> {
  await SecureStore.deleteItemAsync(CREDENTIALS_ITEM);
}

// ---------------------------------------------------------------------------
// Preferences — small settings (language choice), also encrypted.
// ---------------------------------------------------------------------------
export type AppLanguage = 'en' | 'hi';

export interface Prefs {
  language: AppLanguage; // IRCTC site language the app auto-selects
}

export async function loadPrefs(): Promise<Prefs> {
  try {
    const p = await loadSlot<Prefs>(PREFS_ITEM);
    return p && (p.language === 'hi' || p.language === 'en') ? p : { language: 'en' };
  } catch {
    return { language: 'en' };
  }
}

export async function savePrefs(prefs: Prefs): Promise<void> {
  const envelope = await vaultFor(PREFS_ITEM).encryptJSON(prefs);
  await SecureStore.setItemAsync(PREFS_ITEM, envelope);
}
