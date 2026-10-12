/**
 * Shared per-stage decision logic: WHICH option each booking stage picks.
 *
 * Both booking paths read their choices from here so they can never drift:
 *  - the in-app WebView engines (prebook / postSearch / fill / review /
 *    payment) embed these values into their injected scripts, and
 *  - the Chrome path (src/native/autofillData.ts -> TatkalTapService.kt)
 *    ships them to the accessibility engine as fill data + choreography.
 *
 * Pure data + pure functions only (no react-native import), so the engines,
 * the native builder and the Jest suite can all import it.
 */
import type { TatkalConfig } from './timing';
import { tatkalBookingOpen } from './timing';
import {
  AC_OPEN_HOUR_IST,
  NONAC_OPEN_HOUR_IST,
  TATKAL_OPEN_DAYS_BEFORE,
  isAcClass,
  isTatkalQuota,
} from './tatkalConfig';

// ------------------------------------------------------------------
// Stage 1: login / language
// ------------------------------------------------------------------

/** The language alert's buttons, exactly as IRCTC labels them. */
export function languageButtonText(language: 'en' | 'hi' | string): string {
  return language === 'hi' ? 'हिंदी' : 'English';
}

// ------------------------------------------------------------------
// Stage 2: search form
// ------------------------------------------------------------------

/** Class codes IRCTC shows as tabs / in "(XX)" class boxes. */
export const KNOWN_CLASS_CODES = [
  '1A', '2A', '3A', 'SL', '2S', 'CC', 'EC', 'FC', '3E', 'EA', 'EV', 'VC', 'VS',
] as const;

/** Quota labels the quota dropdown can display (prebook's value finder). */
export const QUOTA_VALUE_TEXTS = [
  'general', 'ladies', 'lower berth/sr.citizen', 'person with disability',
  'duty pass', 'tatkal', 'premium tatkal',
] as const;

/** Labels the class dropdown can display before a class is picked. */
export const CLASS_VALUE_TEXTS = ['all classes'] as const;

/** Class dropdown preference order: the trip's class, else "All Classes". */
export function classDropdownWanted(classCode: string): string[] {
  const c = (classCode || '').trim();
  if (!c || /^all(\s+classes)?$/i.test(c)) return ['All Classes'];
  return [c, 'All Classes'];
}

/**
 * True when a dropdown's displayed text shows `want`: an exact match, or the
 * parenthesised code ("ac 3 tier (3a)" for "3A"). A plain substring is NOT
 * enough: "premium tatkal" contains "tatkal".
 */
export function dropdownDisplayMatches(displayed: string, want: string): boolean {
  const d = (displayed || '').trim().toLowerCase();
  const w = (want || '').trim().toLowerCase();
  if (!w) return false;
  return d === w || d.indexOf('(' + w + ')') >= 0;
}

// ------------------------------------------------------------------
// Stage 3: train list
// ------------------------------------------------------------------

/** Availability marker words inside the date/availability box. */
export const AVAILABILITY_MARKERS = ['available', 'waiting', 'wl', 'rac', 'regret'] as const;

/**
 * The one popup either path may answer: IRCTC's station-mismatch
 * confirmation ("You searched trains from DTO to NDLS ... but booking from
 * DTO to ANVT. Do you want to continue with it?"). Any other dialog halts.
 */
export const STATION_MISMATCH = {
  prompt: 'do you want to continue',
  markers: ['booking from', 'searched trains', 'boarding'],
} as const;

export function isStationMismatchText(text: string): boolean {
  const t = (text || '').toLowerCase();
  if (t.indexOf(STATION_MISMATCH.prompt) < 0) return false;
  return STATION_MISMATCH.markers.some((m) => t.indexOf(m) >= 0);
}

/** Affirm-button labels accepted on that popup (after stripping icons). */
export const POPUP_AFFIRM_TEXTS = ['yes', 'ok'] as const;

// ------------------------------------------------------------------
// Stage 4: passengers
// ------------------------------------------------------------------

export function genderOptionText(gender: string): string[] {
  const g = (gender || '').toUpperCase();
  if (g === 'F') return ['Female'];
  if (g === 'O') return ['Other', 'Transgender'];
  return ['Male'];
}

export function berthOptionText(berthPref: string): string[] {
  switch ((berthPref || '').toUpperCase()) {
    case 'LB': return ['Lower'];
    case 'MB': return ['Middle'];
    case 'UB': return ['Upper'];
    case 'SL': return ['Side Lower'];
    case 'SU': return ['Side Upper'];
    case 'WS': return ['Window Side'];
    default: return ['No Preference'];
  }
}

/** Nationality: IRCTC defaults to India; the app never picks anything else. */
export const DEFAULT_NATIONALITY = 'India';

/** Default meal for the catering dropdown on premium trains. */
export const DEFAULT_MEAL = 'Veg';

/** Travel-insurance radio label for the trip's choice. */
export function insuranceOptionText(travelInsurance: boolean): string[] {
  return travelInsurance ? ['Yes, and I accept'] : ["No, I don't want"];
}

/** Auto-upgradation checkbox captions. Ticked only when the trip asks. */
export const AUTO_UPGRADE_LABELS = ['Consider for Auto Upgradation', 'Auto Upgradation'] as const;

// ------------------------------------------------------------------
// Stage 5: review (co-branded card + payment mode)
// ------------------------------------------------------------------

/** Section text that marks the co-branded card question's "Skip" radio. */
export const COBRAND_SECTION_MARKERS = [
  'co-brand', 'loyalty', 'reward', 'pay less, earn more', 'sbi card',
] as const;

export type PaymentModeChoice = 'default' | 'cards' | 'bhim';

/**
 * Tokens that must ALL appear in the payment-mode option's own text.
 * null = 'default': leave IRCTC's selection untouched.
 */
export function paymentModeTokens(mode: string): string[] | null {
  if (mode === 'bhim') return ['bhim', 'upi'];
  if (mode === 'cards') return ['credit', 'debit'];
  return null;
}

// ------------------------------------------------------------------
// Stage 6: payment methods + provider
// ------------------------------------------------------------------

export type PaymentMethodKey = 'default' | 'ipay' | 'multiple' | 'bhimUssd';
export type PaymentProviderKey = 'default' | 'payu' | 'paytm' | 'phonepe' | 'razorpay';

/** Regex source (case-insensitive) for each Payment Methods row. */
export const PAYMENT_METHOD_PATTERNS: Record<Exclude<PaymentMethodKey, 'default'>, string> = {
  ipay: 'irctc\\s*ipay',
  multiple: 'multiple payment service',
  bhimUssd: 'bhim',
};

export function paymentMethodPattern(method: string): string | null {
  return (PAYMENT_METHOD_PATTERNS as Record<string, string>)[method] ?? null;
}

/** The provider list only exists on the Multiple Payment Service flow. */
export function providerApplies(method: string, provider: string): boolean {
  if (!provider || provider === 'default') return false;
  return method !== 'ipay' && method !== 'bhimUssd';
}

// ------------------------------------------------------------------
// Tatkal timing
// ------------------------------------------------------------------

export const TATKAL_TIMING_CFG: TatkalConfig = {
  openDaysBefore: TATKAL_OPEN_DAYS_BEFORE,
  acOpenHourIST: AC_OPEN_HOUR_IST,
  nonAcOpenHourIST: NONAC_OPEN_HOUR_IST,
};

/**
 * Epoch ms when the trip's Tatkal window opens (the moment CountdownScreen's
 * FIRE button enables), or null for a non-Tatkal quota / bad date. Uses the
 * same rule as the countdown: trip.isAC when present, else the class.
 */
export function tatkalOpenAtMs(trip: {
  quota: string;
  journeyDate: string;
  classCode: string;
  isAC?: boolean;
}): number | null {
  if (!isTatkalQuota(trip.quota)) return null;
  try {
    const ac = typeof trip.isAC === 'boolean' ? trip.isAC : isAcClass(trip.classCode);
    return tatkalBookingOpen(trip.journeyDate, ac, TATKAL_TIMING_CFG).getTime();
  } catch {
    return null;
  }
}
