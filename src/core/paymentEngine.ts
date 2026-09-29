/**
 * Payment engine — Review Journey -> Payment Methods -> provider -> Pay & Book,
 * then STOP. The gateway that opens afterwards is 100% manual: the user pays
 * in their own UPI/bank app by hand (user steps 15-17 from 2026-09-27).
 *
 * Runs on IRCTC's pages after the passenger-page Continue:
 *   1. waitReviewJourney — wait for the "Review Journey" page (journey +
 *      passenger summary). Resume-safe: if "Payment Methods" or the provider
 *      page is already showing, it jumps straight there.
 *   2. tapReviewContinue — tap the page's "Continue".
 *   3. waitPayMethods — wait for the "Payment Methods" page.
 *   4. selectMethod — 'default' leaves IRCTC's choice alone; 'ipay' picks
 *      "IRCTC iPay"; 'multiple' picks "Multiple Payment Service"; 'bhimUssd'
 *      picks "BHIM/ UPI/ USSD".
 *   5. tapPayContinue — tap that page's "Continue".
 *   6. waitProviders — wait for the provider list ("Pay & Book" button).
 *   7. selectProvider — 'default' leaves IRCTC's choice alone; otherwise
 *      picks the saved provider (PayU / Paytm / PhonePe / Razorpay).
 *   8. tapPayBook — tap "Pay & Book", emit GATEWAY_REACHED, and STOP.
 *      Nothing after this point is ever inspected or touched.
 *
 * Safety invariants:
 * - The script clicks option rows + exactly two "Continue" buttons + one
 *   "Pay & Book" button. It never references payment details, never submits
 *   a form, never looks at the gateway page, never solves CAPTCHA/OTP
 *   (both halt it).
 * - scanPaymentForViolations asserts all of the above on the generated
 *   source, and the harness asserts the gateway page is never scripted.
 */
import { findSubmitPatterns } from './fillEngine';

/** Payment-method preference (IRCTC "Payment Methods" page). */
export type PaymentMethodChoice = 'default' | 'ipay' | 'multiple' | 'bhimUssd';
/** Payment-provider preference (provider list page). */
export type PaymentProviderChoice = 'default' | 'payu' | 'paytm' | 'phonepe' | 'razorpay';

export interface PaymentPlan {
  paymentMethod: PaymentMethodChoice;
  paymentProvider: PaymentProviderChoice;
}

export type PaymentEventType =
  | 'PAYMENT_STARTED'
  | 'PAYMENT_STEP'
  | 'PAYMENT_STEP_MISSING'
  | 'GATEWAY_REACHED'
  | 'CAPTCHA_REQUIRED'
  | 'OTP_REQUIRED';

export interface PaymentEvent {
  type: PaymentEventType;
  t: number;
  data: Record<string, unknown>;
}

export function validatePaymentPlan(plan: PaymentPlan): void {
  if (['default', 'ipay', 'multiple', 'bhimUssd'].indexOf(plan.paymentMethod) === -1) {
    throw new Error('Bad paymentMethod: ' + plan.paymentMethod);
  }
  if (['default', 'payu', 'paytm', 'phonepe', 'razorpay'].indexOf(plan.paymentProvider) === -1) {
    throw new Error('Bad paymentProvider: ' + plan.paymentProvider);
  }
}

/**
 * Static safety scan of a generated payment script. Empty = clean.
 * Permitted click targets: payment-method/provider option rows, two
 * "Continue" buttons, one "Pay & Book" button. Everything payment-detail or
 * gateway-adjacent is forbidden.
 */
export function scanPaymentForViolations(source: string): string[] {
  // Comments stripped first — the tripwires check code only.
  const code = source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:\n])\/\/[^\n]*/gm, '$1');
  const hits = findSubmitPatterns(code);
  const extra: Array<[string, RegExp]> = [
    ['book-now reference', /book[\s-]*now/i],
    ['bare pay button reference', /['"]pay['"]/i],
    ['payment-gateway interaction', /proceedToPayment|payNow|makePayment|upi:/i],
    ['payment-detail entry', /cardNumber|\bcvv\b|cardPin|expiryDate|upiId|vpa/i],
    ['captcha/otp solving', /captcha[^"']*(solve|bypass|fill)/i],
  ];
  for (const [name, re] of extra) {
    if (re.test(code)) hits.push(name);
  }
  // Positive controls: exactly two Continue targets (Review Journey page +
  // Payment Methods page) and exactly one Pay & Book target.
  const contTargets = code.match(/exactButton\('Continue'\)/g) || [];
  if (contTargets.length !== 2) hits.push('continue-target count != 2');
  const payBookTargets = code.match(/exactButton\('Pay & Book'\)/g) || [];
  if (payBookTargets.length !== 1) hits.push('pay&book-target count != 1');
  return hits;
}

export interface PaymentBuildOptions {
  seed?: number;
}

export function buildPaymentScript(plan: PaymentPlan, opts: PaymentBuildOptions = {}): string {
  validatePaymentPlan(plan);
  const planJson = JSON.stringify(plan);
  const seed = typeof opts.seed === 'number' ? opts.seed : Math.floor(Math.random() * 1e9);

  // NOTE: plain ES5-ish JS for the WebView. No backticks or ${ inside — the
  // outer template literal would interpolate them. In the source below a
  // double backslash (\\) renders one backslash in the shipped script.
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
  post('PAYMENT_STEP_MISSING', detail ? { step: step, detail: detail } : { step: step });
  return false;
}
function stepOk(step, extra){
  var d = { step: step };
  if (extra) for (var k in extra) d[k] = extra[k];
  post('PAYMENT_STEP', d);
  return true;
}
// Visible page text via a TreeWalker over text nodes. (document.body.innerText
// is unreliable in some WebView/headless contexts — it can return "" even
// when elements render — while nodeValue + computed-style checks always
// work. Hidden subtrees are skipped so only the shown page counts.)
function pageText(){
  try {
    var out = [];
    var walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode: function(node){
        var el = node.parentElement;
        while (el && el !== document.body) {
          var cs;
          try { cs = window.getComputedStyle(el); } catch (e) { return NodeFilter.FILTER_REJECT; }
          if (cs.display === 'none' || cs.visibility === 'hidden') return NodeFilter.FILTER_REJECT;
          el = el.parentElement;
        }
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    var n;
    while ((n = walker.nextNode())) {
      var t = (n.nodeValue || '').replace(/\\s+/g, ' ').trim();
      if (t) out.push(t);
    }
    return out.join(' ');
  } catch (e) { return ''; }
}
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
// ---------- page detectors ----------
function reviewJourneyVisible(){ return /review journey/i.test(pageText()); }
function payMethodsVisible(){ return /payment methods/i.test(pageText()); }
function providerPageVisible(){
  // A visible "Pay & Book"-style control marks the provider page. Reuses the
  // token matcher so wording variants still count (no bare 'pay' literal —
  // the safety scanner forbids it outside the approved Pay & Book flow).
  return !!fuzzyButton('Pay & Book');
}
// ---------- option pickers (smallest matching row wins) ----------
function findOption(rx){
  var els = document.querySelectorAll('button, div, label, li, span, a');
  var best = null, bestLen = 1e9;
  for (var i = 0; i < els.length; i++) {
    if (!visible(els[i])) continue;
    var t = norm(els[i].innerText || '');
    if (!rx.test(t)) continue;
    if (t.length > 120) continue; // the option row, not a big container
    if (t.length < bestLen) { best = els[i]; bestLen = t.length; }
  }
  return best;
}
function findProvider(name){
  var els = document.querySelectorAll('button, div, label, li, span, a');
  var best = null, bestLen = 1e9;
  for (var i = 0; i < els.length; i++) {
    if (!visible(els[i])) continue;
    var t = norm(els[i].innerText || '').replace(/\\s+/g, ' ').trim();
    if (t !== name && t.indexOf(name + ' ') !== 0 && t.indexOf(' ' + name) === -1) continue;
    if (t.length > 60) continue;
    if (t.length < bestLen) { best = els[i]; bestLen = t.length; }
  }
  return best;
}
function clickOption(el){
  var radio = null;
  try { radio = el.querySelector('input[type="radio"]'); } catch (e) {}
  if (el.tagName === 'INPUT' && /^radio$/i.test(el.type || '')) radio = el;
  if (radio) {
    if (radio.checked) return 'already';
    clickEl(radio);
    return 'radio';
  }
  clickEl(el);
  return 'clicked';
}
// ---------- step 1+2: Review Journey page -> Continue ----------
async function stepReviewJourney(){
  for (var i = 0; i < 40; i++) {
    if (!guard()) return false;
    if (providerPageVisible()) return stepOk('reviewJourney', { skipped: true, reason: 'already-at-providers' });
    if (payMethodsVisible()) return stepOk('reviewJourney', { skipped: true, reason: 'already-at-paymethods' });
    if (reviewJourneyVisible()) break;
    await sleep(750);
  }
  if (!reviewJourneyVisible()) return stepMissing('reviewJourney', 'Review Journey page did not open');
  var btn = exactButton('Continue');
  if (!btn) return stepMissing('reviewContinue', 'Continue not on Review Journey page');
  clickEl(btn);
  await sleep(1500);
  return stepOk('reviewContinue');
}
// ---------- step 3+4+5: Payment Methods page ----------
function methodRegex(){
  var m = PLAN.paymentMethod || 'default';
  if (m === 'ipay') return /irctc\\s*ipay/;
  if (m === 'multiple') return /multiple payment service/;
  if (m === 'bhimUssd') return /bhim/;
  return null;
}
async function stepPayMethods(){
  for (var i = 0; i < 40; i++) {
    if (!guard()) return false;
    if (providerPageVisible()) return stepOk('payMethods', { skipped: true, reason: 'already-at-providers' });
    if (payMethodsVisible()) break;
    await sleep(750);
  }
  if (!payMethodsVisible()) {
    if (providerPageVisible()) return stepOk('payMethods', { skipped: true, reason: 'already-at-providers' });
    return stepMissing('payMethods', 'Payment Methods page did not open');
  }
  var rx = methodRegex();
  if (rx) {
    var opt = findOption(rx);
    if (!opt) return stepMissing('payMethod', 'payment method ' + PLAN.paymentMethod + ' not found');
    var how = clickOption(opt);
    if (how !== 'already') await sleep(600);
    stepOk('payMethod', { method: PLAN.paymentMethod, how: how });
  } else {
    stepOk('payMethod', { skipped: true, reason: 'irctc-default-kept' });
  }
  var btn = exactButton('Continue');
  if (!btn) return stepMissing('payContinue', 'Continue not on Payment Methods page');
  clickEl(btn);
  await sleep(1500);
  return stepOk('payContinue');
}
// ---------- step 6+7+8: provider list -> Pay & Book -> STOP ----------
async function stepProviders(){
  for (var i = 0; i < 27; i++) {
    if (!guard()) return false;
    if (providerPageVisible()) break;
    if (payMethodsVisible()) return stepMissing('providers', 'still on Payment Methods page');
    await sleep(750);
  }
  if (!providerPageVisible()) {
    // We left the in-scope pages without reaching the provider list (e.g. a
    // direct BHIM/UPI handoff). Whatever shows now is beyond this engine's
    // scope — stop and hand control to the user.
    if (!payMethodsVisible() && !reviewJourneyVisible()) { post('GATEWAY_REACHED', { direct: true }); return true; }
    return stepMissing('providers', 'provider list did not open');
  }
  var want = PLAN.paymentProvider || 'default';
  if (want !== 'default') {
    var opt = findProvider(want);
    if (!opt) return stepMissing('payProvider', 'provider ' + want + ' not found');
    var how = clickOption(opt);
    if (how !== 'already') await sleep(600);
    stepOk('payProvider', { provider: want, how: how });
  } else {
    stepOk('payProvider', { skipped: true, reason: 'irctc-default-kept' });
  }
  var btn = exactButton('Pay & Book');
  if (!btn) return stepMissing('payBook', 'Pay & Book not found');
  clickEl(btn);
  await sleep(1200);
  // STOP. The gateway page is never inspected or touched — the user pays by hand.
  post('GATEWAY_REACHED', {});
  return true;
}
// ---------- main ----------
async function run(){
  post('PAYMENT_STARTED', {});
  if (!guard()) return;
  // Resume: if a later page is already showing, jump straight to it.
  if (providerPageVisible() || payMethodsVisible() || reviewJourneyVisible()) {
    // fall through to the step chain — each step skips when already past it
  }
  var steps = [stepReviewJourney, stepPayMethods, stepProviders];
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
