/**
 * Booking — the core screen (gates G2/G4/G5/G9 live here).
 *
 * - A native WebView loads https://www.irctc.co.in as a TOP-LEVEL document
 *   (never iframed) with a stock mobile-Chrome user agent
 *   (docs/IRCTC_RULES.md §5: default WebView UAs are a fingerprint risk).
 * - G9: onShouldStartLoadWithRequest enforces the irctc.co.in allowlist
 *   (src/core/privacy.ts). Payment-app intents (upi://, phonepe://, …) are NOT
 *   loaded in the WebView — they open in the user's own app so the user pays
 *   there by hand; https payment-gateway pages stay blocked until explicitly
 *   reviewed in — see privacy.ts note.
 * - The fill script (src/core/fillEngine.ts) fires ONLY on the explicit
 *   "Fill my form" tap, paced by the engine (G2). It fills passengers and
 *   ticks "Consider for auto upgradation" (the user's stated preference).
 *   The engine never submits.
 * - G4: when the engine emits OTP_REQUIRED, the native OTP overlay appears.
 *   OTP entry is manual in v1; the SMS User Consent native module plugs in
 *   at the marked OTP_AUTO_HOOK later.
 * - G5: the ONLY booking-submit path in the product is
 *   window.__tatkalUserConfirm(), invoked from exactly ONE native call site
 *   below, itself behind the explicit "Review & Book on IRCTC" tap.
 *
 * DEVICE-TEST ITEMS (not verifiable here): the engine's DOM ids
 * (trainNo/fromStn/…/bookNowBtn/otpInput) are validated against the L2 mock
 * harness only — they must be mapped to IRCTC's live DOM on a real device
 * before any real 10:00 attempt.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Linking,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import WebView, { type WebViewInstance } from '../webview';
import type { WebViewMessageEvent } from 'react-native-webview';
// Type-only deep imports: erased at compile time, so Metro never resolves them.
// (v13's root index only re-exports WebViewMessageEvent among the event types.)
import type {
  ShouldStartLoadRequest,
  WebViewErrorEvent,
} from 'react-native-webview/lib/WebViewTypes';
import { C } from '../theme';
import { isAllowedUrl } from '../core/privacy';
import {
  buildFillScript,
  CONFIRM_FN_NAME,
  type FillEvent,
  type FillPlan,
} from '../core/fillEngine';
import { loadPassengers, loadTrips, type Trip } from '../vaultStore';
import type { Nav } from '../App';

const IRCTC_URL = 'https://www.irctc.co.in';

// Stock mobile-Chrome UA — a default WebView UA is a bot-fingerprint risk
// (docs/IRCTC_RULES.md §5). Verify against live IRCTC on a real device.
const STOCK_CHROME_MOBILE_UA =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36';

// ---------------------------------------------------------------------------
// G5 — THE single permitted booking-submit call site in the native app.
// It only invokes window.__tatkalUserConfirm(), which exists solely inside
// the user-tap gate in the injected fill script (see fillEngine.ts).
// Nothing else in this codebase may reference CONFIRM_FN_NAME.
// Grep to audit: __tatkalUserConfirm
// ---------------------------------------------------------------------------

// Payment-app intents (upi://, phonepe://, …) open in the user's OWN app —
// the user pays there, by hand. The copilot never touches money.
const PAYMENT_INTENT_RE = /^(upi|phonepe|tez|paytmmp|bhim):/i;
const USER_CONFIRM_JS = `window.${CONFIRM_FN_NAME}();true;`;

type FillState = 'idle' | 'filling' | 'done';

export default function BookingScreen({ nav, tripId }: { nav: Nav; tripId: string }) {
  const webRef = useRef<WebViewInstance | null>(null);
  const [trip, setTrip] = useState<Trip | null>(null);
  const [fillState, setFillState] = useState<FillState>('idle');
  const [events, setEvents] = useState<FillEvent[]>([]);
  const [otpRequired, setOtpRequired] = useState(false);
  const [otpDigits, setOtpDigits] = useState<string[]>(['', '', '', '', '', '']);
  const [blockedUrl, setBlockedUrl] = useState<string | null>(null);
  const [paymentHandoff, setPaymentHandoff] = useState(false);
  const [paymentHandoffError, setPaymentHandoffError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const otpRefs = useRef<Array<TextInput | null>>([]);

  useEffect(() => {
    void loadTrips().then((ts) => setTrip(ts.find((t) => t.id === tripId) ?? null));
  }, [tripId]);

  const pushEvent = useCallback((e: FillEvent) => {
    setEvents((prev) => [...prev.slice(-29), e]);
    if (e.type === 'OTP_REQUIRED') setOtpRequired(true);
    if (e.type === 'FILL_STARTED') setFillState('filling');
    if (e.type === 'FILL_COMPLETE') setFillState('done');
  }, []);

  const onMessage = useCallback(
    (ev: WebViewMessageEvent) => {
      try {
        const e = JSON.parse(ev.nativeEvent.data) as FillEvent;
        if (e && typeof e.type === 'string') pushEvent(e);
      } catch {
        /* non-engine messages ignored */
      }
    },
    [pushEvent],
  );

  const onShouldStartLoadWithRequest = useCallback((req: ShouldStartLoadRequest) => {
    const url = req.url;
    // A UPI/wallet payment intent: hand it to the user's own app so they can
    // pay there themselves, then come back. Returning false stops the WebView
    // from trying to load it (it can't — these aren't web pages).
    if (PAYMENT_INTENT_RE.test(url)) {
      setPaymentHandoff(true);
      setPaymentHandoffError(null);
      void Linking.openURL(url).catch(() => setPaymentHandoffError(url));
      return false;
    }
    const ok = isAllowedUrl(url);
    if (!ok) setBlockedUrl(url);
    return ok; // G9: only irctc.co.in loads in the WebView
  }, []);

  const buildPlan = useCallback(async (): Promise<FillPlan | null> => {
    if (!trip) return null;
    const all = await loadPassengers();
    const pax = trip.passengerIds
      .map((id) => all.find((p) => p.id === id))
      .filter((p): p is NonNullable<typeof p> => !!p);
    if (pax.length === 0) return null;
    return {
      trainNo: trip.trainNo,
      from: trip.from,
      to: trip.to,
      dateISO: trip.journeyDate,
      classCode: trip.classCode,
      quota: 'TATKAL',
      autoUpgradation: true, // "Consider for auto upgradation" stays ticked
      passengers: pax.map((p) => ({
        name: p.name,
        age: p.age,
        gender: p.gender,
        berthPref: p.berthPref,
      })),
    };
  }, [trip]);

  // Explicit user tap ONLY — there is no timer, no auto-fire path.
  const onFillTap = useCallback(async () => {
    if (fillState !== 'idle') return;
    const plan = await buildPlan();
    if (!plan) return;
    webRef.current?.injectJavaScript(buildFillScript(plan));
  }, [fillState, buildPlan]);

  const onOtpDigit = (i: number, text: string) => {
    const ch = text.replace(/\D/g, '').slice(-1);
    setOtpDigits((d) => {
      const next = [...d];
      next[i] = ch;
      return next;
    });
    if (ch && i < 5) otpRefs.current[i + 1]?.focus();
  };

  // OTP_AUTO_HOOK — the Android SMS User Consent native module plugs in HERE.
  // v1 is manual entry (boxes below). When the native module lands, it will
  // call setOtpDigits(parsedCode.split('')) after the system's one-tap
  // consent dialog — no RECEIVE_SMS/READ_SMS permission needed (see
  // docs/IRCTC_RULES.md §5). Nothing here auto-submits: the user still taps
  // "Review & Book on IRCTC" after verifying the OTP on the page.
  const onPlaceOtp = useCallback(() => {
    const code = otpDigits.join('');
    if (code.length !== 6) return;
    const js = `(function(){var el=document.getElementById('otpInput');if(el){try{el.focus();}catch(e){}el.value=${JSON.stringify(
      code,
    )};el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));}true;})();`;
    webRef.current?.injectJavaScript(js);
    setOtpRequired(false);
  }, [otpDigits]);

  // G5 call site — explicit user tap, after the user has reviewed the filled
  // form and completed the Aadhaar OTP step themselves.
  const onUserConfirmTap = useCallback(() => {
    webRef.current?.injectJavaScript(USER_CONFIRM_JS);
  }, []);

  const otpComplete = otpDigits.every((d) => d !== '');

  return (
    <View style={styles.root}>
      <View style={styles.webWrap}>
        <WebView
          ref={webRef}
          source={{ uri: IRCTC_URL }}
          userAgent={STOCK_CHROME_MOBILE_UA}
          javaScriptEnabled
          domStorageEnabled
          onMessage={onMessage}
          onShouldStartLoadWithRequest={onShouldStartLoadWithRequest}
          onError={(e: WebViewErrorEvent) => setLoadError(e.nativeEvent.description)}
          startInLoadingState
        />
      </View>

      {loadError && <Text style={styles.error}>IRCTC failed to load: {loadError}</Text>}
      {paymentHandoff && (
        <Text style={styles.payNote}>
          💳 Payment opened in your UPI app — complete it there yourself,
          then check your PNR on IRCTC. The copilot never touches your money.
        </Text>
      )}
      {paymentHandoffError && (
        <Text style={styles.warn}>
          Couldn't open your UPI app for the payment. Complete the payment
          manually — your booking is waiting on IRCTC's page.
        </Text>
      )}
      {blockedUrl && (
        <Text style={styles.warn}>
          Blocked non-IRCTC navigation (G9): {blockedUrl.slice(0, 80)}{'\n'}
          If this was a PAYMENT page, note its exact address and tell the
          developer — payment hosts are only added after a manual review.
        </Text>
      )}

      <ScrollView style={styles.panel} contentContainerStyle={styles.panelInner}>
        <Text style={styles.hint}>
          1. Pick your class on IRCTC's train list, then tap "Fill my form"
          on the passenger page — details fill at human pace, then stop.
          {'\n'}2. "Consider for auto upgradation" is ticked for you —
          leave it checked.
          {'\n'}3. Type the Aadhaar OTP yourself, review everything, then
          tap "Review & Book on IRCTC".
          {'\n'}4. At payment, choose UPI → your UPI app (e.g. PhonePe):
          the payment opens in YOUR app and you pay there — the copilot
          hands the payment to you at that screen.
        </Text>

        <TouchableOpacity
          style={[styles.fill, fillState !== 'idle' && styles.disabled]}
          disabled={fillState !== 'idle'}
          onPress={onFillTap}
        >
          <Text style={styles.fillText}>
            {fillState === 'idle'
              ? '⚡ Fill my form'
              : fillState === 'filling'
                ? 'Filling… watch the page'
                : '✓ Form filled'}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.confirm, fillState !== 'done' && styles.disabled]}
          disabled={fillState !== 'done'}
          onPress={onUserConfirmTap}
        >
          <Text style={styles.confirmText}>Review & Book on IRCTC</Text>
        </TouchableOpacity>
        <Text style={styles.confirmNote}>
          This taps IRCTC's own Book button for you — nothing books until you
          tap this.
        </Text>
        <Text style={styles.railOneNote}>
          Second lane: the official RailOne app books the same Tatkal quota
          (same IRCTC backend). Its pre-loaded wallet can pay faster than
          UPI/bank redirects at 10:00.
        </Text>

        {events.length > 0 && (
          <View style={styles.log}>
            <Text style={styles.logTitle}>Fill log</Text>
            {events.map((e, i) => (
              <Text key={i} style={styles.logLine}>
                {e.type}
                {e.data && (e.data as { label?: string }).label
                  ? ` · ${(e.data as { label?: string }).label}`
                  : ''}
              </Text>
            ))}
          </View>
        )}

        <TouchableOpacity style={styles.back} onPress={nav.back}>
          <Text style={styles.backText}>← Back to countdown</Text>
        </TouchableOpacity>
      </ScrollView>

      {otpRequired && (
        <View style={styles.overlay}>
          <View style={styles.otpCard}>
            <Text style={styles.otpTitle}>Aadhaar OTP required</Text>
            <Text style={styles.otpSub}>
              IRCTC sent a 6-digit OTP to your Aadhaar-linked mobile. Type it
              here and we'll place it on the page for you.
            </Text>
            <View style={styles.otpRow}>
              {otpDigits.map((d, i) => (
                <TextInput
                  key={i}
                  ref={(r) => {
                    otpRefs.current[i] = r;
                  }}
                  style={styles.otpBox}
                  keyboardType="numeric"
                  maxLength={1}
                  value={d}
                  onChangeText={(t) => onOtpDigit(i, t)}
                />
              ))}
            </View>
            <TouchableOpacity
              style={[styles.primary, !otpComplete && styles.disabled]}
              disabled={!otpComplete}
              onPress={onPlaceOtp}
            >
              <Text style={styles.primaryText}>Place OTP on the page</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setOtpRequired(false)}>
              <Text style={styles.backText}>I'll type it on the page myself</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  webWrap: { flex: 1.2, backgroundColor: '#fff' },
  panel: { flex: 1, backgroundColor: C.bg },
  panelInner: { padding: 14, paddingBottom: 30 },
  hint: { color: C.muted, fontSize: 13, lineHeight: 19, marginBottom: 10 },
  fill: {
    backgroundColor: C.lime, borderRadius: 10, padding: 14, alignItems: 'center',
  },
  fillText: { color: C.bg, fontSize: 16, fontWeight: '800' },
  confirm: {
    borderColor: C.lime, borderWidth: 2, borderRadius: 10,
    padding: 14, alignItems: 'center', marginTop: 10,
  },
  confirmText: { color: C.lime, fontSize: 16, fontWeight: '800' },
  confirmNote: { color: C.muted, fontSize: 12, textAlign: 'center', marginTop: 6 },
  payNote: {
    color: C.lime, fontSize: 12, fontWeight: '700',
    paddingHorizontal: 14, paddingTop: 6, lineHeight: 17,
  },
  railOneNote: {
    color: C.muted, fontSize: 12, textAlign: 'center', marginTop: 8,
    borderColor: C.line, borderWidth: 1, borderRadius: 8, padding: 8, lineHeight: 17,
  },
  disabled: { opacity: 0.4 },
  error: { color: C.danger, fontSize: 12, paddingHorizontal: 14, paddingTop: 6 },
  warn: { color: C.danger, fontSize: 11, paddingHorizontal: 14, paddingTop: 4 },
  log: {
    marginTop: 12, backgroundColor: C.card, borderColor: C.line,
    borderWidth: 1, borderRadius: 8, padding: 10,
  },
  logTitle: { color: C.ink, fontSize: 12, fontWeight: '700', marginBottom: 4 },
  logLine: { color: C.muted, fontSize: 11, fontFamily: 'monospace' },
  back: { alignItems: 'center', padding: 12 },
  backText: { color: C.ink, fontSize: 13, fontWeight: '600', textAlign: 'center' },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.75)',
    justifyContent: 'center',
    padding: 24,
  },
  otpCard: {
    backgroundColor: C.card, borderColor: C.line, borderWidth: 1,
    borderRadius: 14, padding: 18,
  },
  otpTitle: { color: C.lime, fontSize: 18, fontWeight: '800', marginBottom: 6 },
  otpSub: { color: C.muted, fontSize: 13, lineHeight: 18, marginBottom: 12 },
  otpRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 14 },
  otpBox: {
    width: 44, height: 52, backgroundColor: C.bg, color: C.ink,
    borderColor: C.line, borderWidth: 1, borderRadius: 8,
    textAlign: 'center', fontSize: 22, fontWeight: '700',
  },
  primary: {
    backgroundColor: C.lime, borderRadius: 10, padding: 13, alignItems: 'center',
  },
  primaryText: { color: C.bg, fontSize: 15, fontWeight: '800' },
});
