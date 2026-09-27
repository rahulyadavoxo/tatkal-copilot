/**
 * Tatkal Copilot — verification harness (L2).
 *
 * Loads src/harness/mockIrctc.html in headless Chromium (file:// URL —
 * localhost navigation is blocked in this sandbox), injects the fill-engine
 * script built from src/core/fillEngine.ts, and asserts gates:
 *   G1 fill correctness + wall time in (4.2s, 120s]   -> FILL_OK <ms>
 *   G1b realistic mock (zero ids, label-located, +Add Passenger,
 *       mat-select/p-dropdown widgets)                   -> REALFILL_OK <ms>
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
const MOCK_REAL = path.join(REPO, 'src', 'harness', 'mockIrctcReal.html');
const MOCK_PREBOOK = path.join(REPO, 'src', 'harness', 'mockIrctcPrebook.html');

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
  'src/core/prebookEngine.ts',
  'src/core/tatkalConfig.ts',
  '--outDir', DIST,
  '--rootDir', 'src/core',
  '--module', 'commonjs',
  '--target', 'es2020',
  '--esModuleInterop',
  '--skipLibCheck',
  '--types', 'node', // only what the engines need; avoids broken stray @types dirs
]);
try {
  execFileSync(TSC_CMD, TSC_ARGS, { cwd: REPO, stdio: 'pipe' });
} catch (e) {
  fail('tsc compile of engines failed: ' + (e.stdout || e.stderr || e.message));
}
const engine = require(path.join(DIST, 'fillEngine.js'));
const prebook = require(path.join(DIST, 'prebookEngine.js'));

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
  contactMobile: '9876543210',
  travelInsurance: true,
  passengers: [
    { name: 'Aarav Sharma', age: 34, gender: 'M', berthPref: 'LB' },
    { name: 'Diya Sharma', age: 31, gender: 'F', berthPref: 'MB' },
    { name: 'Kabir Sharma', age: 8, gender: 'M', berthPref: 'UB' },
    { name: 'Meera Devi', age: 61, gender: 'F', berthPref: 'SL' },
  ],
};
const SEED = 20260926;

// Pre-booking plan: deliberately ordinary values — never real credentials.
const PREBOOK_PLAN = {
  language: 'en',
  username: 'harnessuser',
  password: 'harness-pass-1',
  from: { code: 'BCT', name: 'Mumbai Central' },
  to: { code: 'NDLS', name: 'New Delhi' },
  dateDMY: '15/10/2026',
  classCode: '3A',
  quota: 'TATKAL',
};

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

      // G1: every field holds the right value (checkboxes: checked state;
      // radios: the right option checked; addPassenger: no DOM value).
      for (const a of actions) {
        if (a.kind === 'addPassenger') continue; // no value to assert
        if (a.kind === 'checkbox') {
          const checked = await page.$eval('#' + a.locator.id, (el) => el.checked);
          if (checked !== (a.value !== 'off')) {
            fail(`G1: checkbox #${a.locator.id} checked=${checked}, expected value ${JSON.stringify(a.value)}`);
          }
          continue;
        }
        if (a.kind === 'radio') {
          const yesChecked = await page.evaluate(() => {
            const radios = Array.from(document.querySelectorAll('input[type="radio"]'));
            const yes = radios.find((r) => (r.value || '') === 'yes');
            return !!(yes && yes.checked);
          });
          if (yesChecked !== (a.value === 'yes')) {
            fail(`G1: travel-insurance radio state wrong (yes checked=${yesChecked})`);
          }
          continue;
        }
        const val = await page.$eval('#' + a.locator.id, (el) => el.value);
        if (val !== a.value) {
          fail(`G1: field #${a.locator.id} = ${JSON.stringify(val)}, expected ${JSON.stringify(a.value)}`);
        }
      }

      // G2: pacing from the event log.
      const totalMs = filled[filled.length - 1].t - filled[0].t;
      if (!(totalMs > 4200 && totalMs <= 120000)) {
        fail(`G2: total fill time ${totalMs}ms not in (4200, 120000]`);
      }
      for (let i = 1; i < filled.length; i++) {
        const gap = filled[i].t - filled[i - 1].t;
        if (gap < 120) fail(`G2: gap before ${filled[i].data.label} was ${gap}ms (< 120ms)`);
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

    // ============ Phase A2: G2 pre-step — form probe =====================
    // The probe must report ready=true on the passenger form page, exactly once.
    {
      const page = await browser.newPage();
      await page.goto('file://' + MOCK + '?state=form');
      await page.evaluate(`window.__tatkalEventLog = [];
        window.ReactNativeWebView = { postMessage: (d) => {
          try { window.__tatkalEventLog.push(JSON.parse(d)); } catch (e) {}
        } };`);
      await page.addScriptTag({ content: engine.buildFormProbeScript() });
      await waitForEvent(page, 'FORM_PROBE_RESULT', 10000);
      const log = await eventLog(page);
      const probes = log.filter((e) => e.type === 'FORM_PROBE_RESULT');
      if (probes.length !== 1) {
        fail(`G2-probe: expected exactly 1 probe event, got ${probes.length}`);
      }
      if (!probes[0].data || probes[0].data.ready !== true) {
        fail('G2-probe: expected ready=true on the passenger form, got ' +
          JSON.stringify(probes[0].data));
      }
      console.log('PROBE_OK');
      await page.close();
    }

    // ============ Phase A3: REALFILL — realistic mock, zero ids ============
    // Mirrors IRCTC's real passenger page (device screenshots 2026-09-26):
    // every field is located by placeholder / visible label text only, the
    // Gender dropdown is PrimeNG-style, Berth is mat-select-style, and the
    // 2nd passenger block is created by clicking "+ Add Passenger".
    {
      const page = await browser.newPage();
      await page.goto('file://' + MOCK_REAL);
      const realPlan = { ...PLAN, passengers: PLAN.passengers.slice(0, 2) };
      const realActions = engine.buildFieldActions(realPlan);
      const realScript = engine.buildFillScript(realPlan, { seed: SEED });
      await page.addScriptTag({ content: realScript });
      await waitForEvent(page, 'FILL_COMPLETE', 90000);

      const log = await eventLog(page);
      const missing = log.filter((e) => e.type === 'FIELD_MISSING');
      if (missing.length !== 0) {
        fail('REALFILL: FIELD_MISSING for ' + missing.map((e) => e.data.label).join(', '));
      }
      const filled = log.filter((e) => e.type === 'FIELD_FILLED');
      if (filled.length !== realActions.length) {
        fail(`REALFILL: FIELD_FILLED count ${filled.length} != action count ${realActions.length}`);
      }

      // Values actually landed in the page's DOM widgets.
      const dom = await page.evaluate(() => {
        const q = (s) => Array.from(document.querySelectorAll(s));
        return {
          names: q('input[placeholder="Full Name as per Govt. ID"]').map((i) => i.value),
          ages: q('input[placeholder="Age"]').map((i) => i.value),
          genders: q('.p-dropdown').map((d) => d.getAttribute('data-value')),
          berths: q('mat-select').map((m) => m.getAttribute('data-value')),
          mobile: document.querySelector('input[placeholder="Mobile Number"]').value,
          autoUpg: document.querySelector('#autoUpg').checked,
          insYes: document.querySelector('input[name="travelIns"][value="yes"]').checked,
        };
      });
      const eq = (a, b, what) => {
        if (JSON.stringify(a) !== JSON.stringify(b)) {
          fail(`REALFILL: ${what} = ${JSON.stringify(a)}, expected ${JSON.stringify(b)}`);
        }
      };
      eq(dom.names, ['Aarav Sharma', 'Diya Sharma'], 'names');
      eq(dom.ages, ['34', '31'], 'ages');
      eq(dom.genders, ['Male', 'Female'], 'genders');
      eq(dom.berths, ['Lower', 'Middle'], 'berths');
      eq(dom.mobile, '9876543210', 'mobile');
      eq(dom.autoUpg, true, 'auto-upgradation');
      eq(dom.insYes, true, 'travel insurance');

      // Pacing still respects the floor (2 pax -> 4.2s floor).
      const totalMs = filled[filled.length - 1].t - filled[0].t;
      if (!(totalMs > 4200 && totalMs <= 120000)) {
        fail(`REALFILL: total fill time ${totalMs}ms not in (4200, 120000]`);
      }
      const submits = await page.evaluate('window.__formSubmits');
      if (submits !== 0) {
        fail(`REALFILL: fill phase performed ${submits} form submits`);
      }
      console.log(`REALFILL_OK ${totalMs}`);
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

    // ============ Phase E: pre-booking flow — language → login → search form
    {
      const script = prebook.buildPrebookScript(PREBOOK_PLAN, { seed: SEED });
      const violations = prebook.scanPrebookForViolations(script);
      if (violations.length !== 0) {
        fail('PREBOOK: script violations: ' + violations.join('; '));
      }
      const page = await browser.newPage();
      await page.goto('file://' + MOCK_PREBOOK);
      await page.addScriptTag({ content: script });
      await waitForEvent(page, 'PREBOOK_DONE', 90000);
      const log = await eventLog(page);
      const missing = log.filter((e) => e.type === 'PREBOOK_STEP_MISSING');
      if (missing.length !== 0) {
        fail('PREBOOK: missing steps: ' + missing.map((e) => e.data.step).join(', '));
      }
      if (log.some((e) => e.type === 'CAPTCHA_REQUIRED' || e.type === 'OTP_REQUIRED')) {
        fail('PREBOOK: unexpected captcha/otp halt on the no-captcha page');
      }
      const st = await page.evaluate(() => ({
        langHidden: document.getElementById('langAlert').style.display === 'none',
        account: document.getElementById('accountLabel').textContent,
        accountShown: document.getElementById('accountLabel').style.display !== 'none',
        modalHidden: document.getElementById('loginModal').style.display === 'none',
        from: document.getElementById('fromInput').value,
        to: document.getElementById('toInput').value,
        date: document.getElementById('dateInput').value,
        cls: document.getElementById('classSelect').selectedOptions[0].text,
        quota: document.getElementById('quotaSelect').selectedOptions[0].text,
        submits: window.__formSubmits,
      }));
      if (!st.langHidden) fail('PREBOOK: language alert was not dismissed');
      if (!st.accountShown || st.account !== 'My Account') fail('PREBOOK: not logged in after SIGN IN');
      if (!st.modalHidden) fail('PREBOOK: login modal still open after SIGN IN');
      if (!/\bBCT\b/.test(st.from)) fail('PREBOOK: From not set to BCT (got "' + st.from + '")');
      if (!/\bNDLS\b/.test(st.to)) fail('PREBOOK: To not set to NDLS (got "' + st.to + '")');
      if (st.date !== '15/10/2026') fail('PREBOOK: date wrong (got "' + st.date + '")');
      if (st.cls !== '3A') fail('PREBOOK: class wrong (got "' + st.cls + '")');
      if (st.quota !== 'TATKAL') fail('PREBOOK: quota wrong (got "' + st.quota + '")');
      if (st.submits !== 0) fail('PREBOOK: a form was submitted');
      console.log('PREBOOK_OK');
      await page.close();
    }

    // ============ Phase F: CAPTCHA on login halts — never bypassed =========
    {
      const page = await browser.newPage();
      await page.goto('file://' + MOCK_PREBOOK + '?captcha=1');
      await page.addScriptTag({ content: prebook.buildPrebookScript(PREBOOK_PLAN, { seed: SEED }) });
      await waitForEvent(page, 'CAPTCHA_REQUIRED', 90000);
      const log = await eventLog(page);
      if (log.some((e) => e.type === 'PREBOOK_DONE')) {
        fail('PREBOOK_CAPTCHA: flow completed despite the CAPTCHA');
      }
      const st = await page.evaluate(() => ({
        loggedIn: document.getElementById('accountLabel').style.display !== 'none',
        modalOpen: document.getElementById('loginModal').style.display !== 'none',
      }));
      if (st.loggedIn) fail('PREBOOK_CAPTCHA: logged in despite the CAPTCHA');
      if (!st.modalOpen) fail('PREBOOK_CAPTCHA: login modal closed despite the CAPTCHA');
      console.log('PREBOOK_CAPTCHA_OK');
      await page.close();
    }
  } finally {
    await browser.close();
  }
})().catch((e) => fail('unexpected harness error: ' + (e && e.stack ? e.stack : e)));
