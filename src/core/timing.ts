/**
 * Tatkal booking-window math. Pure functions, no I/O.
 * IST is UTC+5:30 with no DST, so we compute in UTC directly.
 * Rule source of truth lives in docs/IRCTC_RULES.md; numeric constants
 * come from src/core/tatkalConfig.ts (L1). This module takes the config
 * as a parameter so it stays testable and rule-change-proof.
 */

export interface TatkalConfig {
  /** Days before journey date the Tatkal window opens (excluding journey date). */
  openDaysBefore: number;
  /** Opening hour in IST for AC classes. */
  acOpenHourIST: number;
  /** Opening hour in IST for non-AC classes. */
  nonAcOpenHourIST: number;
}

const IST_OFFSET_MIN = 330; // +5:30, no DST

function parseJourneyDate(iso: string): { y: number; m: number; d: number } {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) throw new Error(`timing: bad journey date "${iso}", want YYYY-MM-DD`);
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) throw new Error(`timing: bad journey date "${iso}"`);
  // Validate real calendar date (catches 2026-02-30 etc.)
  const check = new Date(Date.UTC(y, mo - 1, d));
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d) {
    throw new Error(`timing: nonexistent date "${iso}"`);
  }
  return { y, m: mo, d };
}

/**
 * The exact instant the Tatkal window opens for a journey, as a Date (UTC instant).
 * E.g. journey 2026-10-02, AC → 2026-10-01T10:00:00+05:30.
 */
export function tatkalBookingOpen(journeyDateISO: string, isAC: boolean, cfg: TatkalConfig): Date {
  const { y, m, d } = parseJourneyDate(journeyDateISO);
  const hourIST = isAC ? cfg.acOpenHourIST : cfg.nonAcOpenHourIST;
  // Build the IST wall-clock instant, then express in UTC.
  const utcMillis =
    Date.UTC(y, m - 1, d - cfg.openDaysBefore, hourIST, 0, 0) - IST_OFFSET_MIN * 60_000;
  return new Date(utcMillis);
}

/** Milliseconds from `now` until the window opens (negative if already open). */
export function msUntilTatkalOpen(
  journeyDateISO: string,
  isAC: boolean,
  cfg: TatkalConfig,
  now: Date = new Date(),
): number {
  return tatkalBookingOpen(journeyDateISO, isAC, cfg).getTime() - now.getTime();
}
