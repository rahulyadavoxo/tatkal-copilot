/**
 * Review engine — the last automated stage before payment (user steps
 * 9, 12, 14 from 2026-09-27).
 *
 * Runs on IRCTC's combined passenger/review page:
 *   1. skipCard — make sure the "Skip" option of the "IRCTC Co-branded Card
 *      Benefits" question is selected (never the loyalty-point options).
 *   2. gst      — GST is optional and the app collects no GSTIN, so the
 *      field is deliberately left untouched.
 *   3. payment  — the payment-mode radios are left exactly as they are when
 *      the trip says 'default'; 'cards' selects the Cards/NetBanking/
 *      Wallets/UPI option; 'bhim' selects BHIM/UPI. The engine never enters
 *      any payment detail.
 *   4. continueTap — tap IRCTC's "Continue" button and emit REVIEW_DONE.
 *      The payment engine (paymentEngine.ts) takes over from there: Review
 *      Journey -> Payment Methods -> provider -> Pay & Book, then STOP.
 *
 * Safety invariants:
 * - Exactly one button is ever clicked: the visible "Continue". The script
 *   never references Book Now / Pay buttons, never submits a form, never
 *   solves CAPTCHA/OTP (both halt it).
 * - scanReviewForViolations asserts all of the above on the generated
 *   source in CI (test-time check, not a runtime guard).
 */
import { findSubmitPatterns } from './fillEngine';
import { COBRAND_SECTION_MARKERS, paymentModeTokens } from './stageChoices';

/** Payment-mode preference for the review page. (Canonical app-level type:
 *  vaultStore's PaymentMode — kept identical here so the engine compiles
 *  standalone in the harness, which builds src/core with its own rootDir.) */
export type ReviewPaymentMode = 'default' | 'cards' | 'bhim';

export interface ReviewPlan {
  paymentMode: ReviewPaymentMode; // 'default' | 'cards' | 'bhim'
}

export type ReviewEventType =
  | 'REVIEW_STARTED'
  | 'REVIEW_STEP'
  | 'REVIEW_STEP_MISSING'
  | 'REVIEW_DONE'
  | 'CAPTCHA_REQUIRED'
  | 'OTP_REQUIRED';

export interface ReviewEvent {
  type: ReviewEventType;
  t: number;
  data: Record<string, unknown>;
}

/**
 * Static safety scan of a generated review script. Empty = clean.
 * The ONLY permitted click target is IRCTC's "Continue" button — the scan
 * forbids every other booking/payment-adjacent reference.
 */
export function scanReviewForViolations(source: string): string[] {
  // Comments stripped first — the tripwires check code only.
  const code = source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:\n])\/\/[^\n]*/gm, '$1');
  const hits = findSubmitPatterns(code);
  const extra: Array<[string, RegExp]> = [
    ['book-now reference', /book[\s-]*now/i],
    ['pay button reference', /['"]pay['"]/i],
    ['payment-gateway interaction', /proceedToPayment|payNow|makePayment|razorpay|upi:/i],
    ['payment-detail entry', /cardNumber|\bcvv\b|cardPin|expiryDate/i],
    ['captcha/otp solving', /captcha[^"']*(solve|bypass|fill)/i],
  ];
  for (const [name, re] of extra) {
    if (re.test(code)) hits.push(name);
  }
  // Positive control: the script must click exactly one Continue — a missing
  // Continue target means the step silently can't work; two different ones
  // means it might hit the wrong button.
  const contTargets = code.match(/exactButton\('Continue'\)/g) || [];
  if (contTargets.length !== 1) hits.push('continue-target count != 1');
  return hits;
}

export interface ReviewBuildOptions {
  seed?: number;
}

export function buildReviewScript(plan: ReviewPlan, opts: ReviewBuildOptions = {}): string {
  const planJson = JSON.stringify(plan);
  // Shared choice data (src/core/stageChoices.ts) — the Chrome path reads the same values.
  const sharedJson = JSON.stringify({
    cobrand: COBRAND_SECTION_MARKERS,
    modeTokens: {
      cards: paymentModeTokens('cards'),
      bhim: paymentModeTokens('bhim'),
    },
  });
  const seed = typeof opts.seed === 'number' ? opts.seed : Math.floor(Math.random() * 1e9);

  // NOTE: plain ES5-ish JS for the WebView. No backticks or ${ inside.
  return `(function(){
"use strict";
var PLAN = ${planJson};
var SHARED = ${sharedJson};
var SEED = ${seed};
var log = (window.__tatkalEventLog = window.__tatkalEventLog || []);
function post(type, data){
  var e = { type: type, t: Math.round(performance.now()), seed: SEED, data: data || {} };
  log.push(e);
  try {
    if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
      window.ReactNativeWebView.postMessage(JSON.stringify(e));
    }
  } catch (err) {}
}
function norm(s){ return (s || '').toString().toLowerCase(); }
function sleep(ms){ return new Promise(function(r){ setTimeout(r, ms); }); }
function visible(el){
  try { var r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; }
  catch (e) { return false; }
}
function clickEl(el){
  try { el.scrollIntoView({ block: 'center' }); } catch (e) {}
  el.click();
}
function stepMissing(step, detail){
  post('REVIEW_STEP_MISSING', detail ? { step: step, detail: detail } : { step: step });
  return false;
}
function stepOk(step, extra){
  var d = { step: step };
  if (extra) for (var k in extra) d[k] = extra[k];
  post('REVIEW_STEP', d);
  return true;
}
function ownText(input){
  var parts = [];
  try {
    if (input.labels) for (var i = 0; i < input.labels.length; i++) parts.push(input.labels[i].innerText);
  } catch (e) {}
  var a = '';
  try { a = input.getAttribute('aria-label') || ''; } catch (e) {}
  if (a) parts.push(a);
  return parts.join(' | ');
}
function sectionText(input){
  var parts = [];
  var p = input.parentElement, depth = 0;
  while (p && depth < 2) {
    var t = '';
    try { t = p.innerText || ''; } catch (e) {}
    if (t) parts.push(t.length > 200 ? t.slice(0, 200) : t);
    p = p.parentElement; depth++;
  }
  return parts.join(' | ');
}
function otpInputVisible(){
  var inputs = document.querySelectorAll('input');
  for (var k = 0; k < inputs.length; k++) {
    if (!visible(inputs[k])) continue;
    var h = norm((inputs[k].getAttribute('placeholder') || '') + ' ' +
      (inputs[k].getAttribute('aria-label') || '') + ' ' + (inputs[k].getAttribute('name') || ''));
    if (/otp/.test(h)) return true;
  }
  return false;
}
function captchaPresent(){
  var imgs = document.querySelectorAll('img');
  for (var i = 0; i < imgs.length; i++) {
    if (!visible(imgs[i])) continue;
    var h = norm((imgs[i].getAttribute('src') || '') + ' ' + (imgs[i].getAttribute('alt') || ''));
    if (/captcha/.test(h)) return true;
  }
  return false;
}
function guard(){
  if (otpInputVisible()) { post('OTP_REQUIRED', {}); return false; }
  if (captchaPresent()) { post('CAPTCHA_REQUIRED', {}); return false; }
  return true;
}
// ---------- step 1: co-branded card "Skip" must be selected ----------
var COBRAND_HINT = /co-brand|sbi.{0,10}card|loyalty.{0,30}card|card.{0,30}offer|pay less.{0,20}earn/i;
function sectionHint(el){
  return COBRAND_HINT.test(norm(sectionText(el)));
}
function cobrandOfferPresent(){
  // A real card-offer OPTION GROUP: visible container with co-brand wording
  // AND at least one option radio. A promo banner ("IRCTC SBI Card") with no
  // radios is not an option group — nothing to skip there.
  var els = document.querySelectorAll('div, section, fieldset, form, table');
  for (var i = 0; i < els.length; i++) {
    if (!visible(els[i])) continue;
    var t = '';
    try { t = els[i].innerText || ''; } catch (e) {}
    if (!t) continue;
    var n = norm(t.length > 500 ? t.slice(0, 500) : t);
    if (!COBRAND_HINT.test(n)) continue;
    if (/bhim|credit & debit cards/.test(n)) continue; // payment-mode list, not card offer
    var rs = els[i].querySelectorAll('input[type="radio"]');
    for (var k = 0; k < rs.length; k++) {
      if (!visible(rs[k])) continue;
      var rt = norm(ownText(rs[k]));
      if (/bhim|credit & debit cards/.test(rt)) continue; // a payment radio
      return true;
    }
  }
  return false;
}
function cardGroupText(){
  // Diagnostic for the halt notice: what the card-offer group actually says,
  // so the wording on the real IRCTC page can be seen and matched.
  var els = document.querySelectorAll('div, section, fieldset, form, table');
  for (var i = 0; i < els.length; i++) {
    if (!visible(els[i])) continue;
    var t = '';
    try { t = els[i].innerText || ''; } catch (e) {}
    if (!t) continue;
    var n = norm(t.length > 500 ? t.slice(0, 500) : t);
    if (!COBRAND_HINT.test(n)) continue;
    if (/bhim|credit & debit cards/.test(n)) continue;
    return 'On-page section: "' + n.slice(0, 140) + '"';
  }
  return '';
}
async function stepSkipCard(){
  var radios = document.querySelectorAll('input[type="radio"]');
  var skip = null;
  for (var i = 0; i < radios.length; i++) {
    if (!visible(radios[i])) continue;
    var own = norm(ownText(radios[i]));
    if (own.indexOf('skip') === -1) continue;
    var sec = norm(sectionText(radios[i]));
    var inCobrand = false;
    for (var m = 0; m < SHARED.cobrand.length; m++) {
      if (sec.indexOf(SHARED.cobrand[m]) !== -1) { inCobrand = true; break; }
    }
    if (inCobrand) { skip = radios[i]; break; }
    // A "Skip" radio outside the co-branded/loyalty section is NOT ours
    // (e.g. a meal or seat "Skip") — it must never be clicked; halt instead.
  }
  if (skip) {
    if (skip.checked) return stepOk('skipCard', { skipped: true, reason: 'already-selected' });
    clickEl(skip);
    await sleep(500);
    if (!skip.checked) { try { skip.checked = true; } catch (e) {} }
    return stepOk('skipCard');
  }
  // Variant: the card offer's Skip is a button/link rather than a radio.
  var ctrls = document.querySelectorAll('button, a, input[type="button"], input[type="submit"]');
  for (var j = 0; j < ctrls.length; j++) {
    var el = ctrls[j], tag = (el.tagName || '').toLowerCase();
    if (!visible(el)) continue;
    var bt = tag === 'input' ? norm(el.getAttribute('value') || '')
                             : norm(el.innerText || el.textContent || '');
    if (bt.indexOf('skip') === -1 || bt.indexOf('continue') !== -1) continue;
    if (sectionHint(el)) { clickEl(el); await sleep(500); return stepOk('skipCard', { via: 'button' }); }
  }
  // Variant: this IRCTC page shows no card-offer option group at all — nothing
  // to skip, so move on to the payment mode and Continue instead of halting.
  if (!cobrandOfferPresent()) return stepOk('skipCard', { skipped: true, reason: 'no-card-section' });
  var diag = cardGroupText();
  return stepMissing('skipCard', 'Skip option not found in co-branded card section' + (diag ? ' (' + diag + ')' : ''));
}
// ---------- step 2: GST — deliberately untouched (no GSTIN is collected) ----------
async function stepGst(){
  return stepOk('gst', { skipped: true, reason: 'optional-no-gstin-saved' });
}
// ---------- step 3: payment mode — honour the trip's choice, never pay ----------
function optionText(el){
  // Text of one option row: associated labels, wrapping label, aria-label,
  // then the row's own text. IRCTC renders radios as custom controls on some
  // variants, so the native input's label association alone is not enough.
  var parts = [ownText(el)];
  try {
    var l = el.closest ? el.closest('label') : null;
    if (l) parts.push(l.innerText || '');
  } catch (e) {}
  try {
    var row = el.parentElement;
    if (row) parts.push(row.innerText || '');
    var row2 = row && row.parentElement;
    if (row2) {
      var t2 = row2.innerText || '';
      parts.push(t2.length > 300 ? t2.slice(0, 300) : t2);
    }
  } catch (e2) {}
  return norm(parts.join(' | '));
}
function ownOptionText(el){
  // The option's OWN text only (no ancestors): used for the skip filter, so a
  // "Skip" word elsewhere on the page (e.g. the co-branded card section above
  // the payment options) can never hide the payment radios. For custom
  // (non-input) controls the element's own inner text counts too.
  var parts = [ownText(el)];
  try {
    var l = el.closest ? el.closest('label') : null;
    if (l) parts.push(l.innerText || '');
  } catch (e) {}
  try {
    var tag = (el.tagName || '').toLowerCase();
    if (tag !== 'input' && tag !== 'select' && tag !== 'textarea') {
      var self = el.innerText || el.textContent || '';
      parts.push(self.length > 200 ? self.slice(0, 200) : self);
    }
  } catch (e2) {}
  return norm(parts.join(' | '));
}
function payMatches(t, want){
  var toks = SHARED.modeTokens[want];
  if (!toks || !toks.length) return false;
  for (var i = 0; i < toks.length; i++) if (t.indexOf(toks[i]) === -1) return false;
  return true;
}
function findPaymentRadio(want){
  // Native radios AND custom role="radio" controls. Two passes: first the
  // option's OWN text (precise — two options sharing a container must not be
  // confused), then the wider row text as a fallback for text-less controls.
  var radios = document.querySelectorAll('input[type="radio"], [role="radio"]');
  var cands = [];
  var fallbacks = [];
  for (var i = 0; i < radios.length; i++) {
    var el = radios[i];
    if (!visible(el)) continue;
    var own = ownOptionText(el);
    if (own.indexOf('skip') !== -1) continue; // co-branded card radios, not payment
    var t = optionText(el);
    cands.push(own.slice(0, 60) || t.slice(0, 60));
    if (payMatches(own, want)) return el;
    if (payMatches(t, want)) fallbacks.push(el);
  }
  // Ancestor-text fallback: only when exactly one option matches — several
  // matches means the options share a container and guessing could pick the
  // wrong payment mode, so halt instead.
  if (fallbacks.length === 1) return fallbacks[0];
  window.__payCands = cands; // diagnostics for the halt notice
  return null;
}
function paySelected(el){
  try {
    if (typeof el.checked === 'boolean') return el.checked;
    var a = el.getAttribute('aria-checked');
    if (a !== null) return a === 'true';
  } catch (e) {}
  return false;
}
async function stepPayment(){
  var mode = PLAN.paymentMode || 'default';
  if (mode === 'default') return stepOk('payment', { skipped: true, reason: 'irctc-default-kept' });
  var r = findPaymentRadio(mode);
  if (!r) {
    var c = [];
    try { c = window.__payCands || []; } catch (e) {}
    return stepMissing('payment', 'payment option ' + mode + ' not found' +
      (c.length ? ' (saw ' + c.length + ' options: ' + c.join(' ~ ').slice(0, 160) + ')' : ' (no option radios found)'));
  }
  if (paySelected(r)) return stepOk('payment', { skipped: true, reason: 'already-selected' });
  clickEl(r);
  await sleep(500);
  if (!paySelected(r)) { try { r.click(); } catch (e) {} await sleep(500); }
  if (!paySelected(r)) return stepMissing('payment', 'payment option ' + mode + ' would not select');
  return stepOk('payment', { mode: mode });
}
// ---------- step 4: tap Continue — then STOP, payment is manual ----------
function fuzzyButton(text){
  // Token match: every word of the wanted label must appear in the control's
  // text. The live page does not always use the mock's exact labels — seen
  // on-device 2026-09-29 ("Book Now" vs hyphenated/lowercase variants,
  // "Pay and Book", "CONTINUE →").
  var want = norm(text).split(/[^a-z0-9]+/).filter(function (w) { return w; });
  var bs = (document).querySelectorAll('button, input[type="submit"], input[type="button"]');
  var found = null;
  for (var i = 0; i < bs.length; i++) {
    var el = bs[i], tag = (el.tagName || '').toLowerCase();
    if (!visible(el)) continue;
    var t = tag === 'input' ? norm(el.getAttribute('value') || '')
                            : norm(el.innerText || el.textContent || '');
    if (!t) continue;
    var ok = true;
    for (var k = 0; k < want.length; k++) {
      if (t.indexOf(want[k]) < 0) { ok = false; break; }
    }
    if (ok) found = el; // last match wins = sticky bottom bar
  }
  return found;
}
function exactButton(text){ return fuzzyButton(text); }
async function stepContinue(){
  var btn = exactButton('Continue');
  if (!btn) return stepMissing('continueTap');
  var beforeText = '';
  try { beforeText = (document.body ? document.body.innerText : '').slice(0, 4000); } catch (e) {}
  var beforeUrl = '';
  try { beforeUrl = location.href; } catch (e) {}
  clickEl(btn);
  // Verify the page actually advanced: a fixed delay alone declares success
  // even when the tap never registered, chaining payment onto the wrong page.
  // No time limit — on slow connections IRCTC can take minutes to render the
  // next page. Never re-tap: IRCTC kills the session on double-clicked
  // buttons ("Sorry!!! Please Try again!!"). guard() still cancels the wait.
  for (;;) {
    await sleep(750);
    if (!guard()) return false;
    var url = '';
    try { url = location.href; } catch (e) {}
    if (url && beforeUrl && url !== beforeUrl) break;
    var t = '';
    try { t = (document.body ? document.body.innerText : '').slice(0, 4000); } catch (e) {}
    if (t !== beforeText && /review journey|your ticket will be sent to|payment methods/i.test(t)) break;
    var gone = false;
    try { gone = !document.contains(btn); } catch (e) {}
    if (gone && t !== beforeText) break;
  }
  post('REVIEW_DONE', {});
  return true;
}
// ---------- main ----------
async function run(){
  post('REVIEW_STARTED', {});
  var steps = [stepSkipCard, stepGst, stepPayment, stepContinue];
  for (var s = 0; s < steps.length; s++) {
    if (!guard()) return;
    var ok = await steps[s]();
    if (!ok) return; // reason already posted
    await sleep(450);
  }
}
run();
})();`;
}
