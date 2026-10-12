/**
 * Post-search engine — drives IRCTC from the filled search form through
 * train selection, up to the passenger-details page.
 *
 * User-authorized steps (2026-09-27 — the user explicitly asked the app to
 * perform these on their own IRCTC account, on top of the earlier
 * pre-booking stage):
 *   1. tapSearch    — tap IRCTC's "Search Trains" button
 *   2. waitList     — wait for the train list to load
 *   3. selectTrain  — find the card for the trip's train number, tap the
 *                     class tab for the trip's class (first tab when the
 *                     trip is "All Classes"), tap the journey-date card
 *   4. bookNow      — tap "Book Now" in that train's card
 *   5. popup       — if the station-mismatch confirmation appears
 *                     ("...Do you want to continue with it?"), tap "Yes".
 *                     No popup -> do nothing. Any OTHER dialog -> halt with
 *                     POPUP_UNKNOWN so the user decides by hand.
 *   6. waitPax      — wait for the passenger-details page, then stop with
 *                     PASSENGER_PAGE_READY (the fill engine takes over).
 *
 * Safety invariants:
 * - The script clicks navigation/selection controls ONLY (Search Trains,
 *   class tabs, date cards, Book Now, the Yes button of the one known
 *   confirmation). It never touches payment, never enters payment details,
 *   never solves a CAPTCHA or OTP (both halt the engine for manual work).
 * - No form.submit() / requestSubmit() anywhere; scanPostSearchForViolations
 *   asserts this plus the absence of any payment-gateway interaction —
 *   in CI/harness, not at runtime in the shipped app.
 * - Every step is idempotent: a re-run skips what is already done (e.g. the
 *   train list already showing skips tapSearch).
 */
import { findSubmitPatterns } from './fillEngine';

export interface PostSearchPlan {
  trainNo: string; // 5 digits, e.g. '12873'
  classCode: string; // '3A' | 'SL' | ... | 'ALL' (All Classes)
  dateISO: string; // YYYY-MM-DD
  dateCard: string; // '29 Sep' — the date card text, computed by toDateCard
}

export type PostSearchEventType =
  | 'SEARCH_STARTED'
  | 'SEARCH_STEP'
  | 'SEARCH_STEP_MISSING'
  | 'POPUP_YES'
  | 'POPUP_NONE'
  | 'POPUP_UNKNOWN'
  | 'PASSENGER_PAGE_READY'
  | 'CAPTCHA_REQUIRED'
  | 'OTP_REQUIRED';

export interface PostSearchEvent {
  type: PostSearchEventType;
  t: number;
  data: Record<string, unknown>;
}

const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

/** YYYY-MM-DD -> 'DD Mon' as IRCTC's date cards show it ('29 Sep', '01 Oct'). */
export function toDateCard(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim());
  if (!m) throw new Error('Bad ISO date: ' + iso);
  const mon = MONTHS[Number(m[2]) - 1];
  if (!mon) throw new Error('Bad ISO date: ' + iso);
  return `${m[3]} ${mon}`;
}

export function normalizeClassCode(code: string): string {
  return /^all(\s+classes)?$/i.test(code.trim()) ? 'ALL' : code.trim().toUpperCase();
}

export function validatePostSearchPlan(plan: PostSearchPlan): void {
  if (!/^\d{5}$/.test(plan.trainNo)) throw new Error('Bad train number: ' + plan.trainNo);
  toDateCard(plan.dateISO); // throws on malformed YYYY-MM-DD
  if (!plan.classCode) throw new Error('classCode is required');
  if (!plan.dateCard) throw new Error('dateCard is required');
}

/**
 * Static safety scan of a generated post-search script. Empty = clean.
 * The script MAY click Search Trains / class tabs / date cards / Book Now /
 * the known confirmation's Yes button — everything else booking-adjacent is
 * forbidden: no form submits, no payment-gateway interaction, no payment
 * halt-on-CAPTCHA/OTP: detecting them to stop is fine; automated entry is not.
 */
export function scanPostSearchForViolations(source: string): string[] {
  // Strip comments first so documentation wording (e.g. "never CAPTCHA
  // entry") can't false-positive the canary — the tripwires check code only.
  const code = source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:\n])\/\/[^\n]*/gm, '$1');
  const hits = findSubmitPatterns(code);
  const extra: Array<[string, RegExp]> = [
    ['payment-gateway interaction', /proceedToPayment|payNow|makePayment|razorpay|upi:/i],
    ['payment-detail entry', /cardNumber|\bcvv\b|cardPin|expiryDate/i],
    ['captcha/otp solving', /captcha[^"']*(solve|bypass|fill)/i],
    ['book-now variable smuggling', /bookNowBtn|proceedToBook/i],
  ];
  for (const [name, re] of extra) {
    if (re.test(code)) hits.push(name);
  }
  return hits;
}

export interface PostSearchBuildOptions {
  seed?: number;
}

export function buildPostSearchScript(plan: PostSearchPlan, opts: PostSearchBuildOptions = {}): string {
  validatePostSearchPlan(plan);
  const planJson = JSON.stringify(plan);
  const seed = typeof opts.seed === 'number' ? opts.seed : Math.floor(Math.random() * 1e9);

  // NOTE: plain ES5-ish JS for the WebView. No backticks or ${ inside —
  // the outer template literal would interpolate them. PLAN is embedded once.
  return `(function(){
"use strict";
var PLAN = ${planJson};
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
function strongClick(el){
  try {
    var r = el.getBoundingClientRect();
    var o = { bubbles: true, cancelable: true,
      clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 };
    el.dispatchEvent(new MouseEvent('pointerdown', o));
    el.dispatchEvent(new MouseEvent('mousedown', o));
    el.dispatchEvent(new MouseEvent('pointerup', o));
    el.dispatchEvent(new MouseEvent('mouseup', o));
    el.dispatchEvent(new MouseEvent('click', o));
  } catch (e) { try { el.click(); } catch (e2) {} }
}
function stepMissing(step, detail){
  post('SEARCH_STEP_MISSING', detail ? { step: step, detail: detail } : { step: step });
  return false;
}
function stepOk(step, extra){
  var d = { step: step };
  if (extra) for (var k in extra) d[k] = extra[k];
  post('SEARCH_STEP', d);
  return true;
}
function exactButton(text, scope){
  var bs = (scope || document).querySelectorAll('button');
  for (var i = 0; i < bs.length; i++) {
    if ((bs[i].innerText || '').trim() === text && visible(bs[i])) return bs[i];
  }
  return null;
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
// ---------- step 1: tap "Search Trains" ----------
function fuzzyButton(text, scope){
  // Token match: every word of the wanted label must appear in the control's
  // text. The live page does not always use the mock's exact labels — seen
  // on-device 2026-09-29 ("Book Now" vs hyphenated/lowercase variants,
  // "Pay and Book", "CONTINUE →").
  var want = norm(text).split(/[^a-z0-9]+/).filter(function (w) { return w; });
  var bs = (scope || document).querySelectorAll('button, input[type="submit"], input[type="button"]');
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
function trainListVisible(){
  return !!fuzzyButton('Book Now');
}
function isOptionEl(el){
  var tag = (el.tagName || '').toLowerCase();
  if (tag === 'option' || tag === 'li') return true;
  var cls = ' ' + norm(el.className || '') + ' ';
  if (cls.indexOf('p-dropdown-item') >= 0 || cls.indexOf('ui-dropdown-item') >= 0) return true;
  return (el.getAttribute('role') || '') === 'option';
}
function flatText(el){
  var tag = (el.tagName || '').toLowerCase();
  var raw = tag === 'input' ? (el.getAttribute('value') || '')
                            : (el.innerText || el.textContent || '');
  return norm(raw).replace(/\\s+/g, ' ').trim();
}
function dumpSearchCandidates(){
  // Compact dump of the page's clickable controls, shown in the missing-step
  // notice so an on-device failure can be diagnosed from the message alone.
  var out = [];
  var els = document.querySelectorAll(
    'button, input[type="submit"], input[type="button"], a, [role="button"], div, span');
  for (var i = 0; i < els.length && out.length < 12; i++) {
    var el = els[i], tag = (el.tagName || '').toLowerCase();
    if (tag !== 'button' && tag !== 'a' && tag !== 'input' &&
        el.getAttribute('role') !== 'button') continue; // div/span only help the dump
    if (!visible(el) || isOptionEl(el)) continue;
    var t = flatText(el).slice(0, 36);
    if (!t) continue;
    out.push(tag + (el.disabled ? '[disabled]' : '') + ':"' + t + '"');
  }
  return out.length ? out.join(' | ') : '(no clickable controls found)';
}
function findSearchButton(){
  // The live search control is not always a <button> reading exactly
  // "Search Trains" (seen on-device 2026-09-29: exact match found nothing,
  // fuzzy button/input/a match still found nothing).
  var cands = document.querySelectorAll(
    'button, input[type="submit"], input[type="button"], a, [role="button"]');
  var fallback = null;
  for (var i = 0; i < cands.length; i++) {
    var el = cands[i];
    if (!visible(el) || isOptionEl(el)) continue;
    var t = flatText(el);
    if (!t) continue;
    if (t === 'search trains') return el;
    // The live page sometimes renders the control as a bare "Search" link
    // (seen on-device 2026-09-29) — an exact "search" is the only other
    // acceptable label. Anything merely *containing* "search" (Search PNR,
    // Search Stations, ...) must never be tapped.
    if (t === 'search' && !fallback) fallback = el;
  }
  if (fallback) return fallback;
  // Last resort: a div/span whose whole text is exactly "Search Trains" —
  // some IRCTC renders style a plain element as the search control.
  var els = document.querySelectorAll('div, span');
  for (var j = 0; j < els.length; j++) {
    if (!visible(els[j]) || isOptionEl(els[j])) continue;
    if (flatText(els[j]) === 'search trains') return els[j];
  }
  return null;
}
async function stepTapSearch(){
  if (trainListVisible()) return stepOk('tapSearch', { skipped: true, reason: 'list-already-showing' });
  var btn = findSearchButton();
  if (!btn) return stepMissing('tapSearch',
    'Search Trains control not found. On the page now: ' + dumpSearchCandidates());
  clickEl(btn);
  await sleep(2500);
  if (!trainListVisible()) { strongClick(btn); await sleep(2500); }
  for (var i = 0; i < 6 && !trainListVisible(); i++) {
    if (!guard()) return false;
    await sleep(1000);
  }
  if (trainListVisible()) return stepOk('tapSearch');
  return stepMissing('tapSearch', 'train list did not load after tapping Search');
}
async function stepWaitList(){
  if (trainListVisible()) { post('SEARCH_STEP', { step: 'waitList', skipped: true }); return true; }
  for (var i = 0; i < 36; i++) {
    if (!guard()) return false;
    if (trainListVisible()) return stepOk('waitList');
    await sleep(700);
  }
  return stepMissing('waitList', 'train list did not load');
}

// ---------- step 2: find the train's card, tap class tab + date, tap Book Now ----------
// "book"+"now": matches "Book Now" but never "Re-Book Favourite".
function bookNowish(el){
  if (!visible(el)) return false;
  var bt = norm(el.tagName === 'INPUT' ? (el.getAttribute('value') || '')
                                       : (el.innerText || el.textContent || ''));
  return bt === 'book now' || (bt.indexOf('book') >= 0 && bt.indexOf('now') >= 0);
}
function bookNowCount(scope){
  var bs = scope.querySelectorAll('button, input[type="submit"], input[type="button"]');
  var n = 0;
  for (var i = 0; i < bs.length; i++) if (bookNowish(bs[i])) n++;
  return n;
}
function findTrainCard(trainNo){
  // Score every Book Now button's ancestor chain: the train's card is the
  // SMALLEST ancestor whose subtree holds the wanted train number and
  // exactly one visible Book Now. A shared list container (many Book Nows)
  // can never win, so the first button in document order cannot shadow the
  // wanted train's own card with a wrong ancestor.
  var btns = document.querySelectorAll('button, input[type="submit"], input[type="button"]');
  var best = null, bestDepth = 1e9;
  for (var i = 0; i < btns.length; i++) {
    if (!bookNowish(btns[i])) continue;
    var p = btns[i].parentElement;
    for (var d = 0; d < 8 && p; d++, p = p.parentElement) {
      var t = p.innerText || '';
      if (t.indexOf(trainNo) !== -1 && bookNowCount(p) === 1 && d < bestDepth) {
        best = p; bestDepth = d;
      }
    }
  }
  return best;
}
// Belt-and-braces before the Book Now tap: the card must still be the wanted
// train's own card (one Book Now, train number present) — never a container
// that came to hold several trains after a re-render.
function cardVerified(card, trainNo){
  var t = '';
  try { t = card.innerText || ''; } catch (e) {}
  return t.indexOf(trainNo) !== -1 && bookNowCount(card) === 1;
}
var KNOWN_CLASSES = ['1A','2A','3A','SL','2S','CC','EC','FC','3E','EA','EV','VC','VS'];
function classTabs(card){
  var els = card.querySelectorAll('button, a, li, [role="tab"]');
  var tabs = [];
  for (var i = 0; i < els.length; i++) {
    if (!visible(els[i])) continue;
    var t = (els[i].innerText || '').trim().toUpperCase();
    if (t && t.length <= 4 && KNOWN_CLASSES.indexOf(t) !== -1) tabs.push({ el: els[i], code: t });
  }
  return tabs;
}
function findClassTab(card, code){
  var tabs = classTabs(card);
  if (!tabs.length) return null;
  if (code === 'ALL') return tabs[0].el;
  for (var j = 0; j < tabs.length; j++) if (tabs[j].code === code) return tabs[j].el;
  return null; // wanted class not offered — the caller halts instead of guessing
}
// Unexpanded card: class boxes like "Sleeper (SL)" / "AC 3 Economy (3E)".
// Tapping one expands the card into the tab strip. Smallest match wins so a
// surrounding container can never shadow the box itself.
function findClassBox(card, code){
  var want = code === 'ALL' ? null : '(' + code.toLowerCase() + ')';
  var els = card.querySelectorAll('button, div, a, li, span');
  var best = null, bestLen = 1e9;
  for (var i = 0; i < els.length; i++) {
    if (!visible(els[i])) continue;
    var t = norm(els[i].innerText || '');
    if (want && t.indexOf(want) === -1) continue;
    if (!want && t.indexOf('refresh') === -1) continue; // ALL: any class box
    if (t.length < 8 || t.length > 60) continue; // a box, not the card or page
    if (t.length < bestLen) { best = els[i]; bestLen = t.length; }
  }
  return best;
}
function findDateCard(card, dateCard){
  var els = card.querySelectorAll('button, div, li, span, a');
  var want = norm(dateCard);            // 'dd mon', e.g. '02 oct'
  var wantAlt = want.replace(/^0/, ''); // live cards sometimes drop the zero: '2 oct'
  var best = null, bestLen = 1e9;
  for (var i = 0; i < els.length; i++) {
    if (!visible(els[i])) continue;
    var t = norm(els[i].innerText || '');
    if (t.indexOf(want) === -1 && t.indexOf(wantAlt) === -1) continue;
    if (t.length < bestLen) { best = els[i]; bestLen = t.length; } // deepest/smallest match
  }
  return best;
}
// Selected-state read-back after a tap. A tap that didn't register leaves the
// page on the wrong class/date; the engine must halt instead of booking it.
function isActiveEl(el){
  var cls = ' ' + norm((el.className || '').toString()) + ' ';
  if (cls.indexOf('active') >= 0 || cls.indexOf('selected') >= 0 ||
      cls.indexOf('p-highlight') >= 0 || cls.indexOf('ui-state-active') >= 0) return true;
  try {
    if (el.getAttribute('aria-selected') === 'true' ||
        el.getAttribute('aria-pressed') === 'true') return true;
  } catch (e) {}
  return false;
}
// True when the wanted class is provably selected, or when the page exposes
// no selection markers at all (then there is nothing to verify against).
function classSelectionStuck(card, code){
  var tabs = classTabs(card);
  if (!tabs.length) return false;
  var anyActive = false;
  for (var i = 0; i < tabs.length; i++) {
    if (!isActiveEl(tabs[i].el)) continue;
    anyActive = true;
    if (tabs[i].code === code) return true;
  }
  return !anyActive; // no markers anywhere — cannot verify, trust the tap
}
function dateSelectionStuck(card, dateCard){
  var els = card.querySelectorAll('button, div, li, span, a');
  var want = norm(dateCard);
  var wantAlt = want.replace(/^0/, '');
  var anyActive = false;
  for (var i = 0; i < els.length; i++) {
    if (!visible(els[i]) || !isActiveEl(els[i])) continue;
    anyActive = true;
    var t = norm(els[i].innerText || '');
    if (t.indexOf(want) !== -1 || t.indexOf(wantAlt) !== -1) return true;
  }
  return !anyActive; // no markers anywhere — cannot verify, trust the tap
}
// The availability selector holds the journey date AND an availability
// marker ("AVAILABLE-0136", "WL35", "RAC12"). Requiring both excludes the
// card header's journey-date text — the old smallest-date-match tapped that
// decoy (seen on-device 2026-10-07: header "Thu, 08 Oct" won over the
// availability box), the tap did nothing, and Book Now stayed disabled.
function availMarker(t){
  return /available|waiting|wl|rac|regret/.test(t);
}
function findAvailabilityBox(card, dateCard){
  var els = card.querySelectorAll('button, div, li, span, a, [role="button"], [role="option"]');
  var want = norm(dateCard);
  var wantAlt = want.replace(/^0/, '');
  var best = null, bestLen = 1e9;
  for (var i = 0; i < els.length; i++) {
    if (!visible(els[i])) continue;
    var t = norm(els[i].innerText || '');
    if (t.indexOf(want) === -1 && t.indexOf(wantAlt) === -1) continue;
    if (!availMarker(t)) continue;
    if (t.length < bestLen) { best = els[i]; bestLen = t.length; }
  }
  return best;
}
// After tapping the availability box IRCTC sometimes opens a dropdown
// panel: the matching option inside it must be tapped too.
function findOpenDateOption(dateCard){
  var els = document.querySelectorAll('[role="option"], .p-dropdown-item, .ui-dropdown-item, li');
  var want = norm(dateCard), wantAlt = want.replace(/^0/, '');
  var plain = null;
  for (var i = 0; i < els.length; i++) {
    if (!visible(els[i])) continue;
    var t = norm(els[i].innerText || '');
    if (t.indexOf(want) === -1 && t.indexOf(wantAlt) === -1) continue;
    if (availMarker(t)) return els[i];
    if (!plain) plain = els[i];
  }
  return plain;
}
// Ground truth for "the availability tap registered": IRCTC enables
// Book Now only once a date/quota is selected for the class.
function bookNowEnabled(book){
  if (!book) return false;
  try {
    if (book.disabled) return false;
    var cls = ' ' + norm((book.className || '').toString()) + ' ';
    if (cls.indexOf('disabled') >= 0) return false;
    if (book.getAttribute('aria-disabled') === 'true') return false;
  } catch (e) {}
  return true;
}
async function stepSelectTrain(){
  var card = findTrainCard(PLAN.trainNo);
  if (!card) return stepMissing('selectTrain', 'train ' + PLAN.trainNo + ' not in list');
  var tabs = classTabs(card);
  var tab = findClassTab(card, PLAN.classCode);
  if (!tabs.length) {
    // Card is collapsed — tap the wanted class's box (or the first box) to
    // expand the tab strip. Tapping a box only expands; the tab tap below
    // is what actually selects the class.
    var box = findClassBox(card, PLAN.classCode) || findClassBox(card, 'ALL');
    if (!box) return stepMissing('selectTrain', 'no class boxes in train card');
    clickEl(box);
    await sleep(1200);
    card = findTrainCard(PLAN.trainNo) || card;
    tab = findClassTab(card, PLAN.classCode);
    if (!tab) return stepMissing('selectTrain', 'class ' + PLAN.classCode + ' not offered on train ' + PLAN.trainNo);
  } else if (!tab) {
    // Tabs are showing but the wanted class is not among them — never guess
    // a different class; halt for the user to choose.
    return stepMissing('selectTrain', 'class ' + PLAN.classCode + ' not offered on train ' + PLAN.trainNo);
  }
  // The code we expect to be selected after the tap ('ALL' means the first tab).
  var expectedCode = PLAN.classCode;
  if (expectedCode === 'ALL') {
    var tabsNow = classTabs(card);
    expectedCode = tabsNow.length ? tabsNow[0].code : null;
  }
  clickEl(tab);
  await sleep(900);
  // the card may re-render after the tab tap — re-locate it
  card = findTrainCard(PLAN.trainNo) || card;
  if (expectedCode && !classSelectionStuck(card, expectedCode))
    return stepMissing('selectTrain', 'class ' + PLAN.classCode + ' did not stick');
  var box = findAvailabilityBox(card, PLAN.dateCard) || findDateCard(card, PLAN.dateCard);
  if (!box) return stepMissing('selectTrain', 'date card ' + PLAN.dateCard + ' not found');
  clickEl(box);
  await sleep(900);
  // The availability control is sometimes a dropdown: the first tap only
  // opens the option list — then the matching option must be tapped.
  var opt = findOpenDateOption(PLAN.dateCard);
  if (opt) { clickEl(opt); await sleep(900); }
  card = findTrainCard(PLAN.trainNo) || card;
  var book = fuzzyButton('Book Now', card);
  if (!book) return stepMissing('bookNow', 'Book Now not in train card');
  // A tap that didn't register leaves Book Now disabled. Retry once with
  // real mouse events, then halt LOUD — never tap a dead button and burn
  // 30s in waitPax (seen on-device 2026-10-07).
  for (var att = 0; att < 2 && !bookNowEnabled(book); att++) {
    strongClick(box);
    await sleep(900);
    opt = findOpenDateOption(PLAN.dateCard);
    if (opt) { clickEl(opt); await sleep(900); }
    card = findTrainCard(PLAN.trainNo) || card;
    book = fuzzyButton('Book Now', card);
    if (!book) return stepMissing('bookNow', 'Book Now not in train card');
  }
  if (!bookNowEnabled(book))
    return stepMissing('bookNow', 'Book Now stayed disabled — the ' + PLAN.dateCard +
      ' availability selection did not register');
  // Never book a different date than the trip's.
  if (!dateSelectionStuck(card, PLAN.dateCard))
    return stepMissing('selectTrain', 'date ' + PLAN.dateCard + ' did not stick');
  if (!cardVerified(card, PLAN.trainNo))
    return stepMissing('bookNow', 'train card verification failed for ' + PLAN.trainNo);
  clickEl(book);
  await sleep(1500);
  // The tap must have moved us off the train list (passenger page loading
  // or the confirmation popup). Same card still on screen with no popup =
  // the tap didn't register — retry once with real mouse events.
  var cardGone = false;
  try { cardGone = !document.contains(card); } catch (e) {}
  if (!cardGone && !findPopup()) {
    var rCard = findTrainCard(PLAN.trainNo);
    var rBook = rCard ? fuzzyButton('Book Now', rCard) : null;
    if (rBook && bookNowEnabled(rBook)) { strongClick(rBook); await sleep(2000); }
  }
  return stepOk('selectTrain', { train: PLAN.trainNo, cls: PLAN.classCode });
}

// ---------- step 3: the station-mismatch confirmation — Yes, else nothing ----------
function findPopup(){
  var ds = document.querySelectorAll('[role="dialog"], [role="alertdialog"], .modal, .popup');
  for (var i = 0; i < ds.length; i++) if (visible(ds[i])) return ds[i];
  var all = document.querySelectorAll('div');
  for (var j = 0; j < all.length; j++) {
    if (!visible(all[j])) continue;
    var t = all[j].innerText || '';
    if (t.length < 600 && /do you want to continue/i.test(t)) return all[j];
  }
  return null;
}
// The one known confirmation is the station-mismatch dialog ("You searched
// trains from DTO to NDLS ... but booking from DTO to ANVT. Do you want to
// continue with it?"). A bare "do you want to continue" also matches other
// dialogs (e.g. a session-continue prompt) — those must NEVER be auto-
// affirmed. Require station-mismatch markers: from/to station codes or
// "boarding station" wording.
function isStationMismatch(txt){
  var t = norm(txt);
  if (!/do you want to continue/i.test(t)) return false;
  var hasStationCodes = /\\b[a-z]{2,5}\\b/.test(t) &&
    /booking from|searched trains|boarding/.test(t);
  var hasBoardingWord = /boarding/.test(t) && /station/.test(t);
  return hasStationCodes || hasBoardingWord;
}
async function stepPopup(){
  var popup = null;
  for (var i = 0; i < 9; i++) {
    if (!guard()) return false;
    popup = findPopup();
    if (popup) break;
    await sleep(650);
  }
  if (!popup) { post('POPUP_NONE', {}); return true; }
  var txt = popup.innerText || '';
  if (!isStationMismatch(txt)) { post('POPUP_UNKNOWN', { text: txt.slice(0, 160) }); return false; }
  var yes = popupAffirm(popup);
  if (!yes) { post('POPUP_UNKNOWN', { text: 'no Yes button' }); return false; }
  clickEl(yes);
  await sleep(1500);
  post('POPUP_YES', {});
  return true;
}

// The real confirmation button reads "Yes" with a leading checkmark icon
// ("✓ Yes"), so strip leading non-letters before comparing. Length-guarded
// so a "Yes, ..." sentence can never match — only a short affirm button.
function popupAffirm(popup){
  var btns = popup.querySelectorAll('button');
  for (var i = 0; i < btns.length; i++) {
    if (!visible(btns[i])) continue;
    var raw = norm(btns[i].innerText || btns[i].textContent || '');
    if (raw.length > 8) continue;
    var t = raw.replace(/^[^a-z]+/, '');
    if (t === 'yes' || t === 'ok') return btns[i];
  }
  return null;
}

// ---------- step 4: wait for the passenger-details page ----------
function passengerPageVisible(){
  // Positive detection: the passenger page has passenger name/age inputs.
  // (The old negative check — "/book now/ must be absent" — false-negatived
  // whenever the page's header/footer mentioned Book Now.)
  var inputs = document.querySelectorAll('input');
  var nameHits = 0, ageHits = 0;
  for (var i = 0; i < inputs.length; i++) {
    if (!visible(inputs[i])) continue;
    var ph = inputs[i].getAttribute('placeholder') || '';
    if (/full name as per govt/i.test(ph)) return true;
    var hay = norm(ph + ' ' + (inputs[i].getAttribute('aria-label') || '') + ' ' +
                   (inputs[i].getAttribute('name') || ''));
    if (/name/.test(hay)) nameHits++;
    if (/\\bage\\b/.test(hay)) ageHits++;
  }
  if (nameHits >= 1 && ageHits >= 1) return true;
  var t = '';
  try { t = document.body ? document.body.innerText : ''; } catch (e) {}
  return /passenger details/i.test(t);
}
async function stepWaitPax(){
  for (var i = 0; i < 43; i++) {
    if (!guard()) return false;
    if (passengerPageVisible()) { post('PASSENGER_PAGE_READY', {}); return true; }
    await sleep(700);
  }
  return stepMissing('waitPax', 'passenger page did not open');
}

// ---------- main ----------
async function run(){
  post('SEARCH_STARTED', {});
  // Resume: already on the passenger page (e.g. after a manual CAPTCHA/OTP)
  // — skip straight to the fill handoff.
  if (passengerPageVisible()) { post('PASSENGER_PAGE_READY', {}); return; }
  var steps = [stepTapSearch, stepWaitList, stepSelectTrain, stepPopup, stepWaitPax];
  for (var s = 0; s < steps.length; s++) {
    if (!guard()) return;
    var ok = await steps[s]();
    if (!ok) return; // reason already posted (MISSING / POPUP_UNKNOWN / CAPTCHA / OTP)
    await sleep(450);
  }
}
run();
})();`;
}
