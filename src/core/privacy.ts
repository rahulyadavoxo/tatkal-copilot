/**
 * G9 privacy — WebView top-level navigation allowlist.
 *
 * HONEST SCOPE (audit #39): on Android, WebView.onShouldStartLoadWithRequest
 * fires ONLY for top-level navigations — it does NOT see subresources
 * (XHR/fetch, iframes, scripts, images). So this gate blocks the page from
 * navigating away to non-IRCTC hosts, but IRCTC's own third-party scripts,
 * trackers, and analytics still load unrestricted. The earlier claim that
 * "only IRCTC's own hosts may load" overstated the enforcement; the real
 * guarantee is top-level navigation only.
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
 * G9-reviewed payment gateway hosts (2026-10-09, on-device booking):
 * IRCTC hands payment off to the PSP's own domain after "Pay & Book" —
 * e.g. https://mercury-t2.phonepe.com/transact/sltv3?token=… — and the
 * strict IRCTC-only allowlist blocked that handoff, stranding the user.
 * These are the four providers the app itself offers in Trip Setup;
 * subdomains match (PSP gateway hosts vary, e.g. mercury-t2.phonepe.com).
 * BookingScreen only permits these WHILE the payment flow is active —
 * never during search/fill — so the G9 navigation guard keeps its teeth.
 */
const PAYMENT_HOSTS = ['phonepe.com', 'payu.in', 'paytm.com', 'razorpay.com'] as const;

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

/**
 * Returns true iff `rawUrl` is an HTTPS URL on a known payment-gateway host
 * (the PSP itself or any of its subdomains). Exact-or-subdomain match —
 * `mercury-t2.phonepe.com` passes, `phonepe.com.evil.com` does not.
 */
export function isPaymentHost(rawUrl: string): boolean {
  if (!rawUrl || typeof rawUrl !== 'string') return false;
  let u: URL;
  try {
    u = new URL(rawUrl);
  } catch {
    return false;
  }
  if (u.protocol !== 'https:') return false;
  const host = u.hostname.toLowerCase().replace(/\.$/, '');
  return (PAYMENT_HOSTS as readonly string[]).some((h) => host === h || host.endsWith('.' + h));
}

/** The G9-reviewed payment hosts, for display/debugging. */
export function paymentHosts(): readonly string[] {
  return PAYMENT_HOSTS;
}
