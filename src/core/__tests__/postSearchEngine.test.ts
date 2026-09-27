/**
 * Post-search engine tests: plan helpers (date card, class code, validation)
 * and the safety invariants for the Search-Trains → Book-Now script.
 */
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  buildPostSearchScript,
  normalizeClassCode,
  scanPostSearchForViolations,
  toDateCard,
  validatePostSearchPlan,
  type PostSearchPlan,
} from '../postSearchEngine';

const PLAN: PostSearchPlan = {
  trainNo: '12873',
  classCode: '3A',
  dateISO: '2026-09-29',
  dateCard: toDateCard('2026-09-29'),
};

describe('toDateCard', () => {
  it('renders the IRCTC date-card label', () => {
    expect(toDateCard('2026-09-29')).toBe('29 Sep');
    expect(toDateCard('2026-01-05')).toBe('05 Jan');    expect(toDateCard('2026-12-31')).toBe('31 Dec');
  });
  it('throws on malformed input', () => {
    expect(() => toDateCard('29/09/2026')).toThrow();
    expect(() => toDateCard('2026-13-99')).toThrow();
    expect(() => toDateCard('not-a-date')).toThrow();
  });
});

describe('normalizeClassCode', () => {
  it('uppercases codes and maps All Classes to ALL', () => {
    expect(normalizeClassCode('3a')).toBe('3A');
    expect(normalizeClassCode('All Classes')).toBe('ALL');
    expect(normalizeClassCode('all classes')).toBe('ALL');
  });
});

describe('validatePostSearchPlan', () => {
  it('accepts a well-formed plan', () => {
    expect(() => validatePostSearchPlan(PLAN)).not.toThrow();
  });
  it('rejects bad train numbers, dates, and classes', () => {
    expect(() => validatePostSearchPlan({ ...PLAN, trainNo: '123' })).toThrow();
    expect(() => validatePostSearchPlan({ ...PLAN, trainNo: 'abcde' })).toThrow();
    expect(() => validatePostSearchPlan({ ...PLAN, dateISO: 'tomorrow' })).toThrow();
    expect(() => validatePostSearchPlan({ ...PLAN, classCode: '' })).toThrow();
    expect(() => validatePostSearchPlan({ ...PLAN, dateCard: '' })).toThrow();
  });
});

describe('post-search script safety', () => {
  const script = buildPostSearchScript(PLAN, { seed: 7 });

  it('embeds the plan (train, class, date card)', () => {
    expect(script).toContain('12873');
    expect(script).toContain('29 Sep');
  });

  it('carries zero submit/payment capability', () => {
    expect(scanPostSearchForViolations(script)).toEqual([]);
  });

  it('is deterministic for a fixed seed', () => {
    expect(buildPostSearchScript(PLAN, { seed: 7 })).toBe(script);
  });

  it('is syntactically valid JavaScript (template-literal escape check)', () => {
    // Guards the /bhim\\/upi/ class of bug: a backslash eaten while the
    // script is assembled inside a TS template literal becomes a syntax
    // error only at inject time. node --check catches it here instead.
    const f = path.join(os.tmpdir(), 'jest-postsearch-syntax.js');
    fs.writeFileSync(f, script);
    expect(() => execFileSync('node', ['--check', f], { stdio: 'pipe' })).not.toThrow();
  });

  it('scanner catches a form.submit() smuggled into the script', () => {
    const violations = scanPostSearchForViolations(script + '\nform.submit();');
    expect(violations.some((v) => /submit/i.test(v))).toBe(true);
  });

  it('scanner catches a pay-now call smuggled into the script', () => {
    expect(scanPostSearchForViolations(script + '\nproceedToPayment();')).toContain(
      'payment-gateway interaction',
    );
  });

  it('scanner does not false-positive on documentation comments', () => {
    const commented = '/* never CAPTCHA-solving; detection for halting is fine */\n' + script;
    expect(scanPostSearchForViolations(commented)).toEqual([]);
  });
});
