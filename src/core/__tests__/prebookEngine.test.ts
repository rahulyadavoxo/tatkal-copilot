/**
 * Pre-booking engine tests: action contract, date helper, and the safety
 * invariants (no submit capability, credentials never in event payloads).
 */
import {
  buildPrebookActions,
  buildPrebookScript,
  scanPrebookForViolations,
  toDMY,
  type PrebookPlan,
} from '../prebookEngine';

const PLAN: PrebookPlan = {
  language: 'en',
  username: 'testuser',
  password: 'test-pass-9',
  from: { code: 'BCT', name: 'Mumbai Central' },
  to: { code: 'NDLS', name: 'New Delhi' },
  dateDMY: '15/10/2026',
  classCode: '3A',
  quota: 'TATKAL',
};

describe('buildPrebookActions', () => {
  it('returns the 9 steps in workflow order', () => {
    const actions = buildPrebookActions(PLAN);
    expect(actions).toEqual([
      { kind: 'language' },
      { kind: 'openLogin' },
      { kind: 'fillLogin' },
      { kind: 'submitLogin' },
      { kind: 'station', which: 'from' },
      { kind: 'station', which: 'to' },
      { kind: 'date' },
      { kind: 'dropdown', which: 'class' },
      { kind: 'dropdown', which: 'quota' },
    ]);
  });
});

describe('toDMY', () => {
  it('converts YYYY-MM-DD to DD/MM/YYYY', () => {
    expect(toDMY('2026-10-15')).toBe('15/10/2026');
  });
  it('throws on malformed input', () => {
    expect(() => toDMY('15/10/2026')).toThrow();
    expect(() => toDMY('not-a-date')).toThrow();
  });
});

describe('prebook script safety', () => {
  const script = buildPrebookScript(PLAN, { seed: 7 });

  it('carries zero submit/booking capability', () => {
    expect(scanPrebookForViolations(script)).toEqual([]);
  });

  it('never posts credential values inside event payloads', () => {
    // The script may contain PLAN.username only where it TYPES it into the
    // login input — never inside a post(...) event.
    expect(script).not.toMatch(/post\(\s*['"][A-Z_]+['"]\s*,\s*\{[^}]*PLAN\./);
  });

  it('halts on CAPTCHA instead of bypassing it', () => {
    expect(script).toContain('CAPTCHA_REQUIRED');
    // No attempt to read or solve the captcha image.
    expect(script).not.toMatch(/captcha.*solve|decode.*captcha/i);
  });

  it('does not touch Search Trains / Continue / Book', () => {
    expect(script).not.toMatch(/search trains|bookNowBtn|continueBtn|proceedToBook/i);
  });

  it('flags a tampered script with a submit call', () => {
    const tampered = script + '\ndocument.forms[0].submit();\n';
    expect(scanPrebookForViolations(tampered)).toContain('form.submit() call');
  });
});
