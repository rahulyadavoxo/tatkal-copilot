import { buildResumeProbeScript, isPaymentEnginePage } from '../resumeProbe';

function runProbe(bodyText: string, inputs: Array<{ ph?: string; name?: string; aria?: string; w?: number; h?: number }> = []): any {
  const posted: any[] = [];
  const inputEls = inputs.map((i) => ({
    getBoundingClientRect: () => ({ width: i.w ?? 100, height: i.h ?? 20 }),
    getAttribute: (n: string) =>
      n === 'placeholder' ? i.ph ?? null : n === 'name' ? i.name ?? null : n === 'aria-label' ? i.aria ?? null : null,
  }));
  (global as any).document = {
    body: { innerText: bodyText },
    querySelectorAll: (sel: string) => (sel === 'input' ? inputEls : []),
  };
  (global as any).window = {
    ReactNativeWebView: { postMessage: (d: string) => posted.push(JSON.parse(d)) },
  };
  (global as any).performance = { now: () => 1 };
  try {
    // eslint-disable-next-line no-eval
    eval(buildResumeProbeScript(7));
  } finally {
    delete (global as any).document;
    delete (global as any).window;
    delete (global as any).performance;
  }
  expect(posted.length).toBe(1);
  expect(posted[0].type).toBe('RESUME_PROBE_RESULT');
  return posted[0].data.page;
}

describe('resumeProbe', () => {
  it('detects the Payment Methods page', () => {
    expect(
      runProbe('Payment Methods\nSafe & Secure Payments\nIRCTC iPay (Credit Card/Debit Card/UPI)\nMultiple Payment Service\nBHIM/ UPI/ USSD\n₹ 2,563.60 Continue'),
    ).toBe('paymethods');
  });

  it('detects the provider page', () => {
    expect(runProbe('PhonePe\nPaytm\nPay & Book')).toBe('providers');
  });

  it('still detects the Review Journey page (Payment Mode section must not win)', () => {
    expect(
      runProbe('Review Journey\nYour ticket will be sent to\nPayment Mode\nPay through BHIM/UPI\n₹ 2,563.60 Continue'),
    ).toBe('reviewJourney');
  });

  it('still detects the passenger page (its Payment Mode heading must not win)', () => {
    expect(
      runProbe('Add Passenger\nPayment Mode\nPay through BHIM/UPI', [
        { ph: 'Full name as per Govt. ID' },
        { ph: 'Age' },
      ]),
    ).toBe('passenger');
  });

  it('still detects the search page', () => {
    expect(runProbe('Book Your Ticket\nSearch Trains')).toBe('search');
  });

  it('routes every payment page to the payment engine', () => {
    expect(isPaymentEnginePage('reviewJourney')).toBe(true);
    expect(isPaymentEnginePage('paymethods')).toBe(true);
    expect(isPaymentEnginePage('providers')).toBe(true);
    expect(isPaymentEnginePage('passenger')).toBe(false);
    expect(isPaymentEnginePage('search')).toBe(false);
    expect(isPaymentEnginePage('unknown')).toBe(false);
  });
});
