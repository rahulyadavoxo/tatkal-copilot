/**
 * Pre-booking engine — drives IRCTC's home/search page up to the point where
 * the user reviews and taps "Search Trains" themselves.
 *
 * Steps (all idempotent — a re-run skips whatever is already done):
 *   1. language     — click the user's preferred language on the welcome alert
 *   2. openLogin    — tap the profile/login icon to open the LOGIN modal
 *   3. fillLogin    — fill the saved IRCTC user name + password
 *   4. submitLogin  — tap SIGN IN, unless a CAPTCHA is showing (then halt and
 *                     let the user solve it by hand — never bypassed)
 *   5. stationFrom  — type the station code, pick the matching suggestion
 *   6. stationTo    — same for the destination
 *   7. date         — set the journey date (DD/MM/YYYY, as IRCTC shows it)
 *   8. classDropdown— pick the trip's class (falls back to "All Classes")
 *   9. quotaDropdown— pick the trip's quota (GENERAL / TATKAL / …)
 *
 * Safety invariants (same family as the passenger fill engine):
 * - The script has ZERO booking capability: it never touches Search Trains,
 *   Continue, Book, or payment. It stops at PREBOOK_DONE; the user reviews
 *   the search form and taps Search Trains themselves.
 * - Credentials are embedded in the injected script only to be typed into
 *   IRCTC's official login inputs. They are NEVER included in event payloads
 *   (scanPrebookForViolations + unit tests enforce this).
 * - CAPTCHA/OTP are observed, never solved: the engine halts with
 *   CAPTCHA_REQUIRED / OTP_REQUIRED and the user takes over.
 */
import { findSubmitPatterns } from './fillEngine';

export interface PrebookStation {
  code: string; // e.g. 'BCT'
  name: string; // e.g. 'Mumbai Central'
}

export interface PrebookPlan {
  language: 'en' | 'hi';
  username: string;
  password: string;
  from: PrebookStation;
  to: PrebookStation;
  dateDMY: string; // 'DD/MM/YYYY' as shown on IRCTC's search form
  classCode: string; // e.g. '3A' (falls back to 'All Classes')
  quota: string; // e.g. 'TATKAL'
}

export type PrebookAction =
  | { kind: 'language' }
  | { kind: 'openLogin' }
  | { kind: 'fillLogin' }
  | { kind: 'submitLogin' }
  | { kind: 'station'; which: 'from' | 'to' }
  | { kind: 'date' }
  | { kind: 'dropdown'; which: 'class' | 'quota' };

export function buildPrebookActions(_plan: PrebookPlan): PrebookAction[] {
  return [
    { kind: 'language' },
    { kind: 'openLogin' },
    { kind: 'fillLogin' },
    { kind: 'submitLogin' },
    { kind: 'station', which: 'from' },
    { kind: 'station', which: 'to' },
    { kind: 'date' },
    { kind: 'dropdown', which: 'class' },
    { kind: 'dropdown', which: 'quota' },
  ];
}

export type PrebookEventType =
  | 'PREBOOK_STARTED'
  | 'PREBOOK_STEP'
  | 'PREBOOK_STEP_MISSING'
  | 'CAPTCHA_REQUIRED'
  | 'OTP_REQUIRED'
  | 'LOGIN_FAILED'
  | 'PREBOOK_DONE';

export interface PrebookEvent {
  type: PrebookEventType;
  t: number;
  data: Record<string, unknown>;
}

/** YYYY-MM-DD -> DD/MM/YYYY (the format IRCTC's search form displays). */
export function toDMY(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim());
  if (!m) throw new Error('Bad ISO date: ' + iso);
  return `${m[3]}/${m[2]}/${m[1]}`;
}

/**
 * Static safety scan of a generated pre-booking script. Empty = clean.
 * Reuses the passenger engine's submit-pattern list (no form submits, no
 * booking/continue/payment references) and additionally asserts the script
 * never posts credentials inside event payloads.
 */
export function scanPrebookForViolations(source: string): string[] {
  const hits = findSubmitPatterns(source);
  if (/post\(\s*['"][A-Z_]+['"]\s*,\s*\{[^}]*PLAN\./.test(source)) {
    hits.push('credential value in event payload');
  }
  return hits;
}

export interface PrebookBuildOptions {
  seed?: number;
}

export function buildPrebookScript(plan: PrebookPlan, opts: PrebookBuildOptions = {}): string {
  const planJson = JSON.stringify(plan);
  const seed = typeof opts.seed === 'number' ? opts.seed : Math.floor(Math.random() * 1e9);

  // NOTE: the template below is plain ES5-ish JS that runs inside the WebView.
  // It must not contain backticks or ${ — the outer template literal would
  // interpolate them. PLAN is embedded once at the top.
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
function setNativeInputValue(el, value){
  try {
    var proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    var setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
    setter.call(el, value);
  } catch (e) { el.value = value; }
  var evs = ['input', 'change'];
  for (var i = 0; i < evs.length; i++) {
    try { el.dispatchEvent(new Event(evs[i], { bubbles: true })); } catch (e) {}
  }
  try { el.dispatchEvent(new Event('blur', { bubbles: true })); } catch (e) {}
}
function attrHaystack(el){
  var parts = [el.getAttribute('placeholder'), el.getAttribute('aria-label'),
    el.getAttribute('name'), el.getAttribute('formcontrolname'), el.id, el.className];
  try {
    var attrs = el.attributes;
    for (var i = 0; i < attrs.length; i++) {
      if (attrs[i].name.indexOf('data-') === 0) parts.push(attrs[i].name + ' ' + attrs[i].value);
    }
  } catch (e) {}
  return parts.join(' ');
}
function controlLabelText(el){
  var parts = [];
  try { if (el.labels) for (var i = 0; i < el.labels.length; i++) parts.push(el.labels[i].innerText); } catch (e) {}
  var p = el.parentElement, depth = 0;
  while (p && depth < 3) {
    var t = '';
    try { t = p.innerText || ''; } catch (e) {}
    if (t && t.length < 120) parts.push(t);
    p = p.parentElement; depth++;
  }
  return parts.join(' ');
}
function directLabelText(el){
  var parts = [];
  try {
    if (el.labels) for (var i = 0; i < el.labels.length; i++) parts.push(el.labels[i].innerText || '');
  } catch (e) {}
  return parts.join(' ');
}
function otpInputVisible(){
  // True only when a real OTP *field* is on screen. The live IRCTC login
  // modal carries static help text ("...receive OTP instead of...") for
  // visually impaired users — that prose, and the opt-in checkbox itself,
  // must NOT count as an OTP challenge (user report 2026-09-27: OTP login
  // exists only for the visually-impaired path).
  var inputs = document.querySelectorAll('input');
  for (var k = 0; k < inputs.length; k++) {
    var el = inputs[k];
    if (!visible(el)) continue;
    var type = (el.getAttribute('type') || '').toLowerCase();
    if (type === 'checkbox' || type === 'radio' || type === 'hidden' ||
        type === 'submit' || type === 'button' || type === 'image') continue;
    var hay = norm(attrHaystack(el) + ' ' + directLabelText(el));
    if (/otp|one[\\s-]?time/.test(hay)) return true;
  }
  return false;
}
function stepMissing(step, detail){
  post('PREBOOK_STEP_MISSING', detail ? { step: step, detail: detail } : { step: step });
  return false;
}
function stepOk(step, extra){
  var d = { step: step };
  if (extra) for (var k in extra) d[k] = extra[k];
  post('PREBOOK_STEP', d);
  return true;
}

// ---------- step 1: welcome-screen language ----------
function visibleButtonExact(text){
  var bs = document.querySelectorAll('button');
  for (var i = 0; i < bs.length; i++) {
    if ((bs[i].innerText || '').trim() === text && visible(bs[i])) return bs[i];
  }
  return null;
}
async function stepLanguage(){
  var want = PLAN.language === 'hi' ? 'हिंदी' : 'English';
  var btn = visibleButtonExact(want);
  var other = visibleButtonExact(want === 'English' ? 'हिंदी' : 'English');
  if (!btn && !other) return stepOk('language', { skipped: true });
  if (!btn) return stepMissing('language');
  clickEl(btn);
  await sleep(700);
  return stepOk('language');
}

// ---------- login helpers ----------
function loginModal(){
  var inputs = document.querySelectorAll('input');
  for (var i = 0; i < inputs.length; i++) {
    var el = inputs[i];
    if (!visible(el)) continue;
    var type = (el.getAttribute('type') || '').toLowerCase();
    if (type === 'password') continue;
    if (/user\\s?name/.test(norm(attrHaystack(el)))) {
      var p = el;
      for (var d = 0; d < 6 && p; d++, p = p.parentElement) {
        var cls = norm((p.className || '').toString());
        if (/modal|dialog|popup/.test(cls) || p.getAttribute('role') === 'dialog') return p;
      }
      return el.parentElement;
    }
  }
  return null;
}
function isLoggedIn(){
  if (loginModal()) return false;
  var t = '';
  try { t = norm(document.body ? document.body.innerText : ''); } catch (e) {}
  return /my account|log\\s?out|my profile/.test(t);
}
function clickableAncestor(el){
  var p = el, d = 0;
  while (p && d < 4) {
    var tag = (p.tagName || '').toLowerCase();
    if (tag === 'button' || tag === 'a' || p.getAttribute('role') === 'button') return p;
    p = p.parentElement; d++;
  }
  return el;
}
function inTopHeader(el){
  try {
    var r = el.getBoundingClientRect();
    return r && r.top >= -20 && r.top < 170 && r.width > 0 && r.height > 0;
  } catch (e) { return false; }
}
// Ordered openLogin candidates, best first. The live IRCTC mobile header
// (user screenshots 2026-09-27) shows an icon-only person glyph with no
// accessible name, rendered inside an Angular component element rather than
// a <header> tag — so the icon search scans the whole top strip, not just
// <header>. A wrong tap is harmless: stepOpenLogin re-checks for the modal
// after every candidate and falls back to "do it by hand".
function loginCandidates(){
  var out = [], seen = [], i, el, al, ident, j;
  function push(c){ if (c && seen.indexOf(c) < 0) { seen.push(c); out.push(c); } }
  var clickables = document.querySelectorAll('button, a, [role="button"]');
  // T1: accessible name says login / sign in.
  for (i = 0; i < clickables.length; i++) {
    el = clickables[i]; if (!visible(el)) continue;
    al = norm((el.getAttribute('aria-label') || '') + ' ' + (el.getAttribute('title') || ''));
    if (/log\\s?in|sign\\s?in/.test(al)) push(el);
  }
  // T2: visible text is exactly "login".
  for (i = 0; i < clickables.length; i++) {
    el = clickables[i]; if (!visible(el)) continue;
    if (/^\\s*log\\s?in\\s*$/i.test(el.innerText || '')) push(el);
  }
  // T3: class/id/name carries login/signin.
  for (i = 0; i < clickables.length; i++) {
    el = clickables[i]; if (!visible(el)) continue;
    ident = norm((el.className || '').toString()) + ' ' +
            norm(el.getAttribute('id') || '') + ' ' +
            norm(el.getAttribute('name') || '');
    if (/login|signin/.test(ident)) push(el);
  }
  // T4: icon-only person/user glyph in the top strip (no <header> assumption).
  var all = document.querySelectorAll('i, img, svg, span, div, a, button');
  var hits = [];
  for (i = 0; i < all.length; i++) {
    el = all[i]; if (!visible(el) || !inTopHeader(el)) continue;
    var own = norm((el.className || '').toString()) + ' ' +
              norm(el.getAttribute('src') || '') + ' ' +
              norm(el.getAttribute('alt') || '') + ' ' +
              norm(el.getAttribute('title') || '');
    var inner = norm(el.innerHTML || '').slice(0, 200);
    if (/user|person|account|fa-user/.test(own) || /login|signin|profile/.test(own) ||
        /user|person|account|login|profile/.test(inner)) {
      hits.push(el);
    }
  }
  // keep only the innermost hits so a wrapper's markup can't shadow the icon
  var innerHits = [], isAnc;
  for (i = 0; i < hits.length; i++) {
    isAnc = false;
    for (j = 0; j < hits.length; j++) {
      if (i !== j && hits[i].contains(hits[j])) { isAnc = true; break; }
    }
    if (!isAnc) innerHits.push(hits[i]);
  }
  for (i = 0; i < innerHits.length; i++) push(clickableAncestor(innerHits[i]));
  // T5: positional fallback — clickables in the top-right corner of the
  // viewport (the live page puts the person glyph top-right), rightmost first.
  var corner = [];
  for (i = 0; i < clickables.length; i++) {
    el = clickables[i]; if (!visible(el) || !inTopHeader(el)) continue;
    try {
      var r = el.getBoundingClientRect();
      var vw = window.innerWidth || 1000;
      if (r.right > vw - 170) corner.push(el);
    } catch (e) {}
  }
  corner.sort(function(a, b){
    try { return b.getBoundingClientRect().right - a.getBoundingClientRect().right; }
    catch (e) { return 0; }
  });
  for (i = 0; i < corner.length && i < 4; i++) push(corner[i]);
  return out;
}
function captchaPresent(){
  var imgs = document.querySelectorAll('img');
  for (var i = 0; i < imgs.length; i++) {
    if (!visible(imgs[i])) continue;
    var h = norm((imgs[i].getAttribute('src') || '') + ' ' + (imgs[i].getAttribute('alt') || ''));
    if (/captcha/.test(h)) return true;
  }
  var inputs = document.querySelectorAll('input');
  for (var j = 0; j < inputs.length; j++) {
    if (!visible(inputs[j])) continue;
    if (/captcha/.test(norm(attrHaystack(inputs[j])))) return true;
  }
  return false;
}
async function stepOpenLogin(){
  if (isLoggedIn()) return stepOk('openLogin', { skipped: true, reason: 'already-logged-in' });
  if (loginModal()) return stepOk('openLogin', { skipped: true, reason: 'already-open' });
  var cands = loginCandidates();
  for (var k = 0; k < cands.length && k < 6; k++) {
    clickEl(cands[k]);
    await sleep(1200);
    if (loginModal()) return stepOk('openLogin', { candidate: k });
    // dismiss anything the tap may have opened (e.g. a notifications panel)
    try { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, bubbles: true })); } catch (e) {}
    await sleep(300);
  }
  return stepMissing('openLogin');
}
function findLoginInputs(){
  var user = null, pass = null;
  var inputs = document.querySelectorAll('input');
  for (var i = 0; i < inputs.length; i++) {
    var el = inputs[i];
    if (!visible(el)) continue;
    var hay = norm(attrHaystack(el) + ' ' + directLabelText(el));
    var type = (el.getAttribute('type') || '').toLowerCase();
    if (!user && /user\\s?name|login\\s?id/.test(hay) && type !== 'password') user = el;
    if (!pass && (type === 'password' || /password/.test(hay))) pass = el;
  }
  return { user: user, pass: pass };
}
async function stepFillLogin(){
  if (isLoggedIn()) return stepOk('fillLogin', { skipped: true });
  var f = findLoginInputs();
  if (!f.user || !f.pass) return stepMissing('fillLogin');
  setNativeInputValue(f.user, PLAN.username);
  await sleep(250);
  setNativeInputValue(f.pass, PLAN.password);
  await sleep(250);
  return stepOk('fillLogin');
}
async function stepSubmitLogin(){
  if (isLoggedIn()) return stepOk('submitLogin', { skipped: true });
  if (captchaPresent()) { post('CAPTCHA_REQUIRED', {}); return false; }
  var scope = loginModal() || document;
  var btn = null;
  var bs = scope.querySelectorAll('button');
  for (var i = 0; i < bs.length; i++) {
    if (visible(bs[i]) && /^\\s*sign\\s?in\\s*$/i.test(bs[i].innerText || '')) { btn = bs[i]; break; }
  }
  if (!btn) return stepMissing('submitLogin');
  // A plain button click — the login the user explicitly asked for.
  // Never a programmatic form submission, and never anything
  // booking-related.
  clickEl(btn);
  await sleep(2500);
  if (captchaPresent()) { post('CAPTCHA_REQUIRED', {}); return false; }
  if (loginModal()) { post('LOGIN_FAILED', {}); return false; }
  return stepOk('submitLogin');
}

// ---------- search-form helpers ----------
function findStationInput(which){
  var re = which === 'from' ? /^\\s*from/i : /^\\s*to\\b/i;
  var inputs = document.querySelectorAll('input[type="text"], input:not([type])');
  var labelHits = [];
  for (var i = 0; i < inputs.length; i++) {
    var el = inputs[i];
    if (!visible(el)) continue;
    var attr = norm((el.getAttribute('placeholder') || '') + ' ' +
      (el.getAttribute('aria-label') || '') + ' ' + (el.getAttribute('name') || ''));
    if (re.test(attr)) return el; // attribute match outranks caption match
    if (re.test(norm(controlLabelText(el)))) labelHits.push(el);
  }
  return labelHits.length ? labelHits[0] : null;
}
async function setAutocomplete(input, code){
  input.focus();
  setNativeInputValue(input, code);
  await sleep(900);
  var picked = null;
  var codeRe = new RegExp('\\\\b' + code + '\\\\b', 'i');
  for (var round = 0; round < 6 && !picked; round++) {
    var items = document.querySelectorAll('li[role="option"], ul li, .p-autocomplete-item, .ui-autocomplete-item');
    for (var i = 0; i < items.length; i++) {
      if (!visible(items[i])) continue;
      var t = items[i].innerText || items[i].textContent || '';
      if (codeRe.test(t)) { picked = items[i]; break; }
    }
    if (!picked) await sleep(500);
  }
  if (!picked) return false;
  clickEl(picked);
  await sleep(500);
  return codeRe.test(input.value || '');
}
async function stepStation(which){
  var st = which === 'from' ? PLAN.from : PLAN.to;
  var input = findStationInput(which);
  if (!input) return stepMissing('station', which);
  var cur = norm(input.value || '');
  if (cur.indexOf(norm(st.code)) !== -1) return stepOk('station', { which: which, skipped: true });
  var ok = await setAutocomplete(input, st.code);
  if (!ok) return stepMissing('station', which + ':' + st.code);
  return stepOk('station', { which: which });
}
function findDateInput(){
  var inputs = document.querySelectorAll('input');
  for (var i = 0; i < inputs.length; i++) {
    var el = inputs[i];
    if (!visible(el)) continue;
    var type = (el.getAttribute('type') || '').toLowerCase();
    if (type === 'date') return el;
    var hay = norm(attrHaystack(el) + ' ' + controlLabelText(el));
    if (/dd\\/mm\\/yyyy|journey date|travel date/.test(hay)) return el;
  }
  return null;
}
function dateDigits(v){ return (v || '').replace(/[^0-9]/g, ''); }
function dateInputValueMatches(input, dmy){
  var v = dateDigits(input.value), t = dateDigits(dmy);
  return v.length >= 6 && v === t;
}
function parseDMY(dmy){
  var m = /^(\\d{1,2})\\/(\\d{1,2})\\/(\\d{4})$/.exec(dmy || '');
  return m ? { d: +m[1], m: +m[2], y: +m[3] } : null;
}
// The live IRCTC date field is a readonly calendar widget: its value can only
// be set by tapping it and picking a day in the overlay. Typing into it never
// registers, and a left-open overlay blocks the class/quota dropdowns — both
// caused the 2026-09-27 on-device stall. Detection is library-agnostic
// (PrimeNG fast paths + generic fallbacks) because the live markup drifts.
var CAL_MONTHS = ['january','february','march','april','may','june','july','august','september','october','november','december'];
function calMonthYearFromText(t){
  var m = null;
  for (var i = 0; i < CAL_MONTHS.length; i++) if (t.indexOf(CAL_MONTHS[i]) >= 0) m = i + 1;
  var ym = /(\\d{4})/.exec(t);
  return (m && ym) ? { m: m, y: +ym[1] } : null;
}
function findCalendarOverlay(){
  var dps = document.querySelectorAll('.p-datepicker');
  for (var i = 0; i < dps.length; i++) {
    if (visible(dps[i]) && dps[i].querySelector('.p-datepicker-calendar, table')) return dps[i];
  }
  // Generic fallback: smallest visible panel holding a "Month YYYY" title and
  // a grid of day numbers (covers non-PrimeNG calendar builds).
  var best = null, bestArea = Infinity;
  var els = document.querySelectorAll('div, section, aside');
  for (var j = 0; j < els.length; j++) {
    var el = els[j];
    if (!visible(el)) continue;
    var r = el.getBoundingClientRect();
    if (r.width < 160 || r.height < 160) continue;
    if (r.width > window.innerWidth * 0.97 && r.height > window.innerHeight * 0.9) continue;
    var t = norm(el.innerText || '');
    if (!calMonthYearFromText(t)) continue;
    var dayCount = 0;
    var toks = t.replace(/[^0-9]+/g, ' ').trim().split(' ');
    for (var k = 0; k < toks.length; k++) {
      var nv = +toks[k];
      if (nv >= 1 && nv <= 31) dayCount++;
    }
    if (dayCount < 28) continue;
    var area = r.width * r.height;
    if (area < bestArea) { best = el; bestArea = area; }
  }
  return best;
}
function overlayMonthYear(root){
  var ms = root.querySelector('select.p-datepicker-month, select[data-month]');
  var ys = root.querySelector('select.p-datepicker-year, select[data-year]');
  if (ms && ys) {
    var yv = ys.value || (ys.options[ys.selectedIndex] && ys.options[ys.selectedIndex].text);
    var y = parseInt(yv, 10);
    if (ms.selectedIndex >= 0 && y) return { m: ms.selectedIndex + 1, y: y };
  }
  var title = root.querySelector('.p-datepicker-title, [class*="calendar-title"], [class*="datepicker-title"]');
  var t = norm((title && (title.innerText || title.textContent)) || '');
  var my = t ? calMonthYearFromText(t) : null;
  if (my) return my;
  // generic: first short "Month YYYY" text among descendants
  var els = root.querySelectorAll('div, span, button, caption, h1, h2, h3, h4');
  for (var i = 0; i < els.length; i++) {
    var et = norm(els[i].innerText || els[i].textContent || '');
    if (!et || et.length > 40) continue;
    var g = calMonthYearFromText(et);
    if (g) return g;
  }
  return null;
}
function calTitleEl(root){
  // deepest element whose own text is the "Month YYYY" title
  var found = null;
  var els = root.querySelectorAll('div, span, button, caption, h1, h2, h3, h4');
  for (var i = 0; i < els.length; i++) {
    var et = norm(els[i].innerText || els[i].textContent || '');
    if (!et || et.length > 40) continue;
    if (calMonthYearFromText(et)) found = els[i];
  }
  return found;
}
function calNavButton(root, prev){
  var b = root.querySelector(prev ? '.p-datepicker-prev' : '.p-datepicker-next');
  if (b && visible(b)) return b;
  // structural: the buttons flanking the month-year title are prev/next
  // (covers icon-font chevrons with no text or aria-label — the 2026-09-29
  // on-device "would not turn to your travel month" failure)
  try {
    var titleEl = calTitleEl(root);
    if (titleEl && titleEl.parentElement) {
      var sibs = titleEl.parentElement.children;
      var ti = -1;
      for (var s = 0; s < sibs.length; s++) if (sibs[s] === titleEl) ti = s;
      if (ti >= 0) {
        var cands = prev ? [ti - 1, ti - 2] : [ti + 1, ti + 2];
        for (var q = 0; q < cands.length; q++) {
          var sb = sibs[cands[q]];
          if (!sb) continue;
          var bb = (sb.tagName === 'BUTTON' || sb.tagName === 'A' ||
                    (sb.getAttribute && sb.getAttribute('role') === 'button'))
                   ? sb : sb.querySelector('button, a, [role="button"]');
          if (bb && visible(bb)) return bb;
        }
      }
    }
  } catch (e) {}
  // heuristics: aria-label, chevron text, or chevron icon classes
  var btns = root.querySelectorAll('button, [role="button"], a');
  for (var i = 0; i < btns.length; i++) {
    var el = btns[i];
    if (!visible(el)) continue;
    var lab = norm(el.getAttribute('aria-label') || '');
    var txt = norm(el.innerText || el.textContent || '').trim();
    var cls = norm(el.className || '');
    try { cls += ' ' + norm(el.innerHTML || ''); } catch (e2) {}
    var isPrev = lab.indexOf('prev') >= 0 || txt === '‹' || txt === '<' || txt === '«' ||
                 cls.indexOf('prev') >= 0 || /chevron-left|arrow-left|caret-left|angle-left/.test(cls);
    var isNext = lab.indexOf('next') >= 0 || txt === '›' || txt === '>' || txt === '»' ||
                 cls.indexOf('next') >= 0 || /chevron-right|arrow-right|caret-right|angle-right/.test(cls);
    if (prev && isPrev && !isNext) return el;
    if (!prev && isNext && !isPrev) return el;
  }
  return null;
}
function dismissCalendar(){
  try {
    var ev = new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, bubbles: true });
    document.dispatchEvent(ev);
  } catch (e) {}
}
function calDayText(el){
  return norm(el.innerText || el.textContent || '').replace(/\\s+/g, ' ').trim();
}
function calDisabled(el){
  if (!el) return false;
  var cls = ' ' + (el.className || '') + ' ';
  if (cls.indexOf('p-disabled') >= 0 || cls.indexOf('disabled') >= 0) return true;
  try {
    if (el.getAttribute('aria-disabled') === 'true') return true;
    if (el.hasAttribute('disabled')) return true;
  } catch (e) {}
  return false;
}
function findDayCell(root, dayNum){
  var want = String(dayNum);
  // fast path: PrimeNG-style table cells (tolerates padded day text and
  // span-level disabled, as seen on the live page 2026-09-27)
  var cells = root.querySelectorAll('.p-datepicker-calendar td, table td');
  for (var c = 0; c < cells.length; c++) {
    var td = cells[c];
    var tcls = ' ' + (td.className || '') + ' ';
    if (tcls.indexOf('other-month') >= 0) continue;
    var inner = td.querySelector('span, a, button') || td;
    if (calDisabled(td) || calDisabled(inner)) continue;
    if (calDayText(inner) === want) return inner;
  }
  // generic: smallest visible leaf whose whole text is the day number
  var best = null, bestArea = Infinity;
  var els = root.querySelectorAll('button, a, span, td, div');
  for (var i = 0; i < els.length; i++) {
    var el = els[i];
    if (!visible(el)) continue;
    if (calDisabled(el)) continue;
    if (calDayText(el) !== want) continue;
    var r = el.getBoundingClientRect();
    var area = r.width * r.height;
    if (area > 0 && area < bestArea) { best = el; bestArea = area; }
  }
  return best;
}
// Returns true on success, otherwise a short reason code for diagnostics.
async function pickDateFromCalendar(input, target){
  var dp = null;
  for (var tap = 0; tap < 3 && !dp; tap++) {
    clickEl(input);
    for (var w = 0; w < 20 && !dp; w++) { await sleep(250); dp = findCalendarOverlay(); }
    if (!dp) await sleep(500);
  }
  if (!dp) return 'no-overlay';
  var stuck = 0, lastKey = '';
  for (var n = 0; n < 30; n++) {
    var shown = overlayMonthYear(dp);
    if (!shown) return 'no-title';
    if (shown.m === target.m && shown.y === target.y) break;
    var key = shown.m + '/' + shown.y;
    stuck = (key === lastKey) ? stuck + 1 : 0;
    lastKey = key;
    if (stuck >= 3) return 'no-nav'; // taps are not turning the month
    var goPrev = (shown.y > target.y) || (shown.y === target.y && shown.m > target.m);
    var btn = calNavButton(dp, goPrev);
    if (!btn) return 'no-nav';
    clickEl(btn);
    await sleep(450);
    dp = findCalendarOverlay() || dp;
  }
  var fin = overlayMonthYear(dp);
  if (!fin || fin.m !== target.m || fin.y !== target.y) return 'no-nav';
  var hit = findDayCell(dp, target.d);
  if (!hit) return 'no-day';
  clickEl(hit);
  await sleep(600);
  var cellParent = null;
  try { cellParent = hit.parentElement; } catch (e) {}
  if (!dateInputValueMatches(input, PLAN.dateDMY) && cellParent && cellParent !== hit) {
    clickEl(cellParent); // some builds listen on the cell itself
    await sleep(600);
  }
  dismissCalendar();
  await sleep(300);
  return dateInputValueMatches(input, PLAN.dateDMY) ? true : 'no-verify';
}
async function stepDate(){
  var input = findDateInput();
  if (!input) return stepMissing('date');
  if (dateInputValueMatches(input, PLAN.dateDMY)) return stepOk('date', { skipped: true });
  var target = parseDMY(PLAN.dateDMY);
  if (!target) return stepMissing('date');
  var ro = false;
  try { ro = input.hasAttribute('readonly') || !!input.readOnly; } catch (e) {}
  if (!ro) {
    setNativeInputValue(input, PLAN.dateDMY);
    await sleep(400);
  }
  if (!dateInputValueMatches(input, PLAN.dateDMY)) {
    var picked = await pickDateFromCalendar(input, target);
    if (picked !== true || !dateInputValueMatches(input, PLAN.dateDMY))
      return stepMissing('date', typeof picked === 'string' ? picked : 'no-verify');
  }
  if (findCalendarOverlay()) { dismissCalendar(); await sleep(300); }
  return stepOk('date');
}
function isOptionEl(el){
  var tag = (el.tagName || '').toLowerCase();
  if (tag === 'option' || tag === 'li') return true;
  var cls = ' ' + (el.className || '') + ' ';
  if (cls.indexOf('p-dropdown-item') >= 0 || cls.indexOf('ui-dropdown-item') >= 0) return true;
  try { if (el.getAttribute('role') === 'option') return true; } catch (e) {}
  return false;
}
function findDropdown(res){
  var cands = document.querySelectorAll(
    'select, mat-select, .p-dropdown, [role="combobox"], .ui-dropdown, ' +
    'div[class*="dropdown"], button[class*="dropdown"]');
  var labelHits = [];
  for (var i = 0; i < cands.length; i++) {
    var el = cands[i];
    if (!visible(el) || isOptionEl(el)) continue;
    var attr = norm(attrHaystack(el));
    var hit = false, attrHit = false;
    for (var r = 0; r < res.length; r++) {
      if (res[r].test(attr)) { hit = true; attrHit = true; break; }
      if (res[r].test(norm(controlLabelText(el)))) { hit = true; break; }
    }
    if (hit) { if (attrHit) return el; labelHits.push(el); }
  }
  return labelHits.length ? labelHits[0] : null;
}
var QUOTA_VALUE_TEXTS = ['general', 'ladies', 'lower berth/sr.citizen',
  'person with disability', 'duty pass', 'tatkal', 'premium tatkal'];
var CLASS_VALUE_TEXTS = ['all classes'];
function findDropdownByValue(texts){
  // The live quota control (2026-09-29) carries no "quota" in its attributes
  // or nearby labels — find it by the value it currently displays instead.
  var cands = document.querySelectorAll(
    'select, mat-select, .p-dropdown, [role="combobox"], .ui-dropdown, ' +
    'div[class*="dropdown"], button[class*="dropdown"]');
  for (var i = 0; i < cands.length; i++) {
    var el = cands[i];
    if (!visible(el) || isOptionEl(el)) continue;
    var cls = ' ' + norm(el.className || '') + ' ';
    if (cls.indexOf('panel') >= 0) continue; // option panel, not the control
    if (texts.indexOf(norm(dropdownCurrent(el))) >= 0) return el;
  }
  return null;
}
function fireChange(el){
  try { el.dispatchEvent(new Event('change', { bubbles: true })); } catch (e) {}
  try { el.dispatchEvent(new Event('blur', { bubbles: true })); } catch (e) {}
}
function displayMatches(displayed, want){
  // exact ("general") or parenthesized code ("ac first class (1a)" vs "1a").
  // Plain substring is NOT enough: "premium tatkal" contains "tatkal".
  var w = norm(want || '');
  if (!w) return false;
  return displayed === w || displayed.indexOf('(' + w + ')') >= 0;
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
async function pickCustomOption(el, wantedList, strong){
  clickEl(el);
  await sleep(700);
  var items = [];
  var scoped = el.querySelectorAll('[role="option"], li, .p-dropdown-item, .ui-dropdown-item, option');
  var i;
  for (i = 0; i < scoped.length; i++) if (visible(scoped[i])) items.push(scoped[i]);
  if (!items.length) {
    // PrimeNG-style panels render at the body level, outside the control
    var all = document.querySelectorAll(
      '[role="option"], .p-dropdown-item, .ui-dropdown-item, ' +
      '.p-dropdown-panel li, .ui-dropdown-panel li, [role="listbox"] li');
    for (i = 0; i < all.length && items.length < 60; i++) if (visible(all[i])) items.push(all[i]);
  }
  // try each wanted value in preference order (exact first, then substring)
  for (var w = 0; w < wantedList.length; w++) {
    for (var pass = 0; pass < 2; pass++) {
      for (var k = 0; k < items.length; k++) {
        var t = ((items[k].innerText || items[k].textContent) || '').trim().toLowerCase();
        var want = wantedList[w].toLowerCase();
        var match = pass === 0 ? t === want : t.indexOf(want) !== -1;
        if (match) {
          if (strong) strongClick(items[k]); else clickEl(items[k]);
          await sleep(400);
          return true;
        }
      }
    }
  }
  return false;
}
async function setDropdownValue(el, wantedList, strong){
  var tag = (el.tagName || '').toLowerCase();
  if (tag === 'select') {
    for (var w = 0; w < wantedList.length; w++) {
      for (var i = 0; i < el.options.length; i++) {
        if ((el.options[i].text || '').trim().toLowerCase() === wantedList[w].toLowerCase()) {
          el.value = el.options[i].value;
          fireChange(el);
          return true;
        }
      }
    }
    return false;
  }
  return pickCustomOption(el, wantedList, strong);
}
function dropdownCurrent(el){
  var tag = (el.tagName || '').toLowerCase();
  if (tag === 'select' && el.selectedIndex >= 0 && el.options[el.selectedIndex])
    return (el.options[el.selectedIndex].text || '').trim();
  return ((el.innerText || el.textContent) || '').trim().split('\\n')[0];
}
async function stepDropdown(which){
  var res = which === 'class' ? [/class/] : [/quota/];
  var wanted = which === 'class' ? [PLAN.classCode, 'All Classes'] : [PLAN.quota];
  var byVal = which === 'class' ? CLASS_VALUE_TEXTS : QUOTA_VALUE_TEXTS;
  var el = findDropdown(res);
  if (!el) el = findDropdownByValue(byVal);
  if (!el) return stepMissing('dropdown', which + ':not-found');
  if (displayMatches(norm(dropdownCurrent(el)), wanted[0]))
    return stepOk('dropdown', { which: which, skipped: true });
  for (var attempt = 0; attempt < 2; attempt++) {
    var ok = await setDropdownValue(el, wanted, attempt > 0);
    if (!ok) return stepMissing('dropdown', which + ':no-option');
    await sleep(500);
    el = findDropdown(res) || findDropdownByValue(byVal) || el;
    var disp = norm(dropdownCurrent(el));
    for (var vi = 0; vi < wanted.length; vi++) {
      if (displayMatches(disp, wanted[vi])) return stepOk('dropdown', { which: which });
    }
  }
  // The option tap did not change the displayed value (seen on-device
  // 2026-09-29: quota panel stayed open on GENERAL after PREBOOK_DONE).
  return stepMissing('dropdown', which + ':no-stick');
}

// ---------- main ----------
async function run(){
  post('PREBOOK_STARTED', {});
  var steps = [
    stepLanguage, stepOpenLogin, stepFillLogin, stepSubmitLogin,
    function(){ return stepStation('from'); },
    function(){ return stepStation('to'); },
    stepDate,
    function(){ return stepDropdown('class'); },
    function(){ return stepDropdown('quota'); },
  ];
  for (var s = 0; s < steps.length; s++) {
    if (otpInputVisible()) { post('OTP_REQUIRED', {}); return; }
    var ok = await steps[s]();
    if (!ok) return; // reason already posted (MISSING / CAPTCHA / LOGIN_FAILED)
    await sleep(450);
  }
  post('PREBOOK_DONE', {});
}
run();
})();`;
}
