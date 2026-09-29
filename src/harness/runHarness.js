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
const MOCK_BOOKING = path.join(REPO, 'src', 'harness', 'mockIrctcBooking.html');

function fail(msg) {
  console.error('HARNESS_FAIL: ' + msg);
  process.exit(1);
}

// Syntax-gate: built injection scripts are assembled inside TS template
// literals, where a stray backslash silently becomes a syntax error at
// inject time (e.g. /bhim\/upi/ collapsing to /bhim/upi/). Catch it here.
function checkScript(name, script) {
  const f = path.join(os.tmpdir(), 'harness-script-' + name + '.js');
  fs.writeFileSync(f, script);
  try {
    execFileSync('node', ['--check', f], { stdio: 'pipe' });
  } catch (e) {
    fail(name + ': built script has a syntax error: ' + (e.stderr || e.message));
  }
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
  'src/core/postSearchEngine.ts',
  'src/core/reviewEngine.ts',
  'src/core/paymentEngine.ts',
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
const postsearch = require(path.join(DIST, 'postSearchEngine.js'));
const review = require(path.join(DIST, 'reviewEngine.js'));
const payment = require(path.join(DIST, 'paymentEngine.js'));

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
        dpClosed: document.getElementById('pDatepicker').style.display === 'none',
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
      if (!st.dpClosed) fail('PREBOOK: calendar overlay left open (would block dropdowns)');
      console.log('PREBOOK_OK');
      await page.close();
    }

    // ===== Phase E2: icon-only login trigger (live IRCTC mobile header) =====
    // Mirrors the user's 2026-09-27 screenshot: the header person glyph has no
    // accessible name, so the engine must find it via the icon fallback.
    {
      const page = await browser.newPage();
      await page.goto('file://' + MOCK_PREBOOK + '?iconlogin=1');
      await page.addScriptTag({ content: prebook.buildPrebookScript(PREBOOK_PLAN, { seed: SEED }) });
      await waitForEvent(page, 'PREBOOK_DONE', 90000);
      const log = await eventLog(page);
      const missing = log.filter((e) => e.type === 'PREBOOK_STEP_MISSING');
      if (missing.length !== 0) {
        fail('PREBOOK_ICONLOGIN: missing steps: ' + missing.map((e) => e.data.step).join(', '));
      }
      const st = await page.evaluate(() => ({
        account: document.getElementById('accountLabel').textContent,
        accountShown: document.getElementById('accountLabel').style.display !== 'none',
        modalHidden: document.getElementById('loginModal').style.display === 'none',
        iconUsed: !!document.getElementById('profileIcon'),
        submits: window.__formSubmits,
      }));
      if (!st.iconUsed) fail('PREBOOK_ICONLOGIN: icon variant did not render');
      if (!st.accountShown || st.account !== 'My Account') fail('PREBOOK_ICONLOGIN: not logged in via icon trigger');
      if (!st.modalHidden) fail('PREBOOK_ICONLOGIN: login modal still open');
      if (st.submits !== 0) fail('PREBOOK_ICONLOGIN: a form was submitted');
      console.log('PREBOOK_ICONLOGIN_OK');
      await page.close();
    }

    // ===== Phase E2b: alternate (non-PrimeNG) calendar — generic fallback ===
    // Mirrors the 2026-09-29 on-device report: the live calendar's markup
    // drifted from PrimeNG, so the day was never picked. The overlay here has
    // no p-datepicker classes at all — the engine must find it via the
    // library-agnostic fallback (month-year title + day grid).
    {
      const page = await browser.newPage();
      await page.goto('file://' + MOCK_PREBOOK + '?altcal=1');
      await page.addScriptTag({ content: prebook.buildPrebookScript(PREBOOK_PLAN, { seed: SEED }) });
      await waitForEvent(page, 'PREBOOK_DONE', 90000);
      const log = await eventLog(page);
      const missing = log.filter((e) => e.type === 'PREBOOK_STEP_MISSING');
      if (missing.length !== 0) {
        fail('PREBOOK_ALTCAL: missing steps: ' + missing.map((e) => e.data.step + ':' + (e.data.detail || '')).join(', '));
      }
      const st = await page.evaluate(() => ({
        date: document.getElementById('dateInput').value,
        altClosed: document.querySelector('.alt-cal').style.display === 'none',
        submits: window.__formSubmits,
      }));
      if (st.date !== '15/10/2026') fail('PREBOOK_ALTCAL: date wrong (got "' + st.date + '")');
      if (!st.altClosed) fail('PREBOOK_ALTCAL: alt calendar overlay left open');
      if (st.submits !== 0) fail('PREBOOK_ALTCAL: a form was submitted');
      console.log('PREBOOK_ALTCAL_OK');
      await page.close();
    }

    // ===== Phase E2d: icon-font calendar nav (no text/aria-label on buttons)
    // Mirrors the 2026-09-29 on-device report: the ">" button is an icon font
    // with no accessible name — only the structural flanking-title path works.
    {
      const page = await browser.newPage();
      await page.goto('file://' + MOCK_PREBOOK + '?altcal=1&iconnav=1');
      await page.addScriptTag({ content: prebook.buildPrebookScript(PREBOOK_PLAN, { seed: SEED }) });
      await waitForEvent(page, 'PREBOOK_DONE', 90000);
      const log = await eventLog(page);
      const missing = log.filter((e) => e.type === 'PREBOOK_STEP_MISSING');
      if (missing.length !== 0) {
        fail('PREBOOK_ICONNAV: missing steps: ' + missing.map((e) => e.data.step + ':' + (e.data.detail || '')).join(', '));
      }
      const st = await page.evaluate(() => ({
        date: document.getElementById('dateInput').value,
        submits: window.__formSubmits,
      }));
      if (st.date !== '15/10/2026') fail('PREBOOK_ICONNAV: date wrong (got "' + st.date + '")');
      if (st.submits !== 0) fail('PREBOOK_ICONNAV: a form was submitted');
      console.log('PREBOOK_ICONNAV_OK');
      await page.close();
    }

    // ===== Phase E2c: PrimeNG-style div dropdowns (body-level panel) ======
    // Mirrors the 2026-09-29 on-device report: the class/quota controls are
    // div-based dropdowns whose option panel renders at the body level,
    // outside the control element.
    {
      const page = await browser.newPage();
      await page.goto('file://' + MOCK_PREBOOK + '?pdrop=1');
      await page.addScriptTag({ content: prebook.buildPrebookScript(PREBOOK_PLAN, { seed: SEED }) });
      await waitForEvent(page, 'PREBOOK_DONE', 90000);
      const log = await eventLog(page);
      const missing = log.filter((e) => e.type === 'PREBOOK_STEP_MISSING');
      if (missing.length !== 0) {
        fail('PREBOOK_PDROP: missing steps: ' + missing.map((e) => e.data.step + ':' + (e.data.detail || '')).join(', '));
      }
      const st = await page.evaluate(() => ({
        cls: document.getElementById('pdropClassVal').value,
        quota: document.getElementById('pdropQuotaVal').value,
        date: document.getElementById('dateInput').value,
        submits: window.__formSubmits,
      }));
      if (st.date !== '15/10/2026') fail('PREBOOK_PDROP: date wrong (got "' + st.date + '")');
      if (st.cls !== 'AC 3 Tier (3A)') fail('PREBOOK_PDROP: class wrong (got "' + st.cls + '")');
      if (st.quota !== 'TATKAL') fail('PREBOOK_PDROP: quota wrong (got "' + st.quota + '")');
      if (st.submits !== 0) fail('PREBOOK_PDROP: a form was submitted');
      console.log('PREBOOK_PDROP_OK');
      await page.close();
    }

    // ===== Phase E2e: dropdown skip when the value is already correct =====
    // The class control already shows the wanted class: the engine must not
    // reopen its panel (exactly one panel open overall — the quota one).
    {
      const page = await browser.newPage();
      await page.goto('file://' + MOCK_PREBOOK + '?pdrop=1&presel=1');
      const plan = Object.assign({}, PREBOOK_PLAN, { classCode: '1A' });
      await page.addScriptTag({ content: prebook.buildPrebookScript(plan, { seed: SEED }) });
      await waitForEvent(page, 'PREBOOK_DONE', 90000);
      const log = await eventLog(page);
      const missing = log.filter((e) => e.type === 'PREBOOK_STEP_MISSING');
      if (missing.length !== 0) {
        fail('PREBOOK_PSKIP: missing steps: ' + missing.map((e) => e.data.step + ':' + (e.data.detail || '')).join(', '));
      }
      const st = await page.evaluate(() => ({
        cls: document.getElementById('pdropClassVal').value,
        quota: document.getElementById('pdropQuotaVal').value,
        opens: window.__pdropOpens,
        submits: window.__formSubmits,
      }));
      if (st.cls !== 'AC First Class (1A)') fail('PREBOOK_PSKIP: class changed (got "' + st.cls + '")');
      if (st.quota !== 'TATKAL') fail('PREBOOK_PSKIP: quota wrong (got "' + st.quota + '")');
      if (st.opens !== 1) fail('PREBOOK_PSKIP: expected exactly 1 panel open, got ' + st.opens);
      if (st.submits !== 0) fail('PREBOOK_PSKIP: a form was submitted');
      console.log('PREBOOK_PSKIP_OK');
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

    // ===== Phase F2: a genuine OTP field halts — help text alone must not ===
    // The default modal carries the live page's "receive OTP instead of"
    // hint for visually impaired users; the engine must NOT treat that
    // prose as an OTP challenge (user report 2026-09-27). ?realotp=1 adds a
    // real OTP input, which must halt with OTP_REQUIRED.
    {
      const page = await browser.newPage();
      await page.goto('file://' + MOCK_PREBOOK + '?realotp=1');
      await page.addScriptTag({ content: prebook.buildPrebookScript(PREBOOK_PLAN, { seed: SEED }) });
      await waitForEvent(page, 'OTP_REQUIRED', 90000);
      const log = await eventLog(page);
      if (log.some((e) => e.type === 'PREBOOK_DONE')) {
        fail('PREBOOK_OTP: flow completed despite a real OTP field');
      }
      const st = await page.evaluate(() => ({
        userFilled: document.getElementById('loginUser').value !== '',
        modalOpen: document.getElementById('loginModal').style.display !== 'none',
      }));
      if (st.userFilled) fail('PREBOOK_OTP: credentials were typed despite the OTP halt');
      if (!st.modalOpen) fail('PREBOOK_OTP: login modal closed despite the OTP halt');
      console.log('PREBOOK_OTP_OK');
      await page.close();
    }
    // ============ Phase G: post-search flow — search → train → popup Yes ====
    {
      const plan = {
        trainNo: '12873',
        classCode: '3A',
        dateISO: '2026-09-29',
        dateCard: postsearch.toDateCard('2026-09-29'),
      };
      const script = postsearch.buildPostSearchScript(plan, { seed: SEED });
      checkScript('postsearch', script);
      const violations = postsearch.scanPostSearchForViolations(script);
      if (violations.length !== 0) {
        fail('SEARCH: script violations: ' + violations.join('; '));
      }
      const page = await browser.newPage();
      await page.goto('file://' + MOCK_BOOKING);
      await page.addScriptTag({ content: script });
      await waitForEvent(page, 'PASSENGER_PAGE_READY', 90000);
      const log = await eventLog(page);
      const types = log.map((e) => e.type);
      for (const t of ['SEARCH_STARTED', 'POPUP_YES', 'PASSENGER_PAGE_READY']) {
        if (!types.includes(t)) fail('SEARCH: missing event ' + t + ' (got ' + types.join(',') + ')');
      }
      if (types.includes('SEARCH_STEP_MISSING')) {
        fail('SEARCH: missing steps: ' + log.filter((e) => e.type === 'SEARCH_STEP_MISSING').map((e) => e.data.step).join(','));
      }
      if (types.includes('POPUP_UNKNOWN') || types.includes('CAPTCHA_REQUIRED') || types.includes('OTP_REQUIRED')) {
        fail('SEARCH: unexpected halt (got ' + types.join(',') + ')');
      }
      const st = await page.evaluate(() => ({
        search: window.__searchClicked,
        box: window.__boxClicked,
        tab: window.__tabClicked,
        date: window.__dateClicked,
        bookTrain: window.__bookNowTrain,
        yes: window.__yesClicked,
        popupHidden: document.getElementById('confirmPopup').style.display === 'none',
        paxShown: document.getElementById('paxPage').style.display !== 'none',
        submits: window.__formSubmits,
      }));
      if (st.search !== 1) fail('SEARCH: Search Trains not clicked exactly once');
      // Card starts collapsed (like the real page): a class box expands it,
      // then the wanted tab is tapped. 12873 shows SL/3E boxes; 3A comes from the tab strip.
      if (st.box !== 'SL') fail('SEARCH: class box not tapped to expand (got "' + st.box + '")');
      if (st.tab !== '3A') fail('SEARCH: class tab wrong (got "' + st.tab + '")');
      if (st.date !== 'Tue, 29 Sep') fail('SEARCH: date card wrong (got "' + st.date + '")');
      if (st.bookTrain !== '12873') fail('SEARCH: Book Now hit the wrong train (' + st.bookTrain + ')');
      if (st.yes !== 1) fail('SEARCH: popup Yes not clicked');
      if (!st.popupHidden) fail('SEARCH: popup still open');
      if (!st.paxShown) fail('SEARCH: passenger page not showing');
      if (st.submits !== 0) fail('SEARCH: a form was submitted');
      console.log('SEARCH_OK');
      await page.close();
    }

    // ============ Phase G1b: search button is <input type="submit"> ========
    // (live page is not always <button>Search Trains</button>)
    {
      const plan = {
        trainNo: '12873',
        classCode: '3A',
        dateISO: '2026-09-29',
        dateCard: postsearch.toDateCard('2026-09-29'),
      };
      const page = await browser.newPage();
      await page.goto('file://' + MOCK_BOOKING + '?inputbtn=1');
      const script = postsearch.buildPostSearchScript(plan, { seed: SEED });
      checkScript('postsearch-inputbtn', script);
      await page.addScriptTag({ content: script });
      await waitForEvent(page, 'PASSENGER_PAGE_READY', 90000);
      const log = await eventLog(page);
      const types = log.map((e) => e.type);
      if (types.includes('SEARCH_STEP_MISSING')) {
        fail('SEARCH_INPUTBTN: missing steps: ' + log.filter((e) => e.type === 'SEARCH_STEP_MISSING').map((e) => e.data.step + ':' + (e.data.detail || '')).join(','));
      }
      const st = await page.evaluate(() => ({
        search: window.__searchClicked,
        paxShown: document.getElementById('paxPage').style.display !== 'none',
        submits: window.__formSubmits,
      }));
      if (st.search !== 1) fail('SEARCH_INPUTBTN: Search input not clicked exactly once');
      if (!st.paxShown) fail('SEARCH_INPUTBTN: passenger page not showing');
      if (st.submits !== 0) fail('SEARCH_INPUTBTN: a form was submitted');
      console.log('SEARCH_INPUTBTN_OK');
      await page.close();
    }

    // ============ Phase G3: post-search with live-style label variants ====
    {
      const plan = {
        trainNo: '12873',
        classCode: '3A',
        dateISO: '2026-09-29',
        dateCard: postsearch.toDateCard('2026-09-29'),
      };
      const page = await browser.newPage();
      await page.goto('file://' + MOCK_BOOKING + '?labels=1');
      const script = postsearch.buildPostSearchScript(plan, { seed: SEED });
      checkScript('postsearch-labels', script);
      await page.addScriptTag({ content: script });
      await waitForEvent(page, 'PASSENGER_PAGE_READY', 90000);
      const log = await eventLog(page);
      const types = log.map((e) => e.type);
      if (types.includes('SEARCH_STEP_MISSING')) {
        fail('SEARCH_LABELS: missing steps: ' + log.filter((e) => e.type === 'SEARCH_STEP_MISSING').map((e) => e.data.step + ':' + (e.data.detail || '')).join(','));
      }
      const st = await page.evaluate(() => ({
        search: window.__searchClicked,
        box: window.__boxClicked,
        tab: window.__tabClicked,
        date: window.__dateClicked,
        bookTrain: window.__bookNowTrain,
        yes: window.__yesClicked,
        popupHidden: window.getComputedStyle(document.getElementById('confirmPopup')).display === 'none',
        paxShown: document.getElementById('paxPage').style.display !== 'none',
        submits: window.__formSubmits,
      }));
      if (st.search !== 1) fail('SEARCH_LABELS: Search link not clicked exactly once');
      if (st.box !== 'SL') fail('SEARCH_LABELS: class box not tapped (got "' + st.box + '")');
      if (st.tab !== '3A') fail('SEARCH_LABELS: class tab wrong (got "' + st.tab + '")');
      if (st.date !== 'TUE, 29 SEP') fail('SEARCH_LABELS: date card wrong (got "' + st.date + '")');
      if (st.bookTrain !== '12873') fail('SEARCH_LABELS: book-now hit the wrong train (' + st.bookTrain + ')');
      if (st.yes !== 1) fail('SEARCH_LABELS: popup Yes not clicked');
      if (!st.popupHidden) fail('SEARCH_LABELS: popup still open');
      if (!st.paxShown) fail('SEARCH_LABELS: passenger page not showing');
      if (st.submits !== 0) fail('SEARCH_LABELS: a form was submitted');
      console.log('SEARCH_LABELS_OK');
      await page.close();
    }

    // ============ Phase G4: Search rendered as a plain div =================
    {
      const plan = {
        trainNo: '12873',
        classCode: '3A',
        dateISO: '2026-09-29',
        dateCard: postsearch.toDateCard('2026-09-29'),
      };
      const page = await browser.newPage();
      await page.goto('file://' + MOCK_BOOKING + '?divsearch=1');
      const script = postsearch.buildPostSearchScript(plan, { seed: SEED });
      checkScript('postsearch-divsearch', script);
      await page.addScriptTag({ content: script });
      await waitForEvent(page, 'PASSENGER_PAGE_READY', 90000);
      const log = await eventLog(page);
      if (log.map((e) => e.type).includes('SEARCH_STEP_MISSING')) {
        fail('SEARCH_DIVSEARCH: missing steps: ' + log.filter((e) => e.type === 'SEARCH_STEP_MISSING').map((e) => e.data.step + ':' + (e.data.detail || '')).join(','));
      }
      const st = await page.evaluate(() => ({
        search: window.__searchClicked,
        bookTrain: window.__bookNowTrain,
        paxShown: document.getElementById('paxPage').style.display !== 'none',
        submits: window.__formSubmits,
      }));
      if (st.search !== 1) fail('SEARCH_DIVSEARCH: Search div not clicked exactly once');
      if (st.bookTrain !== '12873') fail('SEARCH_DIVSEARCH: wrong train (' + st.bookTrain + ')');
      if (!st.paxShown) fail('SEARCH_DIVSEARCH: passenger page not showing');
      if (st.submits !== 0) fail('SEARCH_DIVSEARCH: a form was submitted');
      console.log('SEARCH_DIVSEARCH_OK');
      await page.close();
    }

    // ============ Phase G2: post-search without the popup ================
    {
      const plan = {
        trainNo: '12873',
        classCode: '3A',
        dateISO: '2026-09-29',
        dateCard: postsearch.toDateCard('2026-09-29'),
      };
      const page = await browser.newPage();
      await page.goto('file://' + MOCK_BOOKING + '?nopopup=1');
      const scriptG2 = postsearch.buildPostSearchScript(plan, { seed: SEED });
      checkScript('postsearch-nopopup', scriptG2);
      await page.addScriptTag({ content: scriptG2 });
      await waitForEvent(page, 'PASSENGER_PAGE_READY', 90000);
      const log = await eventLog(page);
      const types = log.map((e) => e.type);
      if (!types.includes('POPUP_NONE')) fail('SEARCH_NOPOPUP: POPUP_NONE not emitted');
      if (types.includes('POPUP_YES') || types.includes('SEARCH_STEP_MISSING')) {
        fail('SEARCH_NOPOPUP: unexpected events (got ' + types.join(',') + ')');
      }
      const paxShown = await page.evaluate(
        () => document.getElementById('paxPage').style.display !== 'none',
      );
      if (!paxShown) fail('SEARCH_NOPOPUP: passenger page not showing');
      console.log('SEARCH_NOPOPUP_OK');
      await page.close();
    }

    // ============ Phase H: review — Skip, GST untouched, BHIM, Continue ===
    {
      const script = review.buildReviewScript({ paymentMode: 'bhim' }, { seed: SEED });
      checkScript('review-bhim', script);
      const violations = review.scanReviewForViolations(script);
      if (violations.length !== 0) {
        fail('REVIEW: script violations: ' + violations.join('; '));
      }
      const page = await browser.newPage();
      await page.goto('file://' + MOCK_BOOKING + '?state=passenger');
      await page.addScriptTag({ content: script });
      await waitForEvent(page, 'REVIEW_DONE', 90000);
      const log = await eventLog(page);
      const types = log.map((e) => e.type);
      if (types.includes('REVIEW_STEP_MISSING')) {
        fail('REVIEW: missing steps: ' + log.filter((e) => e.type === 'REVIEW_STEP_MISSING').map((e) => e.data.step).join(','));
      }
      if (!types.includes('REVIEW_STARTED') || !types.includes('REVIEW_DONE')) {
        fail('REVIEW: missing start/done events (got ' + types.join(',') + ')');
      }
      const st = await page.evaluate(() => ({
        skip: document.getElementById('skipRadio').checked,
        gst: document.getElementById('gstin').value,
        bhim: document.getElementById('payBhim').checked,
        cards: document.getElementById('payCards').checked,
        cont: window.__continueClicked,
        reviewJourney: window.getComputedStyle(document.getElementById('reviewJourneyPage')).display !== 'none',
        gateway: window.getComputedStyle(document.getElementById('paymentGateway')).display !== 'none',
        submits: window.__formSubmits,
      }));
      if (!st.skip) fail('REVIEW: Skip card option not selected');
      if (st.gst !== '') fail('REVIEW: GST field was touched');
      if (!st.bhim) fail('REVIEW: BHIM/UPI payment option not selected');
      if (st.cards) fail('REVIEW: cards payment option should have been deselected');
      if (st.cont !== 1) fail('REVIEW: Continue not clicked exactly once');
      if (!st.reviewJourney) fail('REVIEW: Review Journey page did not open after Continue');
      if (st.gateway) fail('REVIEW: must not reach the gateway yet (payment engine does that)');
      if (st.submits !== 0) fail('REVIEW: a form was submitted');
      console.log('REVIEW_OK');
      await page.close();
    }

    // ============ Phase H3: review with live-style label variants ==========
    {
      const script = review.buildReviewScript({ paymentMode: 'bhim' }, { seed: SEED });
      checkScript('review-labels', script);
      const page = await browser.newPage();
      await page.goto('file://' + MOCK_BOOKING + '?state=passenger&labels=1');
      await page.addScriptTag({ content: script });
      await waitForEvent(page, 'REVIEW_DONE', 90000);
      const log = await eventLog(page);
      if (log.map((e) => e.type).includes('REVIEW_STEP_MISSING')) {
        fail('REVIEW_LABELS: missing steps: ' + log.filter((e) => e.type === 'REVIEW_STEP_MISSING').map((e) => e.data.step).join(','));
      }
      const st = await page.evaluate(() => ({
        skip: document.getElementById('skipRadio').checked,
        bhim: document.getElementById('payBhim').checked,
        cont: window.__continueClicked,
        reviewJourney: window.getComputedStyle(document.getElementById('reviewJourneyPage')).display !== 'none',
        submits: window.__formSubmits,
      }));
      if (!st.skip) fail('REVIEW_LABELS: Skip card option not selected');
      if (!st.bhim) fail('REVIEW_LABELS: BHIM/UPI not selected');
      if (st.cont !== 1) fail('REVIEW_LABELS: CONTINUE arrow not clicked exactly once');
      if (!st.reviewJourney) fail('REVIEW_LABELS: Review Journey page did not open');
      if (st.submits !== 0) fail('REVIEW_LABELS: a form was submitted');
      console.log('REVIEW_LABELS_OK');
      await page.close();
    }

    // ============ Phase H2: review with IRCTC-default payment ============
    {
      const page = await browser.newPage();
      await page.goto('file://' + MOCK_BOOKING + '?state=passenger');
      const scriptH2 = review.buildReviewScript({ paymentMode: 'default' }, { seed: SEED });
      checkScript('review-default', scriptH2);
      await page.addScriptTag({ content: scriptH2 });
      await waitForEvent(page, 'REVIEW_DONE', 90000);
      const st = await page.evaluate(() => ({
        skip: document.getElementById('skipRadio').checked,
        bhim: document.getElementById('payBhim').checked,
        cards: document.getElementById('payCards').checked,
        cont: window.__continueClicked,
      }));
      if (!st.skip) fail('REVIEW_DEFAULT: Skip card option not selected');
      if (!st.cards) fail('REVIEW_DEFAULT: IRCTC-default payment option was changed');
      if (st.bhim) fail('REVIEW_DEFAULT: BHIM/UPI should not have been selected');
      if (st.cont !== 1) fail('REVIEW_DEFAULT: Continue not clicked');
      console.log('REVIEW_DEFAULT_OK');
      await page.close();
    }

    // ============ Phase I1: payment — Review Journey -> method -> provider -> Pay & Book
    {
      const plan = { paymentMethod: 'ipay', paymentProvider: 'phonepe' };
      const script = payment.buildPaymentScript(plan, { seed: SEED });
      checkScript('payment', script);
      const violations = payment.scanPaymentForViolations(script);
      if (violations.length !== 0) {
        fail('PAYMENT: script violations: ' + violations.join('; '));
      }
      const page = await browser.newPage();
      await page.goto('file://' + MOCK_BOOKING + '?state=review');
      await page.addScriptTag({ content: script });
      await waitForEvent(page, 'GATEWAY_REACHED', 90000);
      const log = await eventLog(page);
      const types = log.map((e) => e.type);
      if (types.includes('PAYMENT_STEP_MISSING')) {
        fail('PAYMENT: missing steps: ' + log.filter((e) => e.type === 'PAYMENT_STEP_MISSING').map((e) => e.data.step).join(','));
      }
      if (!types.includes('PAYMENT_STARTED') || !types.includes('GATEWAY_REACHED')) {
        fail('PAYMENT: missing start/gateway events (got ' + types.join(',') + ')');
      }
      const st = await page.evaluate(() => ({
        reviewCont: window.__reviewContinueClicked,
        method: window.__payMethodSelected,
        ipayChecked: Array.from(document.querySelectorAll('input[name="paymethod"]')).find((r) => r.value === 'ipay').checked,
        payCont: window.__payContinueClicked,
        provider: window.__providerSelected,
        payBook: window.__payBookClicked,
        gateway: window.getComputedStyle(document.getElementById('paymentGateway')).display !== 'none',
        submits: window.__formSubmits,
      }));
      if (st.reviewCont !== 1) fail('PAYMENT: Review Journey Continue not clicked');
      if (st.method !== 'ipay' || !st.ipayChecked) fail('PAYMENT: IRCTC iPay not selected');
      if (st.payCont !== 1) fail('PAYMENT: Payment Methods Continue not clicked');
      if (st.provider !== 'phonepe') fail('PAYMENT: PhonePe not selected (got "' + st.provider + '")');
      if (st.payBook !== 1) fail('PAYMENT: Pay & Book not clicked exactly once');
      if (!st.gateway) fail('PAYMENT: gateway marker not reached after Pay & Book');
      if (st.submits !== 0) fail('PAYMENT: a form was submitted');
      console.log('PAYMENT_OK');
      await page.close();
    }

    // ============ Phase I3: payment with live-style label variants =========
    {
      const plan = { paymentMethod: 'ipay', paymentProvider: 'phonepe' };
      const script = payment.buildPaymentScript(plan, { seed: SEED });
      checkScript('payment-labels', script);
      const violations = payment.scanPaymentForViolations(script);
      if (violations.length !== 0) {
        fail('PAYMENT_LABELS: script violations: ' + violations.join('; '));
      }
      const page = await browser.newPage();
      await page.goto('file://' + MOCK_BOOKING + '?state=review&labels=1');
      await page.addScriptTag({ content: script });
      await waitForEvent(page, 'GATEWAY_REACHED', 90000);
      const log = await eventLog(page);
      if (log.map((e) => e.type).includes('PAYMENT_STEP_MISSING')) {
        fail('PAYMENT_LABELS: missing steps: ' + log.filter((e) => e.type === 'PAYMENT_STEP_MISSING').map((e) => e.data.step).join(','));
      }
      const st = await page.evaluate(() => ({
        reviewCont: window.__reviewContinueClicked,
        ipayChecked: Array.from(document.querySelectorAll('input[name="paymethod"]')).find((r) => r.value === 'ipay').checked,
        payCont: window.__payContinueClicked,
        provider: window.__providerSelected,
        payBook: window.__payBookClicked,
        gateway: window.getComputedStyle(document.getElementById('paymentGateway')).display !== 'none',
        submits: window.__formSubmits,
      }));
      if (st.reviewCont !== 1) fail('PAYMENT_LABELS: Review Journey Continue not clicked');
      if (!st.ipayChecked) fail('PAYMENT_LABELS: IRCTC iPay not selected');
      if (st.payCont !== 1) fail('PAYMENT_LABELS: Payment Methods Continue not clicked');
      if (st.provider !== 'phonepe') fail('PAYMENT_LABELS: PhonePe not selected (got "' + st.provider + '")');
      if (st.payBook !== 1) fail('PAYMENT_LABELS: Pay and Book not clicked exactly once');
      if (!st.gateway) fail('PAYMENT_LABELS: gateway marker not reached');
      if (st.submits !== 0) fail('PAYMENT_LABELS: a form was submitted');
      console.log('PAYMENT_LABELS_OK');
      await page.close();
    }

    // ============ Phase I2: payment with IRCTC defaults (nothing selected) =
    {
      const plan = { paymentMethod: 'default', paymentProvider: 'default' };
      const script = payment.buildPaymentScript(plan, { seed: SEED });
      checkScript('payment-default', script);
      const violations = payment.scanPaymentForViolations(script);
      if (violations.length !== 0) {
        fail('PAYMENT_DEFAULT: script violations: ' + violations.join('; '));
      }
      const page = await browser.newPage();
      await page.goto('file://' + MOCK_BOOKING + '?state=review');
      await page.addScriptTag({ content: script });
      await waitForEvent(page, 'GATEWAY_REACHED', 90000);
      const st = await page.evaluate(() => ({
        method: window.__payMethodSelected,
        multipleChecked: Array.from(document.querySelectorAll('input[name="paymethod"]')).find((r) => r.value === 'multiple').checked,
        provider: window.__providerSelected,
        payBook: window.__payBookClicked,
        gateway: window.getComputedStyle(document.getElementById('paymentGateway')).display !== 'none',
        submits: window.__formSubmits,
      }));
      if (st.method !== '') fail('PAYMENT_DEFAULT: payment method was changed');
      if (!st.multipleChecked) fail('PAYMENT_DEFAULT: IRCTC-default method was deselected');
      if (st.provider !== '') fail('PAYMENT_DEFAULT: a provider was selected');
      if (st.payBook !== 1) fail('PAYMENT_DEFAULT: Pay & Book not clicked');
      if (!st.gateway) fail('PAYMENT_DEFAULT: gateway marker not reached');
      if (st.submits !== 0) fail('PAYMENT_DEFAULT: a form was submitted');
      console.log('PAYMENT_DEFAULT_OK');
      await page.close();
    }
  } finally {
    await browser.close();
  }
})().catch((e) => fail('unexpected harness error: ' + (e && e.stack ? e.stack : e)));
