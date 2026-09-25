/**
 * Tatkal Copilot — fill engine (L2).
 *
 * Builds a self-contained JS payload for injection into a WebView hosting
 * IRCTC's Tatkal booking page. The payload fills train / class / quota /
 * passenger fields at human pace and then STOPS. It never submits anything.
 *
 * Hard lines enforced here:
 *  - Total fill time respects the anti-bot floor from src/core/tatkalConfig.ts
 *    (defensive import + fallback below). Pacing-floor scaling (documented):
 *      floor(pax) = max(MIN_FILL_SECONDS_5PAX, PER_PAX_FLOOR_S * pax)
 *    i.e. max(4.2s, 0.84s per passenger). The published 4.2s figure was measured
 *    for 5 passengers; Tatkal caps at 4 per PNR, and 0.84*4 = 3.36s < 4.2s, so
 *    the binding floor stays 4.2s — slower is always safer against the tripwire.
 *  - Per-field gap >= 120ms with seeded jitter.
 *  - The ONLY submit path is window.__tatkalUserConfirm(), which the native
 *    side calls in response to an explicit user tap (after the user completes
 *    the Aadhaar OTP step themselves). The engine never calls it.
 *  - On an OTP screen the engine halts and emits OTP_REQUIRED.
 */

export interface PassengerInput {
  name: string;
  age: number;
  gender: string; // 'M' | 'F' | 'O' (mock uses a select)
  berthPref: string; // 'LB' | 'MB' | 'UB' | 'SL' | 'SU' | 'WS'
}

export interface FillPlan {
  trainNo: string;
  from: string;
  to: string;
  dateISO: string; // YYYY-MM-DD
  classCode: string; // '3A' | '2A' | 'SL' | ...
  quota: 'TATKAL';
  passengers: PassengerInput[];
}

export interface FieldAction {
  id: string; // DOM element id in the booking page
  kind: 'input' | 'select';
  value: string;
  label: string; // human-readable, used in the event log
}

export interface FillEvent {
  type: 'FILL_STARTED' | 'FIELD_FILLED' | 'FIELD_MISSING' | 'OTP_REQUIRED' | 'FILL_COMPLETE';
  /** ms, from the page's performance.now() clock — relative, used for pacing math */
  t: number;
  data: Record<string, unknown>;
}

export interface Alternate {
  trainNo: string;
  date: string;
  classCode: string;
  seatsAvailable: number;
  label: string; // raw row text, for display/debugging
}

// ---------------------------------------------------------------------------
// Config (defensive import per L2 contract)
// ---------------------------------------------------------------------------

// TODO(L2/L1): tatkalConfig.ts is the source of truth for these constants.
// If the config file is ever missing (or a key is absent), the safe fallback
// below stands. "Safe" here means SLOWER than the anti-bot floor — a missing
// config must never make the engine faster.
const FALLBACK_MIN_FILL_SECONDS_5PAX = 4.2;
const FALLBACK_PER_PAX_FLOOR_S = 0.84;

interface EngineTiming {
  minFillSeconds5Pax: number;
  perPaxFloorS: number;
}

function loadTiming(): EngineTiming {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const cfg = require('./tatkalConfig') as {
      MIN_FILL_SECONDS_5PAX?: unknown;
      PER_PAX_FLOOR_S?: unknown;
    };
    const a = cfg.MIN_FILL_SECONDS_5PAX;
    const b = cfg.PER_PAX_FLOOR_S;
    return {
      minFillSeconds5Pax:
        typeof a === 'number' && a > 0 ? a : FALLBACK_MIN_FILL_SECONDS_5PAX,
      perPaxFloorS: typeof b === 'number' && b > 0 ? b : FALLBACK_PER_PAX_FLOOR_S,
    };
  } catch {
    return {
      minFillSeconds5Pax: FALLBACK_MIN_FILL_SECONDS_5PAX,
      perPaxFloorS: FALLBACK_PER_PAX_FLOOR_S,
    };
  }
}

/** Minimum gap between two consecutive field fills (hard floor, ms). */
export const MIN_FIELD_GAP_MS = 120;

// ---------------------------------------------------------------------------
// Seeded PRNG (mulberry32) — deterministic jitter for tests
// ---------------------------------------------------------------------------

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// Field plan -> ordered actions
// ---------------------------------------------------------------------------

export function buildFieldActions(plan: FillPlan): FieldAction[] {
  const actions: FieldAction[] = [
    { id: 'trainNo', kind: 'input', value: plan.trainNo, label: 'train' },
    { id: 'fromStn', kind: 'input', value: plan.from, label: 'from' },
    { id: 'toStn', kind: 'input', value: plan.to, label: 'to' },
    { id: 'journeyDate', kind: 'input', value: plan.dateISO, label: 'date' },
    { id: 'classCode', kind: 'select', value: plan.classCode, label: 'class' },
    { id: 'quota', kind: 'select', value: plan.quota, label: 'quota' },
  ];
  plan.passengers.forEach((p, i) => {
    actions.push(
      { id: `pax${i}Name`, kind: 'input', value: p.name, label: `pax${i}.name` },
      { id: `pax${i}Age`, kind: 'input', value: String(p.age), label: `pax${i}.age` },
      { id: `pax${i}Gender`, kind: 'select', value: p.gender, label: `pax${i}.gender` },
      { id: `pax${i}Berth`, kind: 'select', value: p.berthPref, label: `pax${i}.berth` },
    );
  });
  return actions;
}

// ---------------------------------------------------------------------------
// Pacing: per-field gaps, every gap >= MIN_FIELD_GAP_MS, total >= floor.
// The floor scales with passenger count but never drops below the 5-pax
// published figure (slower is always safer against the tripwire).
// ---------------------------------------------------------------------------

/**
 * Pacing-floor scaling (the contract):
 *   floor(pax) = max(MIN_FILL_SECONDS_5PAX, PER_PAX_FLOOR_S * pax)
 * The 4.2s figure is the published anti-bot reference (measured at 5 pax).
 * Tatkal caps at 4 passengers/PNR; 0.84*4 = 3.36s < 4.2s, so for 4 pax the
 * floor remains 4.2s. The floor never scales DOWN below the published figure —
 * only up, for larger (non-Tatkal) passenger counts.
 */
export function requiredFloorMs(passengerCount: number): number {
  const t = loadTiming();
  const floorS = Math.max(
    t.minFillSeconds5Pax,
    t.perPaxFloorS * Math.max(1, passengerCount),
  );
  return Math.round(floorS * 1000);
}

export function computeFieldGaps(fieldCount: number, seed: number): number[] {
  if (fieldCount <= 0) return [];
  const pax = Math.max(1, Math.round((fieldCount - 6) / 4)); // 6 header fields + 4 per pax
  const floor = requiredFloorMs(pax);
  const rand = mulberry32(seed);
  const gaps: number[] = [];
  for (let i = 0; i < fieldCount; i++) {
    gaps.push(MIN_FIELD_GAP_MS + Math.floor(rand() * 180)); // 120–299ms jitter
  }
  // The verifier measures last-FIELD_FILLED minus first-FIELD_FILLED, which
  // excludes the initial GAPS[0] delay before the first field. Guarantee the
  // MEASURED total clears the floor: sum(gaps) - gaps[0] >= floor.
  const measuredTotal = (): number =>
    gaps.reduce((a, b) => a + b, 0) - gaps[0];
  const deficit = floor - measuredTotal();
  if (deficit > 0) {
    // Stretch: distribute the deficit evenly so every gap stays >= MIN_FIELD_GAP_MS.
    const per = Math.ceil(deficit / fieldCount);
    for (let i = 0; i < gaps.length; i++) gaps[i] += per;
  }
  return gaps;
}

// ---------------------------------------------------------------------------
// Script generation
// ---------------------------------------------------------------------------

export const CONFIRM_FN_NAME = '__tatkalUserConfirm';
const CONFIRM_START = '/*__TATKAL_CONFIRM_START__*/';
const CONFIRM_END = '/*__TATKAL_CONFIRM_END__*/';

export interface BuildOptions {
  /** Seed for pacing jitter. Fixed in tests, random-ish in production. */
  seed?: number;
}

export function buildFillScript(plan: FillPlan, opts: BuildOptions = {}): string {
  const seed = opts.seed ?? Math.floor(Math.random() * 2 ** 31);
  const actions = buildFieldActions(plan);
  const gaps = computeFieldGaps(actions.length, seed);
  const floorMs = requiredFloorMs(plan.passengers.length);

  // JSON-embedded data: no string interpolation of user values into code.
  const actionsJson = JSON.stringify(actions);
  const gapsJson = JSON.stringify(gaps);

  return `(function(){
"use strict";
var ACTIONS = ${actionsJson};
var GAPS = ${gapsJson};
var FLOOR_MS = ${floorMs};
var log = (window.__tatkalEventLog = window.__tatkalEventLog || []);
function post(type, data){
  var e = { type: type, t: Math.round(performance.now()), data: data || {} };
  log.push(e);
  try {
    if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
      window.ReactNativeWebView.postMessage(JSON.stringify(e));
    }
  } catch (err) { /* postMessage is best-effort; the log array is the record */ }
}
function otpVisible(){
  var s = document.getElementById('otpScreen');
  if (s && s.offsetParent !== null) return true;
  var i = document.getElementById('otpInput');
  return !!(i && i.offsetParent !== null);
}
var halted = false;
var otpAnnounced = false;
function onOtp(){
  if (otpAnnounced) return;
  otpAnnounced = true;
  halted = true;
  post('OTP_REQUIRED', {});
}
// Watch for the OTP screen appearing at ANY time (it can arrive after the
// user taps through to booking on the real site). We only observe and halt.
try {
  var obs = new MutationObserver(function(){ if (otpVisible()) onOtp(); });
  obs.observe(document.documentElement, { childList: true, subtree: true, attributes: true });
} catch (err) { /* observer optional; the pre-step check below is the guarantee */ }
function setField(a){
  var el = document.getElementById(a.id);
  if (!el) { post('FIELD_MISSING', { id: a.id, label: a.label }); return; }
  try { el.focus(); } catch (err) {}
  el.value = a.value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  post('FIELD_FILLED', { id: a.id, label: a.label });
}
var idx = 0;
function step(){
  if (halted) return;
  if (otpVisible()) { onOtp(); return; }
  if (idx >= ACTIONS.length) { post('FILL_COMPLETE', { fields: ACTIONS.length, floorMs: FLOOR_MS }); return; }
  setField(ACTIONS[idx]);
  idx += 1;
  setTimeout(step, GAPS[Math.min(idx, GAPS.length - 1)]);
}
${CONFIRM_START}
window.${CONFIRM_FN_NAME} = function(){
  // Called ONLY by native code in response to an explicit user tap, after the
  // user has completed the Aadhaar OTP step themselves. This is the single
  // permitted booking-submit path in the entire product.
  var btn = document.getElementById('bookNowBtn');
  if (btn) { btn.click(); }
};
${CONFIRM_END}
if (otpVisible()) { onOtp(); return; }
post('FILL_STARTED', { fields: ACTIONS.length, seed: ${seed}, floorMs: FLOOR_MS });
setTimeout(step, GAPS[0]);
})();`;
}

// ---------------------------------------------------------------------------
// No-auto-book invariant scanner (shared by Jest tests and the harness)
// ---------------------------------------------------------------------------

/**
 * Returns a list of violations found in `source` OUTSIDE the
 * __tatkalUserConfirm gate. Empty array = invariant holds.
 */
export function scanForAutobookViolations(source: string): string[] {
  const hits: string[] = [];
  const start = source.indexOf(CONFIRM_START);
  const end = source.indexOf(CONFIRM_END);
  let body = source;
  if (start !== -1 && end !== -1 && end > start) {
    body = source.slice(0, start) + source.slice(end + CONFIRM_END.length);
  } else {
    hits.push('confirm-gate markers missing — cannot verify submit isolation');
  }

  const forbidden: Array<[string, RegExp]> = [
    ['form.submit() call', /\.submit\s*\(/],
    ['requestSubmit() call', /\.requestSubmit\s*\(/],
    ['booking button reference', /bookNowBtn/],
    ['payment submit reference', /proceedToPayment|payNow|makePayment/i],
  ];
  for (const [name, re] of forbidden) {
    if (re.test(body)) hits.push(name);
  }

  // The gate itself must exist exactly once.
  const defs = source.split(`window.${CONFIRM_FN_NAME}`).length - 1;
  if (defs !== 1) hits.push(`confirm gate defined ${defs} times (expected exactly 1)`);

  return hits;
}

// ---------------------------------------------------------------------------
// Fallback: parse alternates from a "no seats" page snapshot
// ---------------------------------------------------------------------------

/**
 * Tolerant parser for the "seats unavailable" state. Understands the mock
 * markup (tr.altRow with data-* attributes) and falls back to loose text
 * scraping so minor markup drift doesn't silently return zero results.
 */
export function parseAlternates(domSnapshot: string): Alternate[] {
  const out: Alternate[] = [];
  const rowRe = /<tr[^>]*class=["'][^"']*altRow[^"']*["'][^>]*>([\s\S]*?)<\/tr>/gi;
  let m: RegExpExecArray | null;
  while ((m = rowRe.exec(domSnapshot)) !== null) {
    const rowHtml = m[0];
    const inner = m[1];
    const attr = (n: string): string => {
      const mm = new RegExp(`data-${n}\\s*=\\s*"([^"]*)"`, 'i').exec(rowHtml);
      return mm ? mm[1].trim() : '';
    };
    const text = inner
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    const trainNo = attr('train') || (/(\d{4,6})/.exec(text)?.[1] ?? '');
    if (!trainNo) continue; // not a real alternate row
    const seatsRaw = attr('seats');
    const seatsFromText = /(\d+)\s*seats?/i.exec(text)?.[1];
    out.push({
      trainNo,
      date: attr('date'),
      classCode: attr('class'),
      seatsAvailable: parseInt(seatsRaw || seatsFromText || '0', 10) || 0,
      label: text,
    });
  }
  return out;
}
