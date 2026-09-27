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
 *   source.
 */
import { findSubmitPatterns } from './fillEngine';

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
  const seed = typeof opts.seed === 'number' ? opts.seed : Math.floor(Math.random() * 1e9);

  // NOTE: plain ES5-ish JS for the WebView. No backticks or ${ inside.
  return `(function(){
"use strict";
var PLAN = ${planJson};
var SEED = ${seed};
var log = (window.__tatkalEventLog = window.__tatkalEventLog || []);
function post(type, data){
  var e = { type: type, t: Math.round(performance.now()), data: data || {} };
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
async function stepSkipCard(){
  var radios = document.querySelectorAll('input[type="radio"]');
  var skip = null, any = null;
  for (var i = 0; i < radios.length; i++) {
    if (!visible(radios[i])) continue;
    var own = norm(ownText(radios[i]));
    if (own.indexOf('skip') === -1) continue;
    var sec = norm(sectionText(radios[i]));
    if (sec.indexOf('co-brand') !== -1 || sec.indexOf('loyalty') !== -1 || sec.indexOf('reward') !== -1 ||
        sec.indexOf('pay less, earn more') !== -1) { skip = radios[i]; break; }
    if (!any) any = radios[i];
  }
  if (!skip) skip = any; // label match on "Skip" alone (section text nearby)
  if (!skip) return stepMissing('skipCard', 'Skip option not found');
  if (skip.checked) return stepOk('skipCard', { skipped: true, reason: 'already-selected' });
  clickEl(skip);
  await sleep(500);
  if (!skip.checked) { try { skip.checked = true; } catch (e) {} }
  return stepOk('skipCard');
}
// ---------- step 2: GST — deliberately untouched (no GSTIN is collected) ----------
async function stepGst(){
  return stepOk('gst', { skipped: true, reason: 'optional-no-gstin-saved' });
}
// ---------- step 3: payment mode — honour the trip's choice, never pay ----------
function findPaymentRadio(want){
  var radios = document.querySelectorAll('input[type="radio"]');
  for (var i = 0; i < radios.length; i++) {
    if (!visible(radios[i])) continue;
    var own2 = norm(ownText(radios[i]));
    if (own2.indexOf('skip') !== -1) continue; // co-branded card radios, not payment
    var t = own2 + ' ' + norm(sectionText(radios[i]));
    if (want === 'bhim' && /bhim\\/upi/.test(t)) return radios[i];
    if (want === 'cards' && /credit & debit cards/.test(t)) return radios[i];
  }
  return null;
}
async function stepPayment(){
  var mode = PLAN.paymentMode || 'default';
  if (mode === 'default') return stepOk('payment', { skipped: true, reason: 'irctc-default-kept' });
  var r = findPaymentRadio(mode);
  if (!r) return stepMissing('payment', 'payment option ' + mode + ' not found');
  if (r.checked) return stepOk('payment', { skipped: true, reason: 'already-selected' });
  clickEl(r);
  await sleep(500);
  return stepOk('payment', { mode: mode });
}
// ---------- step 4: tap Continue — then STOP, payment is manual ----------
function exactButton(text){
  var bs = document.querySelectorAll('button');
  var found = null;
  for (var i = 0; i < bs.length; i++) {
    if ((bs[i].innerText || '').trim() === text && visible(bs[i])) found = bs[i]; // last = sticky bar
  }
  return found;
}
async function stepContinue(){
  var btn = exactButton('Continue');
  if (!btn) return stepMissing('continueTap');
  clickEl(btn);
  await sleep(1200);
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
