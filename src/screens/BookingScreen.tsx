/**
 * Booking — the core screen (gates G2/G4/G5/G9 live here).
 *
 * - A native WebView loads https://www.irctc.co.in as a TOP-LEVEL document
 *   (never iframed) with a stock mobile-Chrome user agent.
 *   FIELD REPORT 2026-09-26: IRCTC's Akamai bot protection 403s the WebView
 *   anyway (stock UA is NOT enough — the WebView is fingerprinted beyond
 *   its UA string). The app does NOT try to evade this: on denial it shows
 *   a "Continue in Chrome" fallback (expo-web-browser Custom Tab — genuine
 *   Chrome identity, shared login). docs/IRCTC_RULES.md §5 updated.
 * - "Fill my form" first injects a probe (buildFormProbeScript): the fill
 *   only runs when the passenger-details page is actually open, otherwise
 *   the user gets guidance instead of a silent no-op.
 * - G9: onShouldStartLoadWithRequest enforces the irctc.co.in allowlist
 *   (src/core/privacy.ts). Payment-app intents (upi://, phonepe://, …) are NOT
 *   loaded in the WebView — they open in the user's own app so the user pays
 *   there by hand; https payment-gateway pages stay blocked until explicitly
 *   reviewed in — see privacy.ts note.
 * - The fill script (src/core/fillEngine.ts) fires ONLY on the explicit
 *   "Fill my form" tap, paced by the engine (G2). It fills passengers and
 *   sets "Consider for auto upgradation" only when the trip asks for it.
 *   The engine never submits.
 * - G4: when the engine emits OTP_REQUIRED, the native OTP overlay appears.
 *   OTP entry is manual in v1; the SMS User Consent native module plugs in
 *   at the marked OTP_AUTO_HOOK later.
 * - G5: there is NO booking-submit path in the product. The injected fill
 *   script contains zero submit capability (scanForAutobookViolations
 *   asserts this), and no code in this file clicks any of IRCTC's buttons.
 *   After the form fills, the user reviews it and taps IRCTC's own
 *   Continue / Book / Pay buttons themselves, by hand.
 *
 * EXTENDED 2026-09-27 (explicit user instruction — their own IRCTC
 * account): after the pre-booking stage the user can tap "🔎 Find train &
 * continue", which runs the post-search engine (taps Search Trains, picks
 * the train/class/date, taps Book Now, taps Yes on IRCTC's station-mismatch
 * confirmation) and then auto-chains the fill engine, the review engine
 * (Skip card option, payment mode per the trip, taps the review page's
 * Continue) and the payment engine (Review Journey Continue, payment
 * method + provider per the trip, taps Pay & Book). It STOPS at the payment
 * gateway — the user pays by hand in their own UPI/bank app. CAPTCHA/OTP
 * always halt for manual work; the engines never solve them, never enter
 * payment details, never submit a form (the engine safety scanners assert
 * this).
 *
 * DEVICE-TEST ITEMS (not verifiable here): the engine's label-based locators
 * (placeholder / visible-label / attribute text) are validated against the
 * realistic mock harness only — they must be confirmed against IRCTC's live
 * DOM on a real device before any real 10:00 attempt.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  BackHandler,
  Linking,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import WebView, { type WebViewInstance } from '../webview';
import type { WebViewMessageEvent } from 'react-native-webview';
// Type-only deep imports: erased at compile time, so Metro never resolves them.
// (v13's root index only re-exports WebViewMessageEvent among the event types.)
import type {
  ShouldStartLoadRequest,
  WebViewErrorEvent,
  WebViewHttpErrorEvent,
} from 'react-native-webview/lib/WebViewTypes';
import { C } from '../theme';
import { isAllowedUrl } from '../core/privacy';
import {
  buildFillScript,
  buildFormProbeScript,
  type FillEvent,
  type FillPlan,
} from '../core/fillEngine';
import {
  buildPostSearchScript,
  normalizeClassCode,
  toDateCard,
  type PostSearchPlan,
} from '../core/postSearchEngine';
import { buildReviewScript, type ReviewPaymentMode, type ReviewPlan } from '../core/reviewEngine';
import {
  buildPaymentScript,
  type PaymentMethodChoice,
  type PaymentPlan,
  type PaymentProviderChoice,
} from '../core/paymentEngine';
import {
  buildPrebookScript,
  toDMY,
  type PrebookEvent,
  type PrebookPlan,
} from '../core/prebookEngine';
import {
  loadIrctcCredentials,
  loadPassengers,
  loadPrefs,
  loadTrips,
  type Trip,
} from '../vaultStore';
import { STATIONS } from '../data/stations';
import type { Nav } from '../App';

const IRCTC_URL = 'https://www.irctc.co.in';

// Stock mobile-Chrome UA — a default WebView UA is a bot-fingerprint risk
// (docs/IRCTC_RULES.md §5). Verify against live IRCTC on a real device.
const STOCK_CHROME_MOBILE_UA =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36';

// ---------------------------------------------------------------------------
// NO auto-submit, anywhere. The injected scripts contain zero submit
// capability (scanForAutobookViolations / scanPostSearchForViolations /
// scanReviewForViolations assert this). The ONLY IRCTC buttons the app ever
// clicks are the ones the user explicitly authorized on 2026-09-27 for
// their own booking: Search Trains, class/date tabs, Book Now, the
// station-mismatch "Yes", and the review page's Continue. Payment — the
// actual money step — is always the user's own hand on their own app.
// ---------------------------------------------------------------------------

// Payment-app intents (upi://, phonepe://, …) open in the user's OWN app —
// the user pays there, by hand. The copilot never touches money.
const PAYMENT_INTENT_RE = /^(upi|phonepe|tez|paytmmp|bhim):/i;

type FillState = 'idle' | 'filling' | 'done';

export default function BookingScreen({ nav, tripId }: { nav: Nav; tripId: string }) {
  const webRef = useRef<WebViewInstance | null>(null);
  const [trip, setTrip] = useState<Trip | null>(null);
  const [fillState, setFillState] = useState<FillState>('idle');
  const [events, setEvents] = useState<Array<FillEvent | PrebookEvent>>([]);
  const [otpRequired, setOtpRequired] = useState(false);
  const [otpDigits, setOtpDigits] = useState<string[]>(['', '', '', '', '', '']);
  const [blockedUrl, setBlockedUrl] = useState<string | null>(null);
  const [paymentHandoff, setPaymentHandoff] = useState(false);
  const [paymentHandoffError, setPaymentHandoffError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  // IRCTC's bot protection (Akamai) 403s the embedded WebView even with a
  // stock Chrome UA (field report 2026-09-26). When that happens we do NOT
  // try to sneak past it — we offer a real Chrome tab instead.
  const [accessDenied, setAccessDenied] = useState(false);
  const [canGoBack, setCanGoBack] = useState(false);
  // Guidance shown when "Fill my form" is tapped but the passenger page
  // isn't open yet (probe said no-form) — previously a silent no-op.
  const [formNotice, setFormNotice] = useState<string | null>(null);
  // Pre-booking flow state (steps 1–4: language → login → search form).
  const [prebookState, setPrebookState] = useState<'idle' | 'running' | 'done'>('idle');
  const [prebookNotice, setPrebookNotice] = useState<string | null>(null);
  const prebookActive = useRef(false);
  // Extended booking flow (user-authorized 2026-09-27): search trains →
  // pick train/class/date → Book Now → Yes on the station-mismatch popup →
  // auto fill → review (Skip card, payment mode) → Continue. Stops at the
  // payment gateway; the user pays by hand. Every stage is idempotent, so
  // re-tapping after a manual CAPTCHA/OTP resumes where it stopped.
  const [flowPhase, setFlowPhase] = useState<
  'idle' | 'searching' | 'filling' | 'reviewing' | 'paying' | 'done'
>('idle');
  const [flowNotice, setFlowNotice] = useState<string | null>(null);
  const flowPhaseRef = useRef(flowPhase);
  flowPhaseRef.current = flowPhase;
  const otpRefs = useRef<Array<TextInput | null>>([]);
  const probeResolver = useRef<((ready: boolean, reason: string) => void) | null>(null);

  useEffect(() => {
    void loadTrips().then((ts) => setTrip(ts.find((t) => t.id === tripId) ?? null));
  }, [tripId]);

  const pushEvent = useCallback((e: FillEvent) => {
    setEvents((prev) => [...prev.slice(-29), e]);
    if (e.type === 'OTP_REQUIRED') setOtpRequired(true);
    if (e.type === 'FILL_STARTED') setFillState('filling');
    if (e.type === 'FILL_COMPLETE') setFillState('done');
  }, []);

  // Pre-booking event routing. The engine never taps Search Trains /
  // Continue / Book — it stops at PREBOOK_DONE and the user takes over.
  const handlePrebookEvent = useCallback((type: string, data: { step?: string; detail?: string }) => {
    switch (type) {
      case 'PREBOOK_STARTED':
        setPrebookState('running');
        break;
      case 'PREBOOK_STEP':
        setEvents((prev) => [
          ...prev.slice(-29),
          { type: 'PREBOOK_STEP', t: Date.now(), data } as PrebookEvent,
        ]);
        break;
      case 'PREBOOK_DONE':
        prebookActive.current = false;
        setPrebookState('done');
        setPrebookNotice(
          'Search details are filled — review them on IRCTC\u2019s page, then tap “🔎 Find train & continue” below.',
        );
        break;
      case 'CAPTCHA_REQUIRED':
        prebookActive.current = false;
        setPrebookState('idle');
        setPrebookNotice(
          'IRCTC is showing a CAPTCHA on the login — solve it and tap SIGN IN yourself, then tap “🚀 Start booking” again to continue with the search form.',
        );
        break;
      case 'LOGIN_FAILED':
        prebookActive.current = false;
        setPrebookState('idle');
        setPrebookNotice(
          'IRCTC didn\u2019t accept that login — check your saved login (Home → “👤 IRCTC account”) and try again.',
        );
        break;
      case 'OTP_REQUIRED':
        prebookActive.current = false;
        setPrebookState('idle');
        setPrebookNotice(
          'IRCTC wants an OTP for this login — type it on their page yourself, then tap “🚀 Start booking” again.',
        );
        break;
      case 'PREBOOK_STEP_MISSING': {
        prebookActive.current = false;
        setPrebookState('idle');
        const dateWhy: Record<string, string> = {
          'no-overlay': 'the calendar never opened',
          'no-title': 'the calendar month could not be read',
          'no-nav': 'the calendar would not turn to your travel month',
          'no-day': 'your date was not tappable in the shown month',
          'no-verify': 'the date did not stick after tapping it',
        };
        const why =
          data.step === 'date' && data.detail
            ? ` (${dateWhy[data.detail] ?? 'something unexpected happened'})`
            : '';
        setPrebookNotice(
          data.step === 'date'
            ? `The app couldn\u2019t tap your travel date in IRCTC\u2019s calendar${why} — pick the date by hand, then tap “🚀 Start booking” again to continue.`
            : `The app couldn\u2019t find “${data.step ?? 'a step'}” on IRCTC\u2019s page — it may have changed. Do that step by hand, then tap “🚀 Start booking” again to continue.`,
        );
        break;
      }
    }
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
      quota: trip.quota ?? 'TATKAL',
      autoUpgradation: trip.autoUpgradation ?? false, // ticked only when the user selected it
      contactMobile: trip.contactMobile ?? '',
      travelInsurance: trip.travelInsurance ?? true,
      passengers: pax.map((p) => ({
        name: p.name,
        age: p.age,
        gender: p.gender,
        berthPref: p.berthPref,
      })),
    };
  }, [trip]);

  // Extended flow events (search → select → fill → review). Returns true
  // when the event is fully consumed here; false lets it fall through to
  // the fill-event log (pushEvent).
  const handleFlowEvent = useCallback(
    (type: string, data: { step?: string; detail?: string }) => {
      const phase = flowPhaseRef.current;
      const logIt = (t: string) =>
        setEvents((prev) => [
          ...prev.slice(-29),
          { type: t, t: Date.now(), data } as FillEvent,
        ]);
      switch (type) {
        case 'SEARCH_STARTED':
          setFlowPhase('searching');
          return true;
        case 'SEARCH_STEP':
        case 'POPUP_YES':
        case 'POPUP_NONE':
        case 'REVIEW_STEP':
          logIt(type);
          return true;
        case 'PASSENGER_PAGE_READY':
          logIt(type);
          if (phase === 'searching') {
            // Auto-chain: the fill engine takes over on the passenger page.
            void buildPlan().then((plan) => {
              if (!plan) {
                setFlowPhase('idle');
                setFlowNotice(
                  'No passengers saved on this trip — add them on the Passengers screen first.',
                );
                return;
              }
              setFlowPhase('filling');
              webRef.current?.injectJavaScript(buildFillScript(plan));
            });
          }
          return true;
        case 'FILL_COMPLETE':
          if (phase === 'filling') {
            // Auto-chain: review (Skip card, payment mode) then Continue.
            const reviewPlan: ReviewPlan = {
              paymentMode: (trip?.paymentMode ?? 'default') as ReviewPaymentMode,
            };
            setFlowPhase('reviewing');
            webRef.current?.injectJavaScript(buildReviewScript(reviewPlan));
          }
          return false; // still log it via pushEvent
        case 'REVIEW_DONE':
          if (phase === 'reviewing') {
            // Auto-chain: payment engine (Review Journey -> Payment Methods
            // -> provider -> Pay & Book), then the user pays by hand.
            const paymentPlan: PaymentPlan = {
              paymentMethod: (trip?.paymentMethod ?? 'default') as PaymentMethodChoice,
              paymentProvider: (trip?.paymentProvider ?? 'default') as PaymentProviderChoice,
            };
            setFlowPhase('paying');
            webRef.current?.injectJavaScript(buildPaymentScript(paymentPlan));
          }
          return true;
        case 'PAYMENT_STARTED':
        case 'PAYMENT_STEP':
          logIt(type);
          return true;
        case 'GATEWAY_REACHED':
          setFlowPhase('done');
          setFlowNotice(
            'You\u2019re at the payment gateway — finish the payment yourself in your UPI / bank app. The app never touches your money.',
          );
          return true;
        case 'SEARCH_STEP_MISSING':
        case 'REVIEW_STEP_MISSING':
        case 'PAYMENT_STEP_MISSING':
          setFlowPhase('idle');
          setFlowNotice(
            `The app couldn\u2019t find “${data.step ?? 'a step'}” on IRCTC\u2019s page — do that step by hand, then tap “🔎 Find train & continue” again to resume.`,
          );
          return true;
        case 'POPUP_UNKNOWN':
          setFlowPhase('idle');
          setFlowNotice(
            'IRCTC showed an unexpected popup — the app left it alone. Read it and answer it yourself, then tap “🔎 Find train & continue” again.',
          );
          return true;
        case 'CAPTCHA_REQUIRED':
        case 'OTP_REQUIRED':
          if (phase === 'searching' || phase === 'reviewing' || phase === 'filling' || phase === 'paying') {
            setFlowPhase('idle');
            if (type === 'CAPTCHA_REQUIRED') {
              setFlowNotice(
                'IRCTC is showing a CAPTCHA — solve it yourself, then tap “🔎 Find train & continue” again to resume.',
              );
            }
            // OTP during filling still shows the OTP overlay via pushEvent
            // (return false below); the flow just stops auto-chaining.
            return type === 'CAPTCHA_REQUIRED';
          }
          return false;
        default:
          return false;
      }
    },
    [buildPlan, trip],
  );

  const onMessage = useCallback(
    (ev: WebViewMessageEvent) => {
      try {
        const e = JSON.parse(ev.nativeEvent.data) as {
          type: string;
          t?: number;
          data?: Record<string, unknown>;
        };
        if (e && typeof e.type === 'string') {
          if (e.type === 'FORM_PROBE_RESULT') {
            const r = probeResolver.current;
            probeResolver.current = null;
            if (r) {
              const d = (e.data ?? {}) as { ready?: boolean; reason?: string };
              r(!!d.ready, typeof d.reason === 'string' ? d.reason : 'error');
            }
            return;
          }
          // Pre-booking flow events (language → login → search form).
          if (
            e.type === 'PREBOOK_STARTED' ||
            e.type === 'PREBOOK_STEP' ||
            e.type === 'PREBOOK_STEP_MISSING' ||
            e.type === 'CAPTCHA_REQUIRED' ||
            e.type === 'LOGIN_FAILED' ||
            e.type === 'PREBOOK_DONE' ||
            (e.type === 'OTP_REQUIRED' && prebookActive.current)
          ) {
            handlePrebookEvent(e.type, (e.data ?? {}) as { step?: string; detail?: string });
            return;
          }
          // Extended flow events (search → select → fill → review).
          if (handleFlowEvent(e.type, (e.data ?? {}) as { step?: string; detail?: string })) {
            return;
          }
          pushEvent(e as FillEvent);
        }
      } catch {
        /* non-engine messages ignored */
      }
    },
    [pushEvent, handlePrebookEvent],
  );

  // Denial detection: Akamai serves its "Access Denied" page with HTTP 403
  // on the original URL. onHttpError may not fire on all Android versions,
  // so we also sniff the document title on every navigation.
  const onHttpError = useCallback((e: WebViewHttpErrorEvent) => {
    if (e.nativeEvent.statusCode === 403) setAccessDenied(true);
  }, []);

  const onNavigationStateChange = useCallback((navState: { canGoBack: boolean; title?: string }) => {
    setCanGoBack(navState.canGoBack);
    if (navState.title && /access denied/i.test(navState.title)) {
      setAccessDenied(true);
    } else if (navState.title) {
      // A real page loaded — clear a stale denial flag on refire.
      setAccessDenied(false);
    }
  }, []);

  // Genuine Chrome tab (Custom Tabs): real browser identity, shared cookies
  // with the user's Chrome — IRCTC serves it fine (verified on-device
  // 2026-09-26). Used ONLY as the fallback when the WebView is blocked.
  const openInChrome = useCallback(() => {
    void WebBrowser.openBrowserAsync(IRCTC_URL).catch(() =>
      Linking.openURL(IRCTC_URL),
    );
  }, []);

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

  // Explicit user tap ONLY — there is no timer, no auto-fire path.
  // First a probe checks the passenger-details page is actually open; if it
  // isn't, we show guidance instead of running a silent no-op fill.
  const onFillTap = useCallback(async () => {
    if (fillState !== 'idle') return;
    setFormNotice(null);
    const plan = await buildPlan();
    if (!plan) return;
    const probeResult = await new Promise<{ ready: boolean; reason: string }>(
      (resolve) => {
        probeResolver.current = (ready, reason) => resolve({ ready, reason });
        webRef.current?.injectJavaScript(buildFormProbeScript());
        // If the page never answers (e.g. still loading), treat as no-form
        // rather than hanging the button forever.
        setTimeout(() => {
          if (probeResolver.current) {
            probeResolver.current = null;
            resolve({ ready: false, reason: 'no-form' });
          }
        }, 3000);
      },
    );
    if (!probeResult.ready) {
      setFormNotice(
        probeResult.reason === 'blocked'
          ? 'IRCTC is blocking the in-app browser right now (Access Denied). Use “Continue in Chrome” above — you can still book there manually.'
          : 'The passenger form isn\u2019t open on this page yet — select your train and class on IRCTC first, then tap “Fill my form” on the passenger-details page.',
      );
      return;
    }
    webRef.current?.injectJavaScript(buildFillScript(plan));
  }, [fillState, buildPlan]);

  // Pre-booking flow: explicit user tap ONLY. Builds the plan from the trip
  // + the saved (encrypted) IRCTC login + language preference, then injects
  // the pre-booking script. Each step is idempotent, so tapping again after
  // a manual CAPTCHA/OTP resumes where the engine stopped.
  const onPrebookTap = useCallback(async () => {
    if (prebookState === 'running') return;
    setPrebookNotice(null);
    if (!trip) return;
    const creds = await loadIrctcCredentials();
    if (!creds) {
      setPrebookNotice(
        'Save your IRCTC login first: Home → “👤 IRCTC account”.',
      );
      return;
    }
    const prefs = await loadPrefs();
    const stationName = (code: string) =>
      STATIONS.find((s) => s.code === code)?.name ?? code;
    const plan: PrebookPlan = {
      language: prefs.language,
      username: creds.username,
      password: creds.password,
      from: { code: trip.from, name: stationName(trip.from) },
      to: { code: trip.to, name: stationName(trip.to) },
      dateDMY: toDMY(trip.journeyDate),
      classCode: trip.classCode,
      quota: trip.quota ?? 'TATKAL',
    };
    prebookActive.current = true;
    webRef.current?.injectJavaScript(buildPrebookScript(plan));
  }, [prebookState, trip]);

  // Extended flow (user-authorized 2026-09-27): explicit user tap ONLY.
  // Taps Search Trains, picks the trip's train/class/date, taps Book Now,
  // taps Yes on IRCTC's station-mismatch confirmation, then auto-chains the
  // fill engine, the review engine (Skip card, payment mode, Continue) and
  // the payment engine (Review Journey -> Payment Methods -> provider ->
  // Pay & Book). Stops at the payment gateway — the user pays by hand.
  // Every stage is idempotent, so re-tapping after a manual CAPTCHA/OTP
  // resumes.
  const onSearchFlowTap = useCallback(() => {
    if (flowPhase === 'searching' || flowPhase === 'filling' || flowPhase === 'reviewing' || flowPhase === 'paying') return;
    setFlowNotice(null);
    if (!trip) return;
    let plan: PostSearchPlan;
    try {
      plan = {
        trainNo: trip.trainNo,
        classCode: normalizeClassCode(trip.classCode),
        dateISO: trip.journeyDate,
        dateCard: toDateCard(trip.journeyDate),
      };
    } catch {
      setFlowNotice('The trip\u2019s journey date looks wrong — check it on the trip setup screen.');
      return;
    }
    webRef.current?.injectJavaScript(buildPostSearchScript(plan));
  }, [flowPhase, trip]);

  // Hardware back: first step back inside the IRCTC page, otherwise let the
  // app-level handler pop the screen (App.tsx). Never exits from here.
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (canGoBack) {
        webRef.current?.goBack();
        return true;
      }
      return false;
    });
    return () => sub.remove();
  }, [canGoBack]);

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
  // docs/IRCTC_RULES.md §5). Nothing here auto-submits: the user still
  // reviews the filled form and taps IRCTC's own Continue button on the
  // page themselves.
  const onPlaceOtp = useCallback(() => {
    const code = otpDigits.join('');
    if (code.length !== 6) return;
    const js = `(function(){var el=document.getElementById('otpInput');if(el){try{el.focus();}catch(e){}el.value=${JSON.stringify(
      code,
    )};el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));}true;})();`;
    webRef.current?.injectJavaScript(js);
    setOtpRequired(false);
  }, [otpDigits]);

  // (Only the user-authorized flow above taps IRCTC's Search/Book/Continue
  // buttons. This file never touches payment, CAPTCHA, or OTP — those are
  // always the user's own hand.)

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
          onNavigationStateChange={onNavigationStateChange}
          onHttpError={onHttpError}
          onError={(e: WebViewErrorEvent) => setLoadError(e.nativeEvent.description)}
          startInLoadingState
        />
      </View>

      {accessDenied && (
        <View style={styles.deniedBox}>
          <Text style={styles.deniedTitle}>IRCTC blocked the in-app browser</Text>
          <Text style={styles.deniedSub}>
            IRCTC's protection (Access Denied) treats the in-app browser as a
            bot — this is their rule and the app won't try to sneak past it.
            Continue in a real Chrome tab: it shares your Chrome login and
            IRCTC serves it normally.
          </Text>
          <TouchableOpacity style={styles.chromeBtn} onPress={openInChrome}>
            <Text style={styles.chromeBtnText}>Continue in Chrome →</Text>
          </TouchableOpacity>
        </View>
      )}
      {formNotice && <Text style={styles.warn}>{formNotice}</Text>}

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
          1. Tap "🚀 Start booking" — the app picks your language, opens the
          login, fills your saved IRCTC login, and fills From / To / Date /
          Class / Quota on the search page. If IRCTC shows a CAPTCHA, you
          solve it by hand.
          {'\n'}2. Tap "🔎 Find train & continue" — the app taps Search
          Trains, picks your train / class / date, taps Book Now, answers
          Yes on IRCTC's station-mismatch popup, fills the passenger form,
          chooses the Skip card option and your payment mode, taps Continue,
          then on the Review Journey page taps Continue again, picks your
          payment method and provider, and taps Pay & Book. It stops at the
          payment gateway.
          {'\n'}3. Pay by hand: complete the payment yourself on the payment
          page / your UPI app — the copilot never touches your money.
          Type the Aadhaar OTP yourself whenever IRCTC asks.
        </Text>

        <TouchableOpacity
          style={[styles.fill, prebookState === 'running' && styles.disabled]}
          disabled={prebookState === 'running'}
          onPress={onPrebookTap}
        >
          <Text style={styles.fillText}>
            {prebookState === 'running'
              ? 'Booking… watch the page'
              : prebookState === 'done'
                ? '✓ Search filled — review it above'
                : '🚀 Start booking'}
          </Text>
        </TouchableOpacity>

        {prebookNotice && <Text style={styles.warn}>{prebookNotice}</Text>}

        <TouchableOpacity
          style={[
            styles.fill,
            styles.flowBtn,
            (flowPhase === 'searching' ||
              flowPhase === 'filling' ||
              flowPhase === 'reviewing' ||
              flowPhase === 'paying') &&
              styles.disabled,
          ]}
          disabled={
            flowPhase === 'searching' ||
            flowPhase === 'filling' ||
            flowPhase === 'reviewing' ||
            flowPhase === 'paying'
          }
          onPress={onSearchFlowTap}
        >
          <Text style={styles.fillText}>
            {flowPhase === 'searching'
              ? '🔎 Finding your train… watch the page'
              : flowPhase === 'filling'
                ? 'Filling… watch the page'
                : flowPhase === 'reviewing'
                  ? 'Reviewing… watch the page'
                  : flowPhase === 'paying'
                    ? 'Choosing payment… watch the page'
                    : flowPhase === 'done'
                      ? '✓ At payment gateway — pay by hand now'
                      : '🔎 Find train & continue'}
          </Text>
        </TouchableOpacity>

        {flowNotice && <Text style={styles.warn}>{flowNotice}</Text>}

        <TouchableOpacity
          style={[styles.fill, styles.manualFill, fillState !== 'idle' && styles.disabled]}
          disabled={fillState !== 'idle'}
          onPress={onFillTap}
        >
          <Text style={[styles.fillText, styles.manualFillText]}>
            {fillState === 'idle'
              ? '⚡ Fill my form (manual)'
              : fillState === 'filling'
                ? 'Filling… watch the page'
                : '✓ Form filled'}
          </Text>
        </TouchableOpacity>

        <Text style={styles.confirmNote}>
          The flow taps Search Trains, Book Now, the station-mismatch Yes,
          and the review page's Continue for you — and stops at payment.
          CAPTCHA, OTP and the actual payment are always your own hand.
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
  flowBtn: { marginTop: 10 },
  manualFill: { marginTop: 10, backgroundColor: C.card, borderColor: C.lime, borderWidth: 1 },
  manualFillText: { color: C.lime },
  fillText: { color: C.bg, fontSize: 16, fontWeight: '800' },
  confirm: {
    borderColor: C.lime, borderWidth: 2, borderRadius: 10,
    padding: 14, alignItems: 'center', marginTop: 10,
  },
  confirmText: { color: C.lime, fontSize: 16, fontWeight: '800' },
  confirmNote: { color: C.muted, fontSize: 12, textAlign: 'center', marginTop: 6 },
  deniedBox: {
    backgroundColor: C.card, borderColor: C.danger, borderWidth: 1,
    borderRadius: 10, margin: 12, marginBottom: 0, padding: 12,
  },
  deniedTitle: { color: C.danger, fontSize: 14, fontWeight: '800', marginBottom: 4 },
  deniedSub: { color: C.muted, fontSize: 12, lineHeight: 17, marginBottom: 10 },
  chromeBtn: {
    backgroundColor: C.lime, borderRadius: 8, padding: 12, alignItems: 'center',
  },
  chromeBtnText: { color: C.bg, fontSize: 15, fontWeight: '800' },
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
