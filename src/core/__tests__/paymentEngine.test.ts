/**
 * paymentEngine tests — Review Journey -> Payment Methods -> provider ->
 * Pay & Book -> STOP. Verifies plan validation, script determinism, the
 * safety scanner (gateway/payment-detail tripwires + positive click-target
 * controls), and that the built script is syntactically valid JS.
 */
import {
  buildPaymentScript,
  scanPaymentForViolations,
  validatePaymentPlan,
  type PaymentPlan,
} from '../paymentEngine';

const PLAN: PaymentPlan = { paymentMethod: 'multiple', paymentProvider: 'phonepe' };

describe('validatePaymentPlan', () => {
  it('accepts every supported choice', () => {
    validatePaymentPlan({ paymentMethod: 'default', paymentProvider: 'default' });
    validatePaymentPlan({ paymentMethod: 'ipay', paymentProvider: 'payu' });
    validatePaymentPlan({ paymentMethod: 'multiple', paymentProvider: 'paytm' });
    validatePaymentPlan({ paymentMethod: 'bhimUssd', paymentProvider: 'phonepe' });
    validatePaymentPlan({ paymentMethod: 'bhimUssd', paymentProvider: 'razorpay' });
  });
  it('rejects unknown choices', () => {
    expect(() => validatePaymentPlan({ ...PLAN, paymentMethod: 'bitcoin' as never })).toThrow();
    expect(() => validatePaymentPlan({ ...PLAN, paymentProvider: 'gpay' as never })).toThrow();
  });
});

describe('buildPaymentScript', () => {
  it('is deterministic for a fixed seed', () => {
    const a = buildPaymentScript(PLAN, { seed: 42 });
    const b = buildPaymentScript(PLAN, { seed: 42 });
    expect(a).toBe(b);
  });
  it('embeds the plan choices', () => {
    const script = buildPaymentScript(PLAN, { seed: 7 });
    expect(script).toContain('"paymentMethod":"multiple"');
    expect(script).toContain('"paymentProvider":"phonepe"');
  });
  it('targets exactly two Continues and one Pay & Book', () => {
    const script = buildPaymentScript(PLAN, { seed: 7 });
    expect((script.match(/exactButton\('Continue'\)/g) || []).length).toBe(2);
    expect((script.match(/exactButton\('Pay & Book'\)/g) || []).length).toBe(1);
  });
  it('builds to syntactically valid JS', () => {
    const script = buildPaymentScript(PLAN, { seed: 7 });
    expect(() => new Function(script)).not.toThrow();
  });
});

describe('payment script safety', () => {
  const script = buildPaymentScript(PLAN, { seed: 7 });

  it('scanner passes the clean script', () => {
    expect(scanPaymentForViolations(script)).toEqual([]);
  });
  it('scanner passes the all-default script', () => {
    const s2 = buildPaymentScript({ paymentMethod: 'default', paymentProvider: 'default' }, { seed: 7 });
    expect(scanPaymentForViolations(s2)).toEqual([]);
  });
  it('scanner catches a form.submit() smuggled into the script', () => {
    const violations = scanPaymentForViolations(script + '\nform.submit();');
    expect(violations.some((v) => /submit/i.test(v))).toBe(true);
  });
  it('scanner catches payment-detail entry', () => {
    const violations = scanPaymentForViolations(script + '\nvar x = cardNumber;');
    expect(violations.some((v) => /payment-detail/i.test(v))).toBe(true);
  });
  it('scanner catches a book-now click smuggled into the script', () => {
    const violations = scanPaymentForViolations(script + '\n// Book Now button\n');
    expect(violations).toEqual([]);
    const violations2 = scanPaymentForViolations(script + '\nclickBookNow();');
    expect(violations2.some((v) => /book-now/i.test(v))).toBe(true);
  });
  it('scanner catches gateway probing after Pay & Book', () => {
    const violations = scanPaymentForViolations(script + '\nproceedToPayment();');
    expect(violations.some((v) => /gateway/i.test(v))).toBe(true);
  });
  it('flags a script whose Pay & Book target was removed', () => {
    const broken = script.replace(/exactButton\('Pay & Book'\)/g, "exactButton('Gone')");
    expect(scanPaymentForViolations(broken)).toContain('pay&book-target count != 1');
  });
});
