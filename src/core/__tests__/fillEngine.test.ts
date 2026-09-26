/**
 * L2 unit tests: pacing math, seeded determinism, no-auto-book invariant,
 * and the alternate parser. These run without a browser.
 */
import {
  buildFieldActions,
  buildFillScript,
  computeFieldGaps,
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
  passengers: [
    { name: 'Aarav Sharma', age: 34, gender: 'M', berthPref: 'LB' },
    { name: 'Diya Sharma', age: 31, gender: 'F', berthPref: 'MB' },
    { name: 'Kabir Sharma', age: 8, gender: 'M', berthPref: 'UB' },
    { name: 'Meera Devi', age: 61, gender: 'F', berthPref: 'SL' },
  ],
};

const FIELD_COUNT_4PAX = 6 + 4 * 4 + 1; // 23 (6 header + 16 pax + auto-upgradation checkbox)

describe('pacing math', () => {
  test('23 fields (4 pax): every gap >= 120ms and total >= 4.2s floor', () => {
    const gaps = computeFieldGaps(FIELD_COUNT_4PAX, 1234);
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
    expect(computeFieldGaps(FIELD_COUNT_4PAX, 7)).toEqual(
      computeFieldGaps(FIELD_COUNT_4PAX, 7),
    );
  });

  test('different seeds -> different schedules (jitter actually varies)', () => {
    expect(computeFieldGaps(FIELD_COUNT_4PAX, 7)).not.toEqual(
      computeFieldGaps(FIELD_COUNT_4PAX, 8),
    );
  });

  test('buildFillScript is deterministic for a fixed seed', () => {
    const s1 = buildFillScript(FOUR_PAX, { seed: 4242 });
    const s2 = buildFillScript(FOUR_PAX, { seed: 4242 });
    expect(s1).toBe(s2);
  });

  test('field actions cover train/class/quota + 4 fields per passenger + auto-upgradation checkbox', () => {
    const actions = buildFieldActions(FOUR_PAX);
    expect(actions).toHaveLength(FIELD_COUNT_4PAX);
    expect(actions.map((a) => a.id)).toContain('trainNo');
    expect(actions.map((a) => a.id)).toContain('quota');
    expect(actions.find((a) => a.id === 'quota')?.value).toBe('TATKAL');
    expect(actions.map((a) => a.id)).toContain('pax3Berth');
    const last = actions[actions.length - 1];
    expect(last).toMatchObject({
      id: 'autoUpgradation',
      kind: 'checkbox',
      value: 'on',
    });
    // A plan that opts out produces an untick action instead.
    const off = buildFieldActions({ ...FOUR_PAX, autoUpgradation: false });
    expect(off[off.length - 1]).toMatchObject({
      id: 'autoUpgradation',
      kind: 'checkbox',
      value: 'off',
    });
  });

  test('generated script sets the checkbox via .checked, not .value', () => {
    const src = buildFillScript(FOUR_PAX, { seed: 9 });
    expect(src).toContain("kind === 'checkbox'");
    expect(src).toContain('el.checked');
  });
});

describe('no-auto-book invariant (G5)', () => {
  test('generated script has zero submit paths outside the user-tap gate', () => {
    const src = buildFillScript(FOUR_PAX, { seed: 1 });
    expect(scanForAutobookViolations(src)).toEqual([]);
  });

  test('scanner catches a form.submit() smuggled outside the gate', () => {
    const src = buildFillScript(FOUR_PAX, { seed: 1 }) + '\ndocument.forms[0].submit();\n';
    expect(scanForAutobookViolations(src)).toContain('form.submit() call');
  });

  test('scanner catches a booking-button click outside the gate', () => {
    const src =
      buildFillScript(FOUR_PAX, { seed: 1 }) +
      "\ndocument.getElementById('bookNowBtn').click();\n";
    expect(scanForAutobookViolations(src)).toContain('booking button reference');
  });

  test('scanner requires the confirm gate markers to exist', () => {
    expect(scanForAutobookViolations('var x = 1;')).toContain(
      'confirm-gate markers missing — cannot verify submit isolation',
    );
  });

  test('the confirm gate is present exactly once in the generated script', () => {
    const src = buildFillScript(FOUR_PAX, { seed: 1 });
    expect(src.split('window.__tatkalUserConfirm').length - 1).toBe(1);
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
