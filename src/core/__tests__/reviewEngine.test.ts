/**
 * Review engine tests: the review page is IRCTC's last screen before
 * payment — Skip card option, GST untouched, saved payment mode, Continue,
 * then stop. The script must carry zero payment capability.
 */
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  buildReviewScript,
  scanReviewForViolations,
  type ReviewPaymentMode,
} from '../reviewEngine';

const MODES: ReviewPaymentMode[] = ['default', 'cards', 'bhim'];

describe('review script safety', () => {
  for (const mode of MODES) {
    it(`carries zero submit/payment capability (mode=${mode})`, () => {
      const script = buildReviewScript({ paymentMode: mode }, { seed: 7 });
      expect(scanReviewForViolations(script)).toEqual([]);
    });

    it(`embeds the saved payment mode (mode=${mode})`, () => {
      const script = buildReviewScript({ paymentMode: mode }, { seed: 7 });
      expect(script).toContain(`"paymentMode":"${mode}"`);
    });

    it(`is syntactically valid JavaScript (mode=${mode})`, () => {
      // Same template-literal escape guard as the post-search engine.
      const script = buildReviewScript({ paymentMode: mode }, { seed: 7 });
      const f = path.join(os.tmpdir(), `jest-review-syntax-${mode}.js`);
      fs.writeFileSync(f, script);
      expect(() => execFileSync('node', ['--check', f], { stdio: 'pipe' })).not.toThrow();
    });
  }

  it('is deterministic for a fixed seed', () => {
    const a = buildReviewScript({ paymentMode: 'bhim' }, { seed: 7 });
    expect(buildReviewScript({ paymentMode: 'bhim' }, { seed: 7 })).toBe(a);
  });

  it('targets exactly one Continue button', () => {
    const script = buildReviewScript({ paymentMode: 'bhim' }, { seed: 7 });
    const matches = script.match(/exactButton\('Continue'\)/g) || [];
    expect(matches).toHaveLength(1);
  });

  it('scanner catches a pay button smuggled into the script', () => {
    const script = buildReviewScript({ paymentMode: 'bhim' }, { seed: 7 });
    expect(scanReviewForViolations(script + '\nproceedToPayment();')).toContain(
      'payment-gateway interaction',
    );
  });

  it('scanner catches a book-now click smuggled into the script', () => {
    const script = buildReviewScript({ paymentMode: 'bhim' }, { seed: 7 });
    expect(scanReviewForViolations(script + '\n// click the Book Now button')).toEqual([]);
    // (comments are stripped before scanning — only code counts)
    expect(
      scanReviewForViolations(script + '\nvar x = "Book Now"; x.click();'),
    ).toContain('book-now reference');
  });

  it('never locates a GST input (GST stays untouched)', () => {
    const script = buildReviewScript({ paymentMode: 'bhim' }, { seed: 7 });
    // Comments may document the deliberate skip; no DOM query may target GST.
    const queries = script.match(/(getElementById|querySelector(All)?)\([^)]*\)/g) || [];
    expect(queries.filter((q) => q.toLowerCase().includes('gst'))).toEqual([]);
  });
});
