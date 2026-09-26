/**
 * Tatkal Copilot — fill engine (L2).
 *
 * Builds a self-contained JS payload for injection into a WebView hosting
 * IRCTC's Tatkal passenger-details page. The payload fills passenger fields
 * at human pace, ticks the "Consider for auto upgradation" checkbox (the
 * user's stated preference), fills the contact mobile number and the travel
 * insurance choice, and then STOPS. It never submits anything and never
 * clicks any of IRCTC's navigation buttons (Continue/Book/Pay) — the user
 * always taps those themselves on IRCTC's page.
 *
 * FIELD REPORT 2026-09-26: the first version located fields by DOM ids from
 * a hand-built mock (trainNo, pax0Name, …). IRCTC's real Angular page uses
 * completely different ids, so every field reported FIELD_MISSING on-device.
 * The locator is now human-like and multi-strategy: for each field it tries
 *   1. a known id (keeps the original mock working),
 *   2. placeholder / aria-label / name / formControlName substring match,
 *   3. visible <label>/caption text match,
 * and for dropdowns it handles native <select>, Angular Material mat-select,
 * and PrimeNG p-dropdown widgets (IRCTC's stack has used all three across
 * redesigns), matching options by visible text. Passenger blocks are indexed
 * in document order (pax0 = first "Full Name as per Govt. ID" input, …); the
 * "+ Add Passenger" button is clicked (by visible text) to create blocks for
 * pax1+.
 *
 * Hard lines enforced here:
 *  - Total fill time respects the anti-bot floor from src/core/tatkalConfig.ts
 *    (defensive import + fallback below). Pacing-floor scaling (documented):
 *      floor(pax) = max(MIN_FILL_SECONDS_5PAX, PER_PAX_FLOOR_S * pax)
 *    i.e. max(4.2s, 0.84s per passenger). The published 4.2s figure was measured
 *    for 5 passengers; Tatkal caps at 4 per PNR, and 0.84*4 = 3.36s < 4.2s, so
 *    the binding floor stays 4.2s — slower is always safer against the tripwire.
 *  - Per-field gap >= 120ms with seeded jitter.
 *  - The script contains ZERO submit capability: no form.submit(), no
 *    requestSubmit(), no reference to any book/continue/pay button, anywhere.
 *    scanForAutobookViolations() asserts this on the whole script.
 *  - On an OTP screen the engine halts and emits OTP_REQUIRED.
 */

export interface PassengerInput {
  name: string;
  age: number;
  gender: string; // 'M' | 'F' | 'O'
  berthPref: string; // 'LB' | 'MB' | 'UB' | 'SL' | 'SU' | 'NP'
}

export interface FillPlan {
  trainNo: string;
  from: string;
  to: string;
  dateISO: string; // YYYY-MM-DD
  classCode: string; // '3A' | '2A' | 'SL' | ...
  quota: 'TATKAL';
  /** IRCTC "Consider for auto upgradation" checkbox — the fill ticks it
   *  (the user's stated preference; IRCTC defaults it on anyway). */
  autoUpgradation: boolean;
  /** Contact-details mobile number (IRCTC usually prefills it from the
   *  profile; the fill sets it only when the field is present and empty). */
  contactMobile: string;
  /** Travel-insurance radio: true = "Yes, and I accept the terms &
   *  conditions", false = "No, I don't want travel insurance". */
  travelInsurance: boolean;
  passengers: PassengerInput[];
}

/**
 * How to find one field on IRCTC's page, in priority order:
 *  1. id — a known DOM id (original mock / regression path),
 *  2. attrText — substrings matched against placeholder, aria-label, name,
 *     formControlName, id and className,
 *  3. labelText — substrings matched against visible label/caption text.
 * paxIndex selects the Nth matching control in document order (passenger
 * blocks render sequentially, so pax1's age = 2nd age-like input).
 */
export interface FieldLocator {
  id?: string;
  attrText?: string[];
  labelText?: string[];
  paxIndex?: number;
}

export interface FieldAction {
  kind: 'input' | 'select' | 'checkbox' | 'radio' | 'addPassenger';
  value: string;
  label: string;
  locator: FieldLocator;
  /** For select/radio: visible-text candidates for the desired option. */
  optionText?: string[];
}

export interface FillEvent {
  type: 'FILL_STARTED' | 'FIELD_FILLED' | 'FIELD_MISSING' | 'OTP_REQUIRED' | 'FILL_COMPLETE' | 'FORM_PROBE_RESULT';
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
// Visible-text option maps (IRCTC's real dropdown labels, from device
// screenshots 2026-09-26). Matching is by visible text, never by value.
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Field plan -> ordered actions (passenger-details page only)
// ---------------------------------------------------------------------------

export function buildFieldActions(plan: FillPlan): FieldAction[] {
  const actions: FieldAction[] = [];
  plan.passengers.forEach((p, i) => {
    if (i > 0) {
      // The real page starts with one passenger block; extra blocks are
      // created by tapping "+ Add Passenger".
      actions.push({
        kind: 'addPassenger',
        value: '',
        label: `add-passenger-${i}`,
        locator: { labelText: ['Add Passenger'] },
      });
    }
    actions.push(
      {
        kind: 'input',
        value: p.name,
        label: `pax${i}.name`,
        locator: {
          id: `pax${i}Name`,
          attrText: ['Full Name as per Govt'],
          labelText: ['Full Name'],
          paxIndex: i,
        },
      },
      {
        kind: 'input',
        value: String(p.age),
        label: `pax${i}.age`,
        locator: {
          id: `pax${i}Age`,
          attrText: ['Age'],
          labelText: ['Age'],
          paxIndex: i,
        },
      },
      {
        kind: 'select',
        value: p.gender,
        label: `pax${i}.gender`,
        optionText: genderOptionText(p.gender),
        locator: {
          id: `pax${i}Gender`,
          attrText: ['Gender'],
          labelText: ['Gender'],
          paxIndex: i,
        },
      },
      {
        kind: 'select',
        value: p.berthPref,
        label: `pax${i}.berth`,
        optionText: berthOptionText(p.berthPref),
        locator: {
          id: `pax${i}Berth`,
          attrText: ['Berth', 'Preference'],
          labelText: ['Berth', 'Preference'],
          paxIndex: i,
        },
      },
    );
  });
  // Other-preference: auto-upgradation checkbox, ticked per the plan.
  actions.push({
    kind: 'checkbox',
    value: plan.autoUpgradation ? 'on' : 'off',
    label: 'auto-upgradation',
    locator: {
      id: 'autoUpgradation',
      labelText: ['Consider for Auto Upgradation', 'Auto Upgradation'],
    },
  });
  if (plan.contactMobile) {
    actions.push({
      kind: 'input',
      value: plan.contactMobile,
      label: 'contact-mobile',
      locator: {
        id: 'contactMobile',
        attrText: ['Mobile Number'],
        labelText: ['Mobile Number'],
      },
    });
  }
  actions.push({
    kind: 'radio',
    value: plan.travelInsurance ? 'yes' : 'no',
    label: 'travel-insurance',
    optionText: plan.travelInsurance
      ? ['Yes, and I accept']
      : ["No, I don't want"],
    locator: { labelText: ['Travel Insurance'] },
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

export function computeFieldGaps(
  fieldCount: number,
  seed: number,
  passengerCount = 1,
): number[] {
  if (fieldCount <= 0) return [];
  const floor = requiredFloorMs(passengerCount);
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
// No-auto-book invariant scanner (shared by Jest tests and the harness)
//
// There is no confirm gate anymore: the injected script is simply incapable
// of submitting. The ONLY permitted clicks are on form widgets (inputs,
// dropdown options, radio labels, checkboxes) and the "+ Add Passenger"
// button that creates extra passenger blocks. IRCTC's own Continue / Book /
// Pay buttons are never touched — the user taps those themselves.
// ---------------------------------------------------------------------------

const FORBIDDEN_SUBMIT_PATTERNS: Array<[string, RegExp]> = [
  ['form.submit() call', /\.submit\s*\(/],
  ['requestSubmit() call', /\.requestSubmit\s*\(/],
  ['booking/continue button reference', /bookNowBtn|continueBtn|proceedToBook/i],
  ['payment submit reference', /proceedToPayment|payNow|makePayment/i],
];

/**
 * Returns the names of forbidden submit-related patterns found in `source`.
 * Empty array = the script cannot submit, period.
 */
export function findSubmitPatterns(source: string): string[] {
  const hits: string[] = [];
  for (const [name, re] of FORBIDDEN_SUBMIT_PATTERNS) {
    if (re.test(source)) hits.push(name);
  }
  return hits;
}

/**
 * Returns a list of violations found in `source`. Empty array = invariant
 * holds. (Kept as a named alias so the harness/tests read naturally.)
 */
export function scanForAutobookViolations(source: string): string[] {
  return findSubmitPatterns(source);
}

// ---------------------------------------------------------------------------
// Script generation
// ---------------------------------------------------------------------------

export interface BuildOptions {
  /** Seed for pacing jitter. Fixed in tests, random-ish in production. */
  seed?: number;
}

export function buildFillScript(plan: FillPlan, opts: BuildOptions = {}): string {
  const seed = opts.seed ?? Math.floor(Math.random() * 2 ** 31);
  const actions = buildFieldActions(plan);
  const gaps = computeFieldGaps(actions.length, seed, plan.passengers.length);
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
  var body = '';
  try { body = (document.body ? document.body.innerText : '').slice(0, 2000); } catch (e) {}
  if (!/otp/i.test(body)) return false;
  // An OTP *input* must actually be on screen — the word "OTP" alone also
  // appears in help text on non-OTP pages.
  var inputs = document.querySelectorAll('input');
  for (var k = 0; k < inputs.length; k++) {
    var hay = attrHaystack(inputs[k]) + ' ' + controlLabelText(inputs[k]);
    if (/otp/i.test(hay)) {
      var r = null;
      try { r = inputs[k].getBoundingClientRect(); } catch (e) {}
      if (r && r.width > 0 && r.height > 0) return true;
    }
  }
  return false;
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
// user taps through on the real site). We only observe and halt.
try {
  var obs = new MutationObserver(function(){ if (otpVisible()) onOtp(); });
  obs.observe(document.documentElement, { childList: true, subtree: true, attributes: true });
} catch (err) { /* observer optional; the pre-step check below is the guarantee */ }

// ---------- human-like field location ----------
function norm(s){ return (s || '').toString().toLowerCase(); }
function matchAny(hay, needles){
  var h = norm(hay);
  for (var i = 0; i < needles.length; i++) {
    if (h.indexOf(norm(needles[i])) !== -1) return true;
  }
  return false;
}
function attrHaystack(el){
  var parts = [
    el.getAttribute('placeholder'), el.getAttribute('aria-label'),
    el.getAttribute('name'), el.getAttribute('formcontrolname'),
    el.id, el.className,
  ];
  // data-* attributes often carry the field's logical name
  // (e.g. data-name="gender") — include them as attribute text.
  try {
    var attrs = el.attributes;
    for (var i = 0; i < attrs.length; i++) {
      if (attrs[i].name.indexOf('data-') === 0) parts.push(attrs[i].name + ' ' + attrs[i].value);
    }
  } catch (e) {}
  return parts.join(' ');
}
// Visible caption text near a control: its <label>s, then ancestor text
// (capped so a whole card's text doesn't false-match).
function controlLabelText(el){
  var parts = [];
  try {
    if (el.labels) for (var i = 0; i < el.labels.length; i++) parts.push(el.labels[i].innerText);
  } catch (e) {}
  var p = el.parentElement, depth = 0;
  while (p && depth < 3) {
    var t = '';
    try { t = p.innerText || ''; } catch (e) {}
    if (t && t.length < 120) parts.push(t);
    p = p.parentElement; depth++;
  }
  return parts.join(' ');
}
function widgetCandidates(kind){
  if (kind === 'input') return document.querySelectorAll('input[type="text"], input:not([type]), input[type="number"], input[type="tel"], textarea');
  if (kind === 'select') return document.querySelectorAll('select, mat-select, .p-dropdown, [role="combobox"]');
  if (kind === 'checkbox') return document.querySelectorAll('input[type="checkbox"]');
  if (kind === 'radio') return document.querySelectorAll('input[type="radio"]');
  return [];
}
function findField(a){
  var loc = a.locator || {};
  // 1. known id (mock / regression path)
  if (loc.id) {
    var byId = document.getElementById(loc.id);
    if (byId) return byId;
  }
  var idx = (loc.paxIndex === undefined) ? 0 : loc.paxIndex;
  var cands = widgetCandidates(a.kind);
  // Attribute matches (placeholder/aria-label/name directly on the control)
  // outrank caption matches: nearby text is shared by sibling widgets and
  // can false-match (e.g. "Preference" inside the gender dropdown's own
  // caption "No Preference"). Collect both, prefer the attribute list.
  var attrMatches = [], labelMatches = [];
  for (var i = 0; i < cands.length; i++) {
    var el = cands[i];
    if (loc.attrText && matchAny(attrHaystack(el), loc.attrText)) { attrMatches.push(el); continue; }
    if (loc.labelText && matchAny(controlLabelText(el), loc.labelText)) { labelMatches.push(el); continue; }
  }
  var matches = attrMatches.length > 0 ? attrMatches : labelMatches;
  // 2b. label elements pointing at a control (label[for] / wrapped input)
  if (matches.length === 0 && loc.labelText) {
    var labels = document.querySelectorAll('label');
    for (var j = 0; j < labels.length; j++) {
      if (!matchAny(labels[j].innerText, loc.labelText)) continue;
      var forId = labels[j].getAttribute('for');
      var target = forId ? document.getElementById(forId)
        : labels[j].querySelector('input, select, textarea');
      if (target) { matches.push(target); break; }
    }
  }
  if (matches.length === 0) return null;
  return matches[Math.min(idx, matches.length - 1)];
}
function fire(el, name){
  try { el.dispatchEvent(new Event(name, { bubbles: true })); } catch (e) {}
}
// Angular-aware value set: use the native setter so reactive forms notice,
// then fire the events a human typing would produce.
function setInputValue(el, value){
  try { el.focus(); } catch (e) {}
  try {
    var proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    var desc = Object.getOwnPropertyDescriptor(proto, 'value');
    if (desc && desc.set) desc.set.call(el, value);
    else el.value = value;
  } catch (e) { el.value = value; }
  fire(el, 'input'); fire(el, 'change'); fire(el, 'blur');
}
function pickOptionText(options, candidates){
  // exact visible-text match first ('Lower' must not match 'Side Lower')
  for (var c = 0; c < candidates.length; c++) {
    var want = norm(candidates[c]);
    for (var i = 0; i < options.length; i++) {
      if (norm(options[i].text).trim() === want) return i;
    }
  }
  for (var c2 = 0; c2 < candidates.length; c2++) {
    var want2 = norm(candidates[c2]);
    for (var j = 0; j < options.length; j++) {
      if (norm(options[j].text).indexOf(want2) !== -1) return j;
    }
  }
  return -1;
}
function setNativeSelect(el, a){
  var opts = [];
  for (var i = 0; i < el.options.length; i++) opts.push({ text: el.options[i].text, value: el.options[i].value });
  var at = pickOptionText(opts, a.optionText || [a.value]);
  if (at === -1) {
    // fall back to matching by value attribute
    for (var k = 0; k < el.options.length; k++) {
      if (norm(el.options[k].value) === norm(a.value)) { at = k; break; }
    }
  }
  if (at === -1) return false;
  el.selectedIndex = at;
  fire(el, 'input'); fire(el, 'change'); fire(el, 'blur');
  return true;
}
// Custom dropdowns (Angular Material mat-select / PrimeNG p-dropdown /
// role=combobox): click to open, then click the matching option in the
// overlay/panel. Returns a promise — the stepper awaits it.
function setCustomSelect(el, a){
  return new Promise(function(resolve){
    function done(ok){ resolve(ok); }
    try { el.scrollIntoView({ block: 'center' }); } catch (e) {}
    try { el.click(); } catch (e) { done(false); return; }
    setTimeout(function(){
      // Scope the option search to the widget just opened: a document-wide
      // query would hit OTHER passengers' dropdown items first (document
      // order) and fill the wrong passenger's widget. PrimeNG-style panels
      // live inside the widget; Material-style overlays render at body
      // level, so fall back to a document query that excludes p-dropdown
      // descendants (those always belong to their own scoped widget).
      var scoped = el.querySelectorAll('mat-option, .mat-option, .p-dropdown-item, [role="option"]');
      var opts = scoped.length > 0 ? Array.from(scoped) :
        Array.from(document.querySelectorAll('mat-option, .mat-option, [role="option"]'))
          .filter(function(o){ return !o.closest('.p-dropdown'); });
      var texts = [];
      for (var i = 0; i < opts.length; i++) texts.push({ text: opts[i].innerText || opts[i].textContent, el: opts[i] });
      var at = pickOptionText(texts, a.optionText || [a.value]);
      if (at === -1) { try { document.body.click(); } catch (e) {} done(false); return; }
      try {
        var target = texts[at].el;
        try { target.scrollIntoView({ block: 'center' }); } catch (e) {}
        target.click();
      } catch (e) { done(false); return; }
      setTimeout(function(){ done(true); }, 250);
    }, 400);
  });
}
function setSelect(el, a){
  if (el.tagName === 'SELECT') return Promise.resolve(setNativeSelect(el, a));
  return setCustomSelect(el, a);
}
function setRadio(a){
  var loc = a.locator || {};
  var radios = document.querySelectorAll('input[type="radio"]');
  var want = a.optionText || [a.value];
  for (var i = 0; i < radios.length; i++) {
    var label = controlLabelText(radios[i]);
    if (matchAny(label, want)) {
      // scope check: the radio must sit near the Travel Insurance caption
      if (loc.labelText) {
        var scopeOk = false;
        var p = radios[i].parentElement, depth = 0;
        while (p && depth < 6) {
          var t = '';
          try { t = p.innerText || ''; } catch (e) {}
          if (matchAny(t, loc.labelText)) { scopeOk = true; break; }
          p = p.parentElement; depth++;
        }
        if (!scopeOk) continue;
      }
      try { radios[i].scrollIntoView({ block: 'center' }); } catch (e) {}
      try { radios[i].click(); } catch (e) { radios[i].checked = true; fire(radios[i], 'change'); }
      fire(radios[i], 'input'); fire(radios[i], 'change');
      return true;
    }
  }
  return false;
}
function clickAddPassenger(a){
  var loc = a.locator || {};
  var needles = loc.labelText || ['Add Passenger'];
  var els = document.querySelectorAll('button, a');
  for (var i = 0; i < els.length; i++) {
    var t = '';
    try { t = els[i].innerText || ''; } catch (e) {}
    if (matchAny(t, needles)) {
      try { els[i].scrollIntoView({ block: 'center' }); } catch (e) {}
      try { els[i].click(); } catch (e) { return false; }
      return true;
    }
  }
  return false;
}
function runAction(a){
  return new Promise(function(resolve){
    if (a.kind === 'addPassenger') {
      var ok = clickAddPassenger(a);
      post(ok ? 'FIELD_FILLED' : 'FIELD_MISSING', { label: a.label });
      // give the new passenger block a moment to render
      setTimeout(resolve, ok ? 700 : 0);
      return;
    }
    var el = findField(a);
    if (!el) { post('FIELD_MISSING', { label: a.label }); resolve(); return; }
    var done = function(ok){
      post(ok === false ? 'FIELD_MISSING' : 'FIELD_FILLED', { label: a.label });
      resolve();
    };
    try {
      if (a.kind === 'checkbox') {
        var want = (a.value !== 'off');
        if (el.checked !== want) { try { el.click(); } catch (e) { el.checked = want; } }
        else { el.checked = want; }
        fire(el, 'input'); fire(el, 'change');
        done(true);
      } else if (a.kind === 'select') {
        setSelect(el, a).then(done);
      } else if (a.kind === 'radio') {
        done(setRadio(a));
      } else {
        // input: skip when already filled (e.g. IRCTC prefilled the mobile
        // number from the user's profile) — never clobber their data.
        var cur = '';
        try { cur = el.value || ''; } catch (e) {}
        if (cur && a.label === 'contact-mobile') { done(true); return; }
        setInputValue(el, a.value);
        done(true);
      }
    } catch (err) { done(false); }
  });
}
var idx = 0;
function step(){
  if (halted) return;
  if (otpVisible()) { onOtp(); return; }
  if (idx >= ACTIONS.length) { post('FILL_COMPLETE', { fields: ACTIONS.length, floorMs: FLOOR_MS }); return; }
  runAction(ACTIONS[idx]).then(function(){
    idx += 1;
    setTimeout(step, GAPS[Math.min(idx, GAPS.length - 1)]);
  });
}
if (otpVisible()) { onOtp(); }
else {
  post('FILL_STARTED', { fields: ACTIONS.length, seed: ${seed}, floorMs: FLOOR_MS });
  setTimeout(step, GAPS[0]);
}
})();`;
}

// ---------------------------------------------------------------------------
// Form probe — injected BEFORE any fill, on the explicit "Fill my form" tap.
// Heuristic: a page whose text mentions passengers AND has several text
// inputs is treated as the passenger-details page. If the probe says the
// form isn't there, native code shows guidance instead of running a
// silent no-op fill (field report 2026-09-26: user tapped fill before the
// booking page was open and nothing visibly happened).
// ---------------------------------------------------------------------------

/**
 * Returns a small self-contained script. When injected it posts exactly one
 * FORM_PROBE_RESULT event: { ready: boolean, reason: 'ok' | 'no-form' |
 * 'blocked' | 'error' }. 'blocked' means IRCTC served its Access-Denied page.
 */
export function buildFormProbeScript(): string {
  return `(function(){
function post(d){
  try { window.ReactNativeWebView.postMessage(JSON.stringify(d)); } catch (e) {}
}
try {
  var title = document.title || '';
  var bodyText = '';
  try { bodyText = (document.body ? document.body.innerText : '').slice(0, 4000); } catch (e) {}
  var all = title + ' ' + bodyText;
  if (/access denied/i.test(all) || /edgesuite|akamai/i.test(title)) {
    post({ type: 'FORM_PROBE_RESULT', t: Math.round(performance.now()), data: { ready: false, reason: 'blocked' } });
    return;
  }
  var inputs = document.querySelectorAll('input[type="text"], input:not([type])').length;
  var selects = document.querySelectorAll('select, mat-select, .p-dropdown').length;
  var mentionsPax = /passenger/i.test(all);
  var ready = mentionsPax && (inputs + selects) >= 3;
  post({ type: 'FORM_PROBE_RESULT', t: Math.round(performance.now()), data: { ready: ready, reason: ready ? 'ok' : 'no-form' } });
} catch (err) {
  post({ type: 'FORM_PROBE_RESULT', t: 0, data: { ready: false, reason: 'error' } });
}
})();`;
}

// ---------------------------------------------------------------------------
// Alternates parser (L2 fallback lane)
// ---------------------------------------------------------------------------

/**
 * Parses the mock train-list snapshot for alternate trains. The real page
 * will differ; this is validated against the mock only.
 */
export function parseAlternates(snapshotHtml: string): Alternate[] {
  const alts: Alternate[] = [];
  const rowRe = /<tr[^>]*class="altRow"[^>]*>([\s\S]*?)<\/tr>/gi;
  let m: RegExpExecArray | null;
  while ((m = rowRe.exec(snapshotHtml)) !== null) {
    const row = m[1];
    const attr = (name: string): string => {
      const mm = new RegExp(`data-${name}="([^"]*)"`, 'i').exec(m![0]);
      return mm ? mm[1] : '';
    };
    const text = row.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    const trainNo = attr('train') || (/(\d{5})/.exec(text)?.[1] ?? '');
    const seatsM = /(\d+)\s*seats?/i.exec(text);
    alts.push({
      trainNo,
      date: attr('date'),
      classCode: attr('class'),
      seatsAvailable: seatsM ? parseInt(seatsM[1], 10) : 0,
      label: text,
    });
  }
  return alts;
}
