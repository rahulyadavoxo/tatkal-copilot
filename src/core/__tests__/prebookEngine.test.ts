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

  it('defines every function the script calls (no dropped helpers)', () => {
    // Regression guard: a refactor once deleted captchaPresent() and the
    // only signal was a harness timeout. Every bare call in the built
    // script must resolve to a defined function or a known browser global.
    // String literals are stripped first: CSS selectors like
    // input:not([type]) would otherwise look like function calls.
    // Strip string literals (CSS selectors like input:not([type]) would
    // otherwise look like calls), then line comments (e.g. "strip (no"
    // in prose would too). What remains is real code.
    const code = script
      .replace(/'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"/g, '')
      .replace(/\/\/.*/g, '');
    const defined = new Set(
      [...code.matchAll(/function\s+([A-Za-z_$][\w$]*)\s*\(/g)].map((m) => m[1]),
    );
    const globals = new Set([
      'Array', 'Object', 'JSON', 'Math', 'Date', 'RegExp', 'Error', 'Promise',
      'String', 'Number', 'Boolean', 'parseInt', 'parseFloat', 'isNaN',
      'encodeURIComponent', 'decodeURIComponent', 'setTimeout', 'clearTimeout',
      'setInterval', 'clearInterval', 'requestAnimationFrame', 'document',
      'window', 'navigator', 'location', 'KeyboardEvent', 'Event', 'CustomEvent',
      'URLSearchParams', 'getComputedStyle', 'alert', 'confirm', 'scrollTo',
    ]);
    const keywords = new Set(['if', 'for', 'while', 'switch', 'catch', 'function', 'return']);
    const missing: string[] = [];
    for (const m of code.matchAll(/(?<![\w$.])\b([A-Za-z_$][\w$]*)\s*\(/g)) {
      const name = m[1];
      if (keywords.has(name) || defined.has(name) || globals.has(name)) continue;
      if (!missing.includes(name)) missing.push(name);
    }
    expect(missing).toEqual([]);
  });
});
