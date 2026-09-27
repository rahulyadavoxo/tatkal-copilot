/**
 * Tatkal Copilot — core IRCTC rule constants.
 *
 * Every constant cites its source line in docs/IRCTC_RULES.md.
 * If IRCTC changes a rule, ONLY this file should change.
 * Last verified: 2026-09-26 (see docs/IRCTC_RULES.md §7 watch list).
 */

/** Tatkal opens this many days before the journey date (excluding the
 *  date of journey, from the train's originating station).
 *  Source: docs/IRCTC_RULES.md §1 */
export const TATKAL_OPEN_DAYS_BEFORE = 1;

/** Tatkal window opens 10:00 IST for AC classes (2A/3A/CC/EC/3E).
 *  Source: docs/IRCTC_RULES.md §1 */
export const AC_OPEN_HOUR_IST = 10;
export const AC_OPEN_MINUTE_IST = 0;

/** Tatkal window opens 11:00 IST for non-AC classes (SL/FC/2S).
 *  Source: docs/IRCTC_RULES.md §1 */
export const NONAC_OPEN_HOUR_IST = 11;
export const NONAC_OPEN_MINUTE_IST = 0;

/** AC classes eligible for Tatkal. First AC is excluded.
 *  Source: docs/IRCTC_RULES.md §1 */
export const TATKAL_AC_CLASSES = ['2A', '3A', 'CC', 'EC', '3E'] as const;

/** Non-AC classes eligible for Tatkal.
 *  Source: docs/IRCTC_RULES.md §1 */
export const TATKAL_NONAC_CLASSES = ['SL', 'FC', '2S'] as const;

/** Full class list shown in IRCTC's search-form class dropdown, in the
 *  order the user asked for (from their IRCTC app screenshot 2026-09-27).
 *  This is the trip-setup selector list; the TATKAL_*_CLASSES constants
 *  above remain the Tatkal-eligibility rule source. */
export const IRCTC_CLASSES = [
  'All Classes',
  'EA',
  '1A',
  'EV',
  'EC',
  '2A',
  'FC',
  '3A',
  '3E',
  'VC',
  'CC',
  'SL',
  'VS',
  '2S',
] as const;

/** AC classes among IRCTC_CLASSES (Vistadome EV/VC/VS and Anubhuti EA are
 *  air-conditioned coaches). Used only for the Tatkal countdown timing:
 *  AC opens 10:00 IST, non-AC 11:00 IST.
 *  'All Classes' and any unknown code resolve to AC (the earlier 10:00
 *  window) — being ready an hour early is harmless, missing the 10:00
 *  window is not. */
const AC_CLASS_SET: ReadonlySet<string> = new Set([
  'EA',
  '1A',
  'EV',
  'EC',
  '2A',
  '3A',
  '3E',
  'VC',
  'CC',
  'VS',
]);
const NON_AC_CLASS_SET: ReadonlySet<string> = new Set(['FC', 'SL', '2S']);

export function isAcClass(classCode: string): boolean {
  if (NON_AC_CLASS_SET.has(classCode)) return false;
  return true; // AC set, 'All Classes', or unknown — earliest countdown wins
}

/** Quota options shown on IRCTC's search form (user screenshot 2026-09-27:
 *  GENERAL, LADIES, LOWER BERTH/SR.CITIZEN, PERSON WITH DISABILITY,
 *  DUTY PASS, TATKAL, PREMIUM TATKAL). */
export const IRCTC_QUOTAS = [
  'GENERAL',
  'LADIES',
  'LOWER BERTH/SR.CITIZEN',
  'PERSON WITH DISABILITY',
  'DUTY PASS',
  'TATKAL',
  'PREMIUM TATKAL',
] as const;

/** True only for the two quotas that open in a timed Tatkal window
 *  (10:00 AC / 11:00 non-AC). Every other quota books anytime — no
 *  countdown, no FIRE wait. */
export function isTatkalQuota(quota: string): boolean {
  const q = (quota || '').trim().toUpperCase();
  return q === 'TATKAL' || q === 'PREMIUM TATKAL';
}

/** Max passengers per Tatkal PNR.
 *  Source: docs/IRCTC_RULES.md §1/§6 (conflicts with 5-pax harness
 *  assumption — harness must cover 4-pax case; see §6). */
export const MAX_PASSENGERS_PER_TATKAL_PNR = 4;

/** Agents barred from opening-day Tatkal during the first 30 minutes.
 *  Source: docs/IRCTC_RULES.md §1 */
export const AGENT_BLOCK_AC = { startMin: 0, endMin: 30 } as const; // 10:00–10:30
export const AGENT_BLOCK_NONAC = { startMin: 0, endMin: 30 } as const; // 11:00–11:30

/** Online Tatkal restricted to Aadhaar-authenticated IRCTC accounts since.
 *  Source: docs/IRCTC_RULES.md §2 (PIB PRID 2135694) */
export const AADHAAR_ACCOUNT_MANDATE_SINCE = '2025-07-01';

/** Aadhaar-based OTP authentication mandatory per Tatkal booking since.
 *  OTP goes to the Aadhaar-linked mobile (UIDAI), required on every
 *  booking even for already-verified accounts.
 *  Source: docs/IRCTC_RULES.md §2 (PIB PRID 2135694) */
export const OTP_MANDATE_SINCE = '2025-07-15';

/** OTP scope: required once per booking, not once per session.
 *  Source: docs/IRCTC_RULES.md §2 */
export const OTP_SCOPE = 'per-booking' as const;

/**
 * Anti-bot tripwire: filling 5 passengers' details in under this many
 * seconds is flagged as bot-like (24h block risk).
 * THE FILL ENGINE MUST STAY ABOVE THIS FLOOR (with margin).
 * Source: docs/IRCTC_RULES.md §3 (the420.in, patnapress.com)
 */
export const MIN_FILL_SECONDS_5PAX = 4.2;

/**
 * Per-passenger pacing floor derived from the published 4.2s/5-pax figure.
 * Engine target: total fill time >= max(MIN_FILL_SECONDS_5PAX, PER_PAX_FLOOR_S * pax).
 * Source: docs/IRCTC_RULES.md §3, §6
 */
export const PER_PAX_FLOOR_S = 0.84;

/** > this many logins/logouts within 30 min from one ID → 24h block.
 *  Source: docs/IRCTC_RULES.md §3 */
export const MAX_LOGINS_PER_30MIN = 5;

/** > this many enquiries in one session during peak windows → auto logout.
 *  Source: docs/IRCTC_RULES.md §3 */
export const SESSION_ENQUIRY_LIMIT_PEAK = 25;

/** One ticket per session during peak (return/onward journey excepted).
 *  Source: docs/IRCTC_RULES.md §3 */
export const BOOKINGS_PER_SESSION_PEAK = 1;

/** Sept 2026 crackdown scale (announced 11 Sept 2026).
 *  Source: docs/IRCTC_RULES.md §3 (The Hindu) */
export const CRACKDOWN_DEACTIVATED_IDS_CRORE = 3.04;
export const CRACKDOWN_SUSPENDED_IDS_CRORE = 6.33;

/** RPF tout arrests since 2021 (newer figure; conflicts with older
 *  13,580/3.5yr minister reply — see docs/IRCTC_RULES.md §6).
 *  Source: docs/IRCTC_RULES.md §3 (Times of India) */
export const TOUT_ARRESTS_SINCE_2021 = 22676;

/**
 * Legal lane: Karnataka HC (Justice M. Nagaprasanna, 6 Sept 2024) quashed
 * S.143 Railways Act proceedings against the Tatkalforsure auto-fill
 * extension developer — pure form auto-fill is not "procuring/supplying"
 * tickets. Does NOT override IRCTC ToS enforcement.
 * Source: docs/IRCTC_RULES.md §4 (LiveLaw)
 */
export const LEGAL_PRECEDENT = {
  case: 'Gaurav Dhake v. Union of India (Tatkalforsure)',
  court: 'Karnataka High Court',
  date: '2024-09-06',
  holding: 'auto-fill extension is not procuring/supplying tickets u/s 143 Railways Act',
  limit: 'no shield against IRCTC account-level anti-bot enforcement',
} as const;
