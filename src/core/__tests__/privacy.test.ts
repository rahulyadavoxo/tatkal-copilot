/**
 * G9 — WebView allowlist unit tests.
 * Run: node node_modules/jest/bin/jest.js (repo root)
 */
import { isAllowedUrl, allowedHosts, isPaymentHost, paymentHosts } from '../privacy';

describe('isAllowedUrl (G9 allowlist)', () => {
  test('allows the IRCTC booking host over HTTPS', () => {
    expect(isAllowedUrl('https://www.irctc.co.in/nget/train-search')).toBe(true);
    expect(isAllowedUrl('https://irctc.co.in/')).toBe(true);
  });

  test('host matching is case-insensitive and tolerates a trailing dot', () => {
    expect(isAllowedUrl('https://WWW.IRCTC.CO.IN/x')).toBe(true);
    expect(isAllowedUrl('https://www.irctc.co.in./x')).toBe(true);
  });

  test('rejects lookalike / subdomain-squat hosts', () => {
    expect(isAllowedUrl('https://irctc.co.in.evil.com/')).toBe(false);
    expect(isAllowedUrl('https://evil-irctc.co.in/')).toBe(false);
    expect(isAllowedUrl('https://www.irctc.co.in.attacker.example/')).toBe(false);
    expect(isAllowedUrl('https://irctc-login.com/')).toBe(false);
  });

  test('rejects non-HTTPS schemes and non-URL input', () => {
    expect(isAllowedUrl('http://www.irctc.co.in/')).toBe(false); // http blocked
    expect(isAllowedUrl('javascript:alert(1)')).toBe(false);
    expect(isAllowedUrl('data:text/html,<h1>x</h1>')).toBe(false);
    expect(isAllowedUrl('')).toBe(false);
    expect(isAllowedUrl('not a url at all')).toBe(false);
  });

  test('allowedHosts() exposes exactly the two IRCTC hosts', () => {
    expect([...allowedHosts()].sort()).toEqual(['irctc.co.in', 'www.irctc.co.in']);
  });
});

describe('isPaymentHost (G9-reviewed PSP gateways)', () => {
  test('allows the PSP hosts and their subdomains over HTTPS', () => {
    expect(isPaymentHost('https://mercury-t2.phonepe.com/transact/sltv3?token=abc')).toBe(true);
    expect(isPaymentHost('https://phonepe.com/')).toBe(true);
    expect(isPaymentHost('https://secure.payu.in/_payment')).toBe(true);
    expect(isPaymentHost('https://paytm.com/')).toBe(true);
    expect(isPaymentHost('https://api.razorpay.com/v1/checkout')).toBe(true);
  });

  test('host matching is case-insensitive and tolerates a trailing dot', () => {
    expect(isPaymentHost('https://MERCURY-T2.PHONEPE.COM/x')).toBe(true);
    expect(isPaymentHost('https://phonepe.com./x')).toBe(true);
  });

  test('rejects lookalike / squat hosts and non-payment hosts', () => {
    expect(isPaymentHost('https://phonepe.com.evil.com/')).toBe(false);
    expect(isPaymentHost('https://evil-phonepe.com/')).toBe(false);
    expect(isPaymentHost('https://www.irctc.co.in/')).toBe(false);
    expect(isPaymentHost('https://example.com/')).toBe(false);
  });

  test('rejects non-HTTPS schemes and non-URL input', () => {
    expect(isPaymentHost('http://phonepe.com/')).toBe(false);
    expect(isPaymentHost('javascript:alert(1)')).toBe(false);
    expect(isPaymentHost('')).toBe(false);
    expect(isPaymentHost('not a url')).toBe(false);
  });

  test('paymentHosts() exposes the four reviewed PSP hosts', () => {
    expect([...paymentHosts()].sort()).toEqual(['paytm.com', 'payu.in', 'phonepe.com', 'razorpay.com']);
  });
});
