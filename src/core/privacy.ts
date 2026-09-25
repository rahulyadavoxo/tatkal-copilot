/**
 * G9 privacy — WebView network allowlist.
 *
 * Only IRCTC's own hosts may load inside the app's WebView. Everything else
 * (trackers, ad networks, lookalike phishing domains) is blocked.
 *
 * Pure + unit-tested (src/core/__tests__/privacy.test.ts) so the invariant is
 * enforceable without a device. The Booking screen wires it into
 * WebView.onShouldStartLoadWithRequest.
 *
 * DEVICE-TEST NOTE: IRCTC hands payment off to external PSP/bank domains.
 * On a real booking attempt this allowlist will block that handoff, so the
 * allowlist will need explicit, reviewed additions for payment domains only.
 * Do NOT widen it silently — any addition is a G9 review item.
 */
const ALLOWED_HOSTS = ['irctc.co.in', 'www.irctc.co.in'] as const;

/**
 * Returns true iff `rawUrl` is an HTTPS URL on an allowlisted IRCTC host.
 * Exact host match only — subdomains like `irctc.co.in.evil.com` do NOT pass.
 */
export function isAllowedUrl(rawUrl: string): boolean {
  if (!rawUrl || typeof rawUrl !== 'string') return false;
  let u: URL;
  try {
    u = new URL(rawUrl);
  } catch {
    return false; // not parseable (javascript:, data:, garbage)
  }
  if (u.protocol !== 'https:') return false; // IRCTC is HTTPS-only
  const host = u.hostname.toLowerCase().replace(/\.$/, ''); // tolerate trailing dot
  return (ALLOWED_HOSTS as readonly string[]).includes(host);
}

/** The allowlisted hosts, for display/debugging. */
export function allowedHosts(): readonly string[] {
  return ALLOWED_HOSTS;
}
