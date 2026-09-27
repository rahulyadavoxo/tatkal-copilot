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
function otpInputVisible(){
  var inputs = document.querySelectorAll('input');
  for (var k = 0; k < inputs.length; k++) {
    if (!visible(inputs[k])) continue;
    var hay = norm(attrHaystack(inputs[k]) + ' ' + controlLabelText(inputs[k]));
    if (/otp/.test(hay)) return true;
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
function findProfileControl(){
  var els = document.querySelectorAll('button, a, [role="button"]');
  var i, el;
  for (i = 0; i < els.length; i++) {
    el = els[i]; if (!visible(el)) continue;
    var al = norm((el.getAttribute('aria-label') || '') + ' ' + (el.getAttribute('title') || ''));
    if (/log\\s?in/.test(al)) return el;
  }
  for (i = 0; i < els.length; i++) {
    el = els[i]; if (!visible(el)) continue;
    if (/^\\s*log\\s?in\\s*$/i.test(el.innerText || '')) return el;
  }
  return null;
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
  var c = findProfileControl();
  if (!c) return stepMissing('openLogin');
  clickEl(c);
  await sleep(1200);
  if (!loginModal()) return stepMissing('openLogin');
  return stepOk('openLogin');
}
function findLoginInputs(){
  var user = null, pass = null;
  var inputs = document.querySelectorAll('input');
  for (var i = 0; i < inputs.length; i++) {
    var el = inputs[i];
    if (!visible(el)) continue;
    var hay = norm(attrHaystack(el));
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
async function stepDate(){
  var input = findDateInput();
  if (!input) return stepMissing('date');
  if ((input.value || '').trim() === PLAN.dateDMY) return stepOk('date', { skipped: true });
  setNativeInputValue(input, PLAN.dateDMY);
  await sleep(400);
  return stepOk('date');
}
function findDropdown(res){
  var cands = document.querySelectorAll('select, mat-select, .p-dropdown, [role="combobox"], .ui-dropdown');
  var labelHits = [];
  for (var i = 0; i < cands.length; i++) {
    var el = cands[i];
    if (!visible(el)) continue;
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
function fireChange(el){
  try { el.dispatchEvent(new Event('change', { bubbles: true })); } catch (e) {}
  try { el.dispatchEvent(new Event('blur', { bubbles: true })); } catch (e) {}
}
async function pickCustomOption(el, wantedList){
  clickEl(el);
  await sleep(700);
  var items = [];
  var scoped = el.querySelectorAll('[role="option"], li, .p-dropdown-item, .ui-dropdown-item, option');
  var i;
  for (i = 0; i < scoped.length; i++) if (visible(scoped[i])) items.push(scoped[i]);
  if (!items.length) {
    var all = document.querySelectorAll('[role="option"]');
    for (i = 0; i < all.length && items.length < 60; i++) if (visible(all[i])) items.push(all[i]);
  }
  for (var pass = 0; pass < 2; pass++) {
    for (var w = 0; w < wantedList.length; w++) {
      for (var k = 0; k < items.length; k++) {
        var t = ((items[k].innerText || items[k].textContent) || '').trim().toLowerCase();
        var want = wantedList[w].toLowerCase();
        var match = pass === 0 ? t === want : t.indexOf(want) !== -1;
        if (match) { clickEl(items[k]); await sleep(400); return true; }
      }
    }
  }
  return false;
}
async function setDropdownValue(el, wantedList){
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
  return pickCustomOption(el, wantedList);
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
  var el = findDropdown(res);
  if (!el) return stepMissing('dropdown', which);
  var cur = norm(dropdownCurrent(el));
  if (cur === norm(wanted[0])) return stepOk('dropdown', { which: which, skipped: true });
  var ok = await setDropdownValue(el, wanted);
  if (!ok) return stepMissing('dropdown', which);
  return stepOk('dropdown', { which: which });
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
