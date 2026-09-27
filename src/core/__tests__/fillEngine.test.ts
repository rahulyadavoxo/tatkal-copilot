/**
 * L2 unit tests: pacing math, seeded determinism, no-auto-book invariant,
 * and the alternate parser. These run without a browser.
 */
import {
  berthOptionText,
  buildFieldActions,
  buildFillScript,
  buildFormProbeScript,
  computeFieldGaps,
  findSubmitPatterns,
  genderOptionText,
  MIN_FIELD_GAP_MS,
  mulberry32,
  parseAlternates,
  requiredFloorMs,
  scanForAutobookViolations,
  FillPlan,
} from '../fillEngine';

const FOUR_PAX: FillPlan = {
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

// 4 pax: pax0 = 4 fields; pax1..3 = addPassenger + 4 fields each;
// + auto-upgradation checkbox + contact mobile + travel insurance radio.
const FIELD_COUNT_4PAX = 4 + 3 * 5 + 3; // 22

describe('pacing math', () => {
  test('22 actions (4 pax): every gap >= 120ms and total >= 4.2s floor', () => {
    const gaps = computeFieldGaps(FIELD_COUNT_4PAX, 1234, 4);
    expect(gaps).toHaveLength(FIELD_COUNT_4PAX);
    for (const g of gaps) expect(g).toBeGreaterThanOrEqual(MIN_FIELD_GAP_MS);
    const total = gaps.reduce((a, b) => a + b, 0);
    expect(total).toBeGreaterThanOrEqual(4200);
    // The harness measures last-fill minus first-fill (excludes GAPS[0]):
    // that measured quantity must also clear the floor.
    expect(total - gaps[0]).toBeGreaterThanOrEqual(4200);
  });

  test('floor scaling: max(4.2s, 0.84s * pax) — never below the published 4.2s', () => {
    expect(requiredFloorMs(4)).toBe(4200); // 0.84*4 = 3.36 < 4.2 -> 4.2 binds
    expect(requiredFloorMs(5)).toBe(4200);
    expect(requiredFloorMs(1)).toBe(4200);
    expect(requiredFloorMs(6)).toBeGreaterThan(4200); // 0.84*6 = 5.04 scales up
  });

  test('mulberry32 is deterministic', () => {
    const a = mulberry32(99);
    const b = mulberry32(99);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });

  test('seeded jitter is deterministic: same seed -> identical gaps', () => {
    expect(computeFieldGaps(FIELD_COUNT_4PAX, 7, 4)).toEqual(
      computeFieldGaps(FIELD_COUNT_4PAX, 7, 4),
    );
  });

  test('different seeds -> different schedules (jitter actually varies)', () => {
    expect(computeFieldGaps(FIELD_COUNT_4PAX, 7, 4)).not.toEqual(
      computeFieldGaps(FIELD_COUNT_4PAX, 8, 4),
    );
  });

  test('buildFillScript is deterministic for a fixed seed', () => {
    const s1 = buildFillScript(FOUR_PAX, { seed: 4242 });
    const s2 = buildFillScript(FOUR_PAX, { seed: 4242 });
    expect(s1).toBe(s2);
  });

  test('field actions: passenger page — pax fields with real-IRCTC locators, add-passenger clicks, preferences', () => {
    const actions = buildFieldActions(FOUR_PAX);
    expect(actions).toHaveLength(FIELD_COUNT_4PAX);

    // pax0: name/age/gender/berth with human-like locators, no add-passenger first.
    const pax0 = actions.slice(0, 4);
    expect(pax0.map((a) => a.kind)).toEqual(['input', 'input', 'select', 'select']);
    expect(pax0[0]).toMatchObject({
      label: 'pax0.name',
      locator: { attrText: ['Full Name as per Govt'], paxIndex: 0 },
    });
    expect(pax0[2]).toMatchObject({
      label: 'pax0.gender',
      locator: { labelText: ['Gender'], paxIndex: 0 },
      optionText: ['Male'],
    });
    expect(pax0[3].optionText).toEqual(['Lower']);

    // pax1..3: each block is preceded by an add-passenger click action.
    const addClicks = actions.filter((a) => a.kind === 'addPassenger');
    expect(addClicks).toHaveLength(3);
    expect(addClicks[0].locator.labelText).toContain('Add Passenger');
    const pax1 = actions.slice(5, 9);
    expect(pax1.map((a) => a.label)).toEqual([
      'pax1.name',
      'pax1.age',
      'pax1.gender',
      'pax1.berth',
    ]);
    expect(pax1.every((a) => a.locator.paxIndex === 1)).toBe(true);

    // Tail: auto-upgradation checkbox, contact mobile, travel-insurance radio.
    const tail = actions.slice(-3);
    expect(tail.map((a) => a.kind)).toEqual(['checkbox', 'input', 'radio']);
    expect(tail[0]).toMatchObject({
      label: 'auto-upgradation',
      kind: 'checkbox',
      value: 'on',
    });
    expect(tail[0].locator.labelText).toContain('Consider for Auto Upgradation');
    expect(tail[1]).toMatchObject({ label: 'contact-mobile', value: '9876543210' });
    expect(tail[2]).toMatchObject({
      label: 'travel-insurance',
      kind: 'radio',
      value: 'yes',
      optionText: ['Yes, and I accept'],
    });

    // A plan that opts out leaves the auto-upgradation checkbox exactly as
    // IRCTC renders it ('leave' = never touch it) and picks "no insurance".
    const off = buildFieldActions({
      ...FOUR_PAX,
      autoUpgradation: false,
      travelInsurance: false,
      contactMobile: '',
    });
    expect(off.filter((a) => a.label === 'auto-upgradation')[0].value).toBe('leave');
    expect(off.filter((a) => a.label === 'travel-insurance')[0]).toMatchObject({
      value: 'no',
      optionText: ["No, I don't want"],
    });
    // No mobile number -> no mobile action.
    expect(off.some((a) => a.label === 'contact-mobile')).toBe(false);
  });

  test('option-text maps use IRCTC visible labels', () => {
    expect(genderOptionText('M')).toEqual(['Male']);
    expect(genderOptionText('F')).toEqual(['Female']);
    expect(berthOptionText('LB')).toEqual(['Lower']);
    expect(berthOptionText('SU')).toEqual(['Side Upper']);
    expect(berthOptionText('NP')).toEqual(['No Preference']);
    expect(berthOptionText('unknown-code')).toEqual(['No Preference']);
  });

  test('generated script sets the checkbox via .checked, not .value', () => {
    const src = buildFillScript(FOUR_PAX, { seed: 9 });
    expect(src).toContain("kind === 'checkbox'");
    expect(src).toContain('el.checked');
  });
});

describe('no-auto-book invariant', () => {
  test('generated script has zero submit capability, anywhere', () => {
    const src = buildFillScript(FOUR_PAX, { seed: 1 });
    expect(scanForAutobookViolations(src)).toEqual([]);
  });

  test('the script never references a book/continue/pay button', () => {
    const src = buildFillScript(FOUR_PAX, { seed: 1 });
    expect(src).not.toMatch(/bookNowBtn|continueBtn|proceedToBook|proceedToPayment/i);
  });

  test('scanner catches a form.submit() smuggled into the script', () => {
    const src = buildFillScript(FOUR_PAX, { seed: 1 }) + '\ndocument.forms[0].submit();\n';
    expect(scanForAutobookViolations(src)).toContain('form.submit() call');
  });

  test('scanner catches a booking-button click smuggled into the script', () => {
    const src =
      buildFillScript(FOUR_PAX, { seed: 1 }) +
      "\ndocument.getElementById('bookNowBtn').click();\n";
    expect(scanForAutobookViolations(src)).toContain('booking/continue button reference');
  });

  test('scanner flags even a bare script with no markers (no gate concept anymore)', () => {
    // The invariant is "no submit patterns", not "gate present": a script
    // with no submit patterns is clean even without any marker comments.
    expect(scanForAutobookViolations('var x = 1;')).toEqual([]);
  });

  test('locator prefers attribute matches over nearby-caption matches', () => {
    // Regression: berth's labelText ['Preference'] substring-matched "No
    // Preference" inside the gender dropdown's caption, so the gender widget
    // won the berth action. Attribute matches (placeholder/aria-label on the
    // control itself) must outrank caption matches.
    const src = buildFillScript(FOUR_PAX, { seed: 1 });
    expect(src).toContain('attrMatches.length > 0 ? attrMatches : labelMatches');
  });

  test('dropdown option search is scoped to the opened widget', () => {
    // Regression: with two passenger blocks, a document-wide option query
    // hit passenger 1's dropdown items first (document order) and overwrote
    // passenger 1's widget when filling passenger 2.
    const src = buildFillScript(FOUR_PAX, { seed: 1 });
    expect(src).toContain('el.querySelectorAll');
    expect(src).toContain("!o.closest('.p-dropdown')");
  });

  test('data-* attributes count as attribute text for locators', () => {
    // Lets each widget type (p-dropdown vs mat-select) form its own
    // per-passenger match list so paxIndex stays within one widget kind.
    const src = buildFillScript(FOUR_PAX, { seed: 1 });
    expect(src).toContain("indexOf('data-') === 0");
  });

  test('no user-confirm function exists in the generated script', () => {
    const src = buildFillScript(FOUR_PAX, { seed: 1 });
    expect(src).not.toContain('__tatkalUserConfirm');
  });
});

describe('parseAlternates (G7)', () => {
  const SNAPSHOT = `
    <table id="altTable"><tbody>
      <tr class="altRow" data-train="12951" data-date="2026-09-28" data-class="3A" data-seats="42">
        <td>12951 Mumbai Rajdhani</td><td>28 Sep</td><td>3A</td><td>42 seats</td>
      </tr>
      <tr class="altRow" data-train="12953" data-date="2026-09-28" data-class="3A" data-seats="18">
        <td>12953 August Kranti</td><td>28 Sep</td><td>3A</td><td>18 seats</td>
      </tr>
    </tbody></table>`;

  test('extracts alternates with train/date/class/seats', () => {
    const alts = parseAlternates(SNAPSHOT);
    expect(alts).toHaveLength(2);
    expect(alts[0]).toMatchObject({
      trainNo: '12951',
      date: '2026-09-28',
      classCode: '3A',
      seatsAvailable: 42,
    });
    expect(alts[1].trainNo).toBe('12953');
  });

  test('tolerates rows without data-* attributes (text fallback)', () => {
    const html = `<tr class="altRow"><td>12431 Rajdhani Exp</td><td>6 seats left</td></tr>`;
    const alts = parseAlternates(html);
    expect(alts).toHaveLength(1);
    expect(alts[0].trainNo).toBe('12431');
    expect(alts[0].seatsAvailable).toBe(6);
  });

  test('empty snapshot -> empty list (no crash)', () => {
    expect(parseAlternates('<div>no trains</div>')).toEqual([]);
  });
});

describe('form probe (G2 pre-step)', () => {
  test('probe posts exactly one FORM_PROBE_RESULT event', () => {
    const src = buildFormProbeScript();
    const matches = src.match(/FORM_PROBE_RESULT/g) ?? [];
    // one in each branch: blocked / ready / error
    expect(matches.length).toBe(3);
    expect(src).toContain('window.ReactNativeWebView.postMessage');
  });

  test('probe carries the passenger-page heuristic, not mock DOM ids', () => {
    const src = buildFormProbeScript();
    expect(src).toMatch(/passenger/i);
    expect(src).toContain('querySelectorAll');
    // The probe must not depend on the mock harness ids — the live DOM is
    // unverified, so id-based detection would always misfire there.
    expect(src).not.toContain('trainNo');
    expect(src).not.toContain('pax0Name');
  });

  test('probe detects the Access-Denied page as blocked', () => {
    const src = buildFormProbeScript();
    expect(src).toMatch(/access denied/i);
    expect(src).toContain('edgesuite');
    expect(src).toContain("reason: 'blocked'");
  });

  test('probe script has zero auto-book violations', () => {
    expect(findSubmitPatterns(buildFormProbeScript())).toEqual([]);
    // …and it never submits anything at all.
    expect(buildFormProbeScript()).not.toContain('.submit(');
  });
});
