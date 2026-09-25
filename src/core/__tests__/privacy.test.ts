/**
 * G9 — WebView allowlist unit tests.
 * Run: node node_modules/jest/bin/jest.js (repo root)
 */
import { isAllowedUrl, allowedHosts } from '../privacy';

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
