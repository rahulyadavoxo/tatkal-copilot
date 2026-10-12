#!/usr/bin/env node
/**
 * CI scanner: proves the native Chrome engine (TatkalTapService.kt) can never
 * act after the single "Pay & Book" tap or on a payment gateway page.
 *
 * Static checks on the Kotlin source (the choreography map itself is checked
 * by scanChoreoPaymentStop in src/native/__tests__/autofillData.test.ts):
 *  1. The gateway check runs before page matching on every pass.
 *  2. A step marked `final` locks the run down right after it fires.
 *  3. The lockdown sets paymentLockdown and switches automation OFF.
 *  4. The loop and the event entry both bail out while locked down.
 *  5. Only a new tile tap (newer run_requested_ts) clears the lockdown;
 *     leaving the browser never does.
 *  6. The old denylist that blocked the automated stages is gone.
 * Exits 1 with a list of violations.
 */
const fs = require('fs');
const path = require('path');

const file = path.join(
  __dirname, '..', '..', 'android', 'app', 'src', 'main', 'java', 'com', 'tatkalcopilot', 'app', 'TatkalTapService.kt',
);
const src = fs.readFileSync(file, 'utf8');
const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[ \t])\/\/[^\n]*/gm, '$1');
const hits = [];

function fnBody(name) {
  const i = code.indexOf('fun ' + name + '(');
  if (i < 0) return null;
  let j = code.indexOf('{', i);
  let depth = 0;
  for (let k = j; k < code.length; k++) {
    if (code[k] === '{') depth++;
    else if (code[k] === '}') { depth--; if (depth === 0) return code.slice(j, k + 1); }
  }
  return null;
}

const loop = fnBody('runChoreographyFast');
if (!loop) hits.push('runChoreographyFast not found');
else {
  const gw = loop.indexOf('gatewayReason(');
  const page = loop.indexOf('detectMatches(page');
  const loader = loop.indexOf('loaderTexts.any');
  if (gw < 0) hits.push('loop never runs the gateway check');
  if (page < 0) hits.push('loop page matching not found');
  if (gw > page) hits.push('gateway check runs after page matching');
  const off = loop.indexOf('offIrctcHost(');
  if (off < 0 || off > page) hits.push('off-IRCTC pause missing or after page matching');
  if (loader >= 0 && gw > loader) hits.push('gateway check runs after the loader wait');
  if (!/lockDownForPayment\(gw\)\s*return/.test(loop)) hits.push('gateway hit does not lock down and return');
  if (!/if \(paymentLockdown\) return/.test(loop)) hits.push('loop does not bail out while locked down');
}

const runPage = fnBody('runPage');
if (!runPage || !/optBoolean\("final", false\)\)\s*\{\s*lockDownForPayment\([^)]*\)\s*return/.test(runPage)) {
  hits.push('final step does not lock down immediately after firing');
}

const lock = fnBody('lockDownForPayment');
if (!lock || !/paymentLockdown = true/.test(lock) || !/setAutomationEnabled\(false\)/.test(lock)) {
  hits.push('lockdown must set paymentLockdown and switch automation OFF');
}

const onEvent = fnBody('onAccessibilityEvent');
if (!onEvent || !/if \(paymentLockdown && requestedRunTs\(\) <= lastSeenRunTs\) return/.test(onEvent)) {
  hits.push('event entry does not stay silent while locked down');
}
if (onEvent && /paymentLockdown = false|clearRunMemory\(\)/.test(onEvent)) {
  hits.push('event entry resets the lockdown (e.g. on leaving the browser)');
}

const resets = code.match(/(?<!var )paymentLockdown = false/g) || [];
const clear = fnBody('clearRunMemory') || '';
if (resets.length !== 1 || !/paymentLockdown = false/.test(clear)) {
  hits.push('paymentLockdown may only be cleared inside clearRunMemory');
}
const clearCalls = code.match(/(?<!fun )clearRunMemory\(\)/g) || [];
if (clearCalls.length !== 1 || !/if \(requested > lastSeenRunTs\) \{\s*lastSeenRunTs = requested\s*clearRunMemory\(\)/.test(code)) {
  hits.push('clearRunMemory must run only for a newer tile run');
}

if (/paymentKill/.test(code)) hits.push('legacy paymentKill denylist still referenced');

if (hits.length) {
  console.error('Chrome payment-stop scan FAILED:\n - ' + hits.join('\n - '));
  process.exit(1);
}
console.log('Chrome payment-stop scan: clean (nothing acts after Pay & Book or on a gateway).');
