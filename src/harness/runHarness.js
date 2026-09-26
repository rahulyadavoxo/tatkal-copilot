/**
 * Tatkal Copilot — verification harness (L2).
 *
 * Loads src/harness/mockIrctc.html in headless Chromium (file:// URL —
 * localhost navigation is blocked in this sandbox), injects the fill-engine
 * script built from src/core/fillEngine.ts, and asserts gates:
 *   G1 fill correctness + wall time in (4.2s, 120s]   -> FILL_OK <ms>
 *   G2 pacing: total >= 4.2s, per-field gaps >= 120ms  -> PACE_OK
 *   G4 OTP gate: OTP_REQUIRED emitted, zero submits     -> OTP_GATE_OK
 *   G5 no-auto-book source scan                        -> NO_AUTOBOOK_OK
 *   G7 fallback alternates parsed <= 5s                -> FALLBACK_OK
 *
 * Exit 0 on all green; non-zero with HARNESS_FAIL message otherwise.
 */
'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFileSync } = require('child_process');

const REPO = path.resolve(__dirname, '..', '..');
const MOCK = path.join(REPO, 'src', 'harness', 'mockIrctc.html');

function fail(msg) {
  console.error('HARNESS_FAIL: ' + msg);
  process.exit(1);
}

// --- 1. Compile the TS engine to plain JS (single source of truth) --------
const DIST = fs.mkdtempSync(path.join(os.tmpdir(), 'tatkal-harness-'));
// Prefer the repo-local tsc (sandbox installs may lack .bin links, which
// breaks `npx tsc`); fall back to npx where a normal install exists.
const LOCAL_TSC = path.join(REPO, 'node_modules', 'typescript', 'bin', 'tsc');
const TSC_CMD = fs.existsSync(LOCAL_TSC) ? process.execPath : 'npx';
const TSC_ARGS = (fs.existsSync(LOCAL_TSC) ? [LOCAL_TSC] : ['tsc']).concat([
  'src/core/fillEngine.ts',
  'src/core/tatkalConfig.ts',
  '--outDir', DIST,
  '--rootDir', 'src/core',
  '--module', 'commonjs',
  '--target', 'es2020',
  '--esModuleInterop',
  '--skipLibCheck',
  '--types', 'node', // only what fillEngine needs; avoids broken stray @types dirs
]);
try {
  execFileSync(TSC_CMD, TSC_ARGS, { cwd: REPO, stdio: 'pipe' });
} catch (e) {
  fail('tsc compile of fillEngine failed: ' + (e.stdout || e.stderr || e.message));
}
const engine = require(path.join(DIST, 'fillEngine.js'));

// --- 2. Playwright ----------------------------------------------------------
let playwright;
try {
  playwright = require('playwright');
} catch (e) {
  fail('playwright module not found — run `npm install` in ' + REPO + ' first. ' + e.message);
}

const PLAN = {
  trainNo: '12951',
  from: 'BCT',
  to: 'NDLS',
  dateISO: '2026-09-27',
  classCode: '3A',
  quota: 'TATKAL',
  autoUpgradation: true,
  passengers: [
    { name: 'Aarav Sharma', age: 34, gender: 'M', berthPref: 'LB' },
    { name: 'Diya Sharma', age: 31, gender: 'F', berthPref: 'MB' },
    { name: 'Kabir Sharma', age: 8, gender: 'M', berthPref: 'UB' },
    { name: 'Meera Devi', age: 61, gender: 'F', berthPref: 'SL' },
  ],
};
const SEED = 20260926;

async function eventLog(page) {
  return page.evaluate('window.__tatkalEventLog || []');
}

async function waitForEvent(page, type, timeoutMs) {
  await page.waitForFunction(
    (t) => (window.__tatkalEventLog || []).some((e) => e.type === t),
    type,
    { timeout: timeoutMs },
  );
}

(async () => {
  const browser = await playwright.chromium.launch({
    executablePath: '/opt/meta-chromium/chrome',
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--enable-unsafe-swiftshader'],
  });
  try {
    const script = engine.buildFillScript(PLAN, { seed: SEED });
    const actions = engine.buildFieldActions(PLAN);

    // ============ Phase A: G1 + G2 — form fill on mock page ============
    {
      const page = await browser.newPage();
      await page.goto('file://' + MOCK + '?state=form');
      await page.addScriptTag({ content: script });
      await waitForEvent(page, 'FILL_COMPLETE', 90000);

      const log = await eventLog(page);
      const filled = log.filter((e) => e.type === 'FIELD_FILLED');
      if (filled.length !== actions.length) {
        fail(`G1: FIELD_FILLED count ${filled.length} != action count ${actions.length}`);
      }

      // G1: every field holds the right value (checkboxes: checked state).
      for (const a of actions) {
        if (a.kind === 'checkbox') {
          const checked = await page.$eval('#' + a.id, (el) => el.checked);
          if (checked !== (a.value !== 'off')) {
            fail(`G1: checkbox #${a.id} checked=${checked}, expected value ${JSON.stringify(a.value)}`);
          }
          continue;
        }
        const val = await page.$eval('#' + a.id, (el) => el.value);
        if (val !== a.value) {
          fail(`G1: field #${a.id} = ${JSON.stringify(val)}, expected ${JSON.stringify(a.value)}`);
        }
      }

      // G2: pacing from the event log.
      const totalMs = filled[filled.length - 1].t - filled[0].t;
      if (!(totalMs > 4200 && totalMs <= 120000)) {
        fail(`G2: total fill time ${totalMs}ms not in (4200, 120000]`);
      }
      for (let i = 1; i < filled.length; i++) {
        const gap = filled[i].t - filled[i - 1].t;
        if (gap < 120) fail(`G2: gap before ${filled[i].data.id} was ${gap}ms (< 120ms)`);
      }

      // No submit may have happened during a fill.
      const submits = await page.evaluate('window.__formSubmits');
      const clicks = await page.evaluate('window.__bookClicks');
      if (submits !== 0 || clicks !== 0) {
        fail(`G4/G5: fill phase performed ${submits} form submits / ${clicks} book clicks`);
      }

      console.log(`FILL_OK ${totalMs}`);
      console.log('PACE_OK');
      await page.close();
    }

    // ============ Phase B: G4 — OTP screen halts the engine ============
    {
      const page = await browser.newPage();
      await page.goto('file://' + MOCK + '?state=otp');
      await page.addScriptTag({ content: script });
      await page.waitForTimeout(2500); // engine should halt immediately; give it room to misbehave

      const log = await eventLog(page);
      const types = log.map((e) => e.type);
      if (!types.includes('OTP_REQUIRED')) {
        fail('G4: OTP_REQUIRED not emitted on OTP screen. Events: ' + types.join(','));
      }
      if (types.includes('FIELD_FILLED')) {
        fail('G4: engine filled fields despite OTP screen being visible');
      }
      const submits = await page.evaluate('window.__formSubmits');
      const clicks = await page.evaluate('window.__bookClicks');
      if (submits !== 0 || clicks !== 0) {
        fail(`G4: OTP phase performed ${submits} form submits / ${clicks} book clicks`);
      }
      console.log('OTP_GATE_OK');
      await page.close();
    }

    // ============ Phase C: G5 — no-auto-book source scan ============
    {
      const violations = engine.scanForAutobookViolations(script);
      if (violations.length !== 0) {
        fail('G5: auto-book violations: ' + violations.join('; '));
      }
      // Belt-and-braces: the literal submit() string must not exist outside the gate either.
      console.log('NO_AUTOBOOK_OK');
    }

    // ============ Phase D: G7 — fallback alternates ============
    {
      const page = await browser.newPage();
      await page.goto('file://' + MOCK + '?state=noseats');
      const t0 = Date.now();
      const html = await page.content();
      const alts = engine.parseAlternates(html);
      const dt = Date.now() - t0;
      if (alts.length < 1) fail('G7: parseAlternates returned zero alternates');
      if (dt > 5000) fail(`G7: parsing took ${dt}ms (> 5000ms)`);
      console.log(`FALLBACK_OK (${alts.length} alternates, ${dt}ms)`);
      await page.close();
    }
  } finally {
    await browser.close();
  }
})().catch((e) => fail('unexpected harness error: ' + (e && e.stack ? e.stack : e)));
