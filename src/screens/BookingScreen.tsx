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
 * account): after the pre-booking stage the flow continues by itself
 * (zero-tap, user-authorized 2026-10-02): the "🔎 Find train & continue"
 * button remains only as a manual start / retry. It runs the post-search engine (taps Search Trains, picks
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
  Alert,
  BackHandler,
  Linking,
  ScrollView,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import * as SecureStore from 'expo-secure-store';
import WebView, { type WebViewInstance } from '../webview';
import type { WebViewMessageEvent } from 'react-native-webview';
// Type-only deep imports: erased at compile time, so Metro never resolves them.
// (v13's root index only re-exports WebViewMessageEvent among the event types.)
import type {
  ShouldStartLoadRequest,
  WebViewErrorEvent,
  WebViewHttpErrorEvent,
} from 'react-native-webview/lib/WebViewTypes';
import { useTheme } from '../theme';
import {
  AutomationStatus,
  type AutomationStep,
  Card,
  GhostButton,
  Icon,
  InterventionCard,
  PrimaryButton,
  ProgressStepper,
  SecondaryButton,
  ICON_SIZE,
} from '../components/ui';
import { isAllowedUrl, isPaymentHost } from '../core/privacy';
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
import { syncAutofillData, openInChromeApp, isAutomationEnabled, setAutomationEnabled } from '../native/tatkalProbe';
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
  PAYMENT_PROVIDER_LABELS,
  resolveTripPassengers,
  type Trip,
} from '../vaultStore';
import { STATIONS } from '../data/stations';
import type { Nav } from '../App';

const IRCTC_URL = 'https://www.irctc.co.in';
// SecureStore key for the last IRCTC page the booking WebView showed.
const LAST_IRCTC_URL_KEY = 'tatkal.lastIrctcUrl';
// Direct landing page for the Chrome fallback: IRCTC's train-search page,
// so the user skips the homepage and lands where the booking starts.
// (Verified: this is IRCTC's canonical /nget/train-search route.)
const IRCTC_TRAIN_SEARCH_URL = 'https://www.irctc.co.in/nget/train-search';

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

// Human-readable names for payment-intent schemes, used in the
// confirmation dialog before the app hands a payment URL to an external app.
const PAYMENT_INTENT_NAMES: Record<string, string> = {
  upi: 'your UPI app',
  phonepe: 'PhonePe',
  tez: 'Google Pay (Tez)',
  paytmmp: 'Paytm',
  bhim: 'BHIM',
};

// Per-injection nonce for engine <-> app message authentication (#40).
// Every injected engine script embeds this seed and echoes it in each
// posted event; onMessage drops events whose seed doesn't match. A fresh
// seed is minted on every injection so a stale or spoofed page script
// can't drive the flow with replayed/forged events.
const mintSeed = () => Math.floor(Math.random() * 1e9);

/** Saved provider key → display name for the gateway notice. */
function providerLabel(key: string): string {
  return (
    (PAYMENT_PROVIDER_LABELS as Record<string, string>)[key] ||
    (key ? key.charAt(0).toUpperCase() + key.slice(1) : 'payment provider')
  );
}

/**
 * The fill engine's internal field labels (pax0.gender, travel-insurance,
 * …) translated into words the user recognizes. Used in the halt notice so
 * it names the exact field instead of "a required field".
 */
function friendlyFillFieldLabel(label: string): string {
  const pax = /^pax(\d+)\.(.+)$/.exec(label);
  if (pax) {
    const who = `passenger ${Number(pax[1]) + 1}`;
    const what: Record<string, string> = {
      name: `${who}'s name`,
      age: `${who}'s age`,
      gender: `${who}'s gender`,
      berth: `${who}'s berth preference`,
      catering: `${who}'s meal choice`,
    };
    return what[pax[2]] ?? `${who}'s ${pax[2]}`;
  }
  const misc: Record<string, string> = {
    'auto-upgradation': 'the auto-upgradation checkbox',
    'contact-mobile': 'the mobile number',
    'travel-insurance': 'the travel insurance option',
  };
  if (misc[label]) return misc[label];
  const add = /^add-passenger-(\d+)$/.exec(label);
  if (add) return `adding passenger ${Number(add[1]) + 1}`;
  return label;
}

type FillState = 'idle' | 'filling' | 'done';

/**
 * Resume probe: asks the WebView which IRCTC page is currently showing, so
 * "Find train & continue" can start the matching engine instead of always
 * restarting from the search form. Answers with RESUME_PROBE_RESULT
 * { page: 'reviewJourney' | 'passenger' | 'search' | 'unknown' }.
 */
import { buildResumeProbeScript, isPaymentEnginePage } from '../core/resumeProbe';

export default function BookingScreen({ nav, tripId }: { nav: Nav; tripId: string }) {
  const webRef = useRef<WebViewInstance | null>(null);
  const [trip, setTrip] = useState<Trip | null>(null);
  const [fillState, setFillState] = useState<FillState>('idle');
  // Master kill-switch for the tap automation. When OFF, the tap service
  // never starts and a running automation halts immediately.
  const [automationOn, setAutomationOn] = useState(false);
  const [events, setEvents] = useState<Array<FillEvent | PrebookEvent>>([]);
  const [otpRequired, setOtpRequired] = useState(false);
  const [otpDigits, setOtpDigits] = useState<string[]>(['', '', '', '', '', '']);
  const [blockedUrl, setBlockedUrl] = useState<string | null>(null);
  const [paymentHandoff, setPaymentHandoff] = useState(false);
  const [paymentHandoffError, setPaymentHandoffError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  // Last-page restore: the WebView's current IRCTC URL is saved locally on
  // every navigation; reopening the booking screen restores it, so an app
  // restart (e.g. after an OTA update) doesn't lose the user's place in a
  // booking. Only IRCTC allowlist URLs are ever saved — payment gateway
  // URLs (tokens!) and blocked URLs are never persisted or restored.
  const [initialUrl, setInitialUrl] = useState(IRCTC_URL);
  const [urlReady, setUrlReady] = useState(false);
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
  // Zero-tap auto-start (user-authorized 2026-10-02 — "don't want to tap
  // anywhere"): when the pre-booking engine finishes, the search flow
  // starts by itself after a short settle delay. The "🔎 Find train &
  // continue" button stays as a manual start / retry.
  const autoStartTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onSearchFlowTapRef = useRef<() => void>(() => {});
  const otpRefs = useRef<Array<TextInput | null>>([]);
  // Seed handshake (#40): expected seed for the most recently injected
  // engine script, and for the form-probe script (separate slot).
  const flowSeed = useRef(0);
  const probeSeed = useRef(0);
  // Probe resolver slot with generation counter (#19): a second tap must
  // not hijack or prematurely resolve the first tap's probe promise.
  const probeResolver = useRef<{
    gen: number;
    resolve: (r: { ready: boolean; reason: string }) => void;
  } | null>(null);
  const probeGen = useRef(0);
  // Labels of fields the fill engine reported missing during the current
  // fill run — used to name the exact field in the halt notice instead of
  // a generic "a required field".
  const missedLabelsRef = useRef<string[]>([]);
  // Where the flow halted (a *_STEP_MISSING / CAPTCHA / OTP / popup halt sets
  // the phase back to idle): the progress stepper keeps showing the halted
  // step instead of rewinding to Search.
  const haltedPhaseRef = useRef<'idle' | 'searching' | 'filling' | 'reviewing' | 'paying' | 'done' | null>(null);
  // Provider the payment engine skipped because IRCTC didn't offer it (the
  // user picks it by hand at the gateway): named in the gateway notice.
  // Reset whenever a payment run starts.
  const skippedProviderRef = useRef<string | null>(null);
  // G9: payment-gateway hosts (phonepe.com, payu.in, …) are only navigable
  // while the payment flow is active. Set when the payment engine starts or
  // a resume lands on a payment page; cleared when a brand-new booking
  // starts. Never set during search/fill.
  const paymentNavAllowedRef = useRef(false);
  // Resume-probe slot (separate from the form probe): "Find train & continue"
  // first asks the WebView which IRCTC page is showing, then starts the
  // matching engine instead of always restarting from search.
  const resumeProbeSeed = useRef(0);
  const resumeProbeResolver = useRef<((page: string) => void) | null>(null);
  const resumeProbeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    void loadTrips().then((ts) => setTrip(ts.find((t) => t.id === tripId) ?? null));
  }, [tripId]);

  // Load the master automation kill-switch state.
  useEffect(() => {
    void isAutomationEnabled().then(setAutomationOn);
  }, []);

  // Restore the last IRCTC page before the WebView first mounts, so it never
  // flashes the homepage and then jumps.
  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const saved = await SecureStore.getItemAsync(LAST_IRCTC_URL_KEY);
        if (live && saved && isAllowedUrl(saved)) setInitialUrl(saved);
      } catch {
        // Storage unavailable — fall back to the IRCTC homepage.
      }
      if (live) setUrlReady(true);
    })();
    return () => {
      live = false;
    };
  }, []);

  const pushEvent = useCallback((e: FillEvent) => {
    setEvents((prev) => [...prev.slice(-29), e]);
    if (e.type === 'OTP_REQUIRED') setOtpRequired(true);
    if (e.type === 'FILL_STARTED') {
      setFillState('filling');
      missedLabelsRef.current = [];
    }
    if (e.type === 'FIELD_MISSING') {
      const label = (e.data as { label?: unknown } | undefined)?.label;
      if (typeof label === 'string' && label) missedLabelsRef.current.push(label);
    }
    if (e.type === 'FILL_COMPLETE') setFillState('done');
  }, []);

  // Pre-booking event routing. The engine never taps Search Trains /
  // Continue / Book — it stops at PREBOOK_DONE, and the search flow then
  // starts automatically (zero-tap); the button is only a manual retry.
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
      case 'PREBOOK_DONE': {
        prebookActive.current = false;
        setPrebookState('done');
        setPrebookNotice(
          'Search details are filled — the app taps “Search Trains” by itself in a moment. You can still tap “Find train & continue” below to start it right away.',
        );
        // Zero-tap start: kick the search flow automatically once the page
        // settles. onSearchFlowTap is idempotent (busy guard), so a manual
        // tap in the meantime simply wins and this timer becomes a no-op.
        if (autoStartTimer.current) clearTimeout(autoStartTimer.current);
        autoStartTimer.current = setTimeout(() => {
          autoStartTimer.current = null;
          onSearchFlowTapRef.current();
        }, 2000);
        break;
      }
      case 'CAPTCHA_REQUIRED':
        prebookActive.current = false;
        setPrebookState('idle');
        setPrebookNotice(
          'IRCTC is showing a CAPTCHA on the login — solve it and tap SIGN IN yourself, then tap “Start booking” again to continue with the search form.',
        );
        break;
      case 'LOGIN_FAILED':
        prebookActive.current = false;
        setPrebookState('idle');
        setPrebookNotice(
          'IRCTC didn\u2019t accept that login — check your saved login (Home → “IRCTC account”) and try again.',
        );
        break;
      case 'OTP_REQUIRED':
        prebookActive.current = false;
        setPrebookState('idle');
        setPrebookNotice(
          'IRCTC wants an OTP for this login — type it on their page yourself, then tap “Start booking” again.',
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
        const ddDetail: string = data.step === 'dropdown' ? String(data.detail ?? '') : '';
        const ddWhich = ddDetail.indexOf('quota') === 0 ? 'quota' : ddDetail.indexOf('class') === 0 ? 'class' : 'list';
        const ddWhy = ddDetail.indexOf('no-option') >= 0 ? 'pick the option in'
          : ddDetail.indexOf('no-stick') >= 0 ? 'set' : 'find';
        setPrebookNotice(
          data.step === 'date'
            ? `The app couldn\u2019t tap your travel date in IRCTC\u2019s calendar${why} — pick the date by hand, then tap “Start booking” again to continue.`
            : data.step === 'dropdown'
              ? `The app couldn\u2019t ${ddWhy} the ${ddWhich} dropdown on IRCTC\u2019s page — set it by hand, then tap “Start booking” again to continue.`
              : `The app couldn\u2019t find “${data.step ?? 'a step'}” on IRCTC\u2019s page — it may have changed. Do that step by hand, then tap “Start booking” again to continue.`,
        );
        break;
      }
    }
  }, []);

  const buildPlan = useCallback(async (): Promise<FillPlan | null> => {
    if (!trip) return null;
    const all = await loadPassengers();
    // Linked passengers first; otherwise every saved passenger (cap 4) so a
    // traveller saved once works on every trip without re-linking.
    const pax = resolveTripPassengers(trip, all);
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
        mealPref: p.mealPref,
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
                haltedPhaseRef.current = phase;
                setFlowPhase('idle');
                setFlowNotice(
                  'No passengers saved yet — add them on the Passengers screen first.',
                );
                return;
              }
              setFlowPhase('filling');
              const fillSeed = mintSeed();
              flowSeed.current = fillSeed;
              webRef.current?.injectJavaScript(buildFillScript(plan, { seed: fillSeed }));
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
            const reviewSeed = mintSeed();
            flowSeed.current = reviewSeed;
            webRef.current?.injectJavaScript(buildReviewScript(reviewPlan, { seed: reviewSeed }));
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
            skippedProviderRef.current = null;
            const paySeed = mintSeed();
            flowSeed.current = paySeed;
            webRef.current?.injectJavaScript(buildPaymentScript(paymentPlan, { seed: paySeed }));
          }
          return true;
        case 'PAYMENT_STARTED':
          // The payment engine is running: IRCTC may now hand off to a PSP
          // gateway (phonepe.com, payu.in, …) after "Pay & Book". Allow those
          // hosts from here on — the user pays by hand on the gateway page.
          paymentNavAllowedRef.current = true;
          logIt(type);
          return true;
        case 'PAYMENT_STEP': {
          const d = data as { step?: string; skipped?: boolean; wanted?: string };
          if (d.step === 'payProvider' && d.skipped) {
            skippedProviderRef.current = typeof d.wanted === 'string' && d.wanted ? d.wanted : '';
          }
          logIt(type);
          return true;
        }
        case 'GATEWAY_REACHED':
          setFlowPhase('done');
          setFlowNotice(
            skippedProviderRef.current !== null
              ? `You\u2019re at the payment gateway \u2014 finish the payment yourself in your UPI / bank app. Your ${providerLabel(skippedProviderRef.current)} choice wasn\u2019t on IRCTC\u2019s list, so pick the payment option by hand. The app never touches your money.`
              : 'You\u2019re at the payment gateway \u2014 finish the payment yourself in your UPI / bank app. The app never touches your money.',
          );
          skippedProviderRef.current = null;
          return true;
        case 'FILL_HALTED_MISSING': {
          // The fill engine refused to continue with a missing required
          // field instead of silently chaining to review/payment. Halt the
          // flow and name the exact field(s) so the user can fill them by
          // hand — the engine logs FIELD_MISSING with its internal labels.
          haltedPhaseRef.current = phase;
          setFlowPhase('idle');
          const d = data as { label?: string; field?: string; detail?: string };
          const seen = missedLabelsRef.current.filter(
            (l, i, a) => a.indexOf(l) === i,
          ).slice(0, 3);
          const missing =
            seen.length > 0
              ? seen.map(friendlyFillFieldLabel).join(', ')
              : (d.label ?? d.field ?? d.detail ?? 'a required field');
          setFlowNotice(
            `The app couldn't fill ${missing} on IRCTC's page — fill it by hand, then tap "Find train & continue" again to resume.`,
          );
          return true;
        }
        case 'SEARCH_STEP_MISSING':
        case 'REVIEW_STEP_MISSING':
        case 'PAYMENT_STEP_MISSING': {
          haltedPhaseRef.current = phase;
          setFlowPhase('idle');
          const stepName: Record<string, string> = {
            tapSearch: 'the Search Trains button',
            waitList: 'the train list',
            selectTrain: 'your train in the results',
            bookNow: 'the Book Now button',
            waitPax: 'the passenger-details page',
            skipCard: 'the Skip option',
            reviewContinue: 'the Continue button on the review page',
            reviewJourney: 'the Review Journey section',
            continueTap: 'the Continue button',
            payMethods: 'the payment methods',
            payMethod: 'your payment method',
            payProvider: 'your payment provider',
            payContinue: 'the Continue button before payment',
            payBook: 'the Pay & Book button',
            payment: 'the payment section',
            providers: 'the payment providers',
          };
          const what = stepName[data.step ?? ''] ?? 'that step';
          const why = data.detail ? ` (${data.detail})` : '';
          // bookNow halts with a "stayed disabled" detail when the button
          // was found but never activated (the availability tap didn't
          // register) — phrase it as enabling, not finding.
          const bookNowDisabled =
            data.step === 'bookNow' &&
            typeof data.detail === 'string' &&
            data.detail.indexOf('stayed disabled') >= 0;
          setFlowNotice(
            bookNowDisabled
              ? `The app couldn\u2019t switch on ${what} on IRCTC\u2019s page${why} — tap the availability option for your date yourself, then tap “Find train & continue” again to resume.`
              : `The app couldn\u2019t find ${what} on IRCTC\u2019s page${why} — do that step by hand, then tap “Find train & continue” again to resume.`,
          );
          return true;
        }
        case 'POPUP_UNKNOWN':
          haltedPhaseRef.current = phase;
          setFlowPhase('idle');
          setFlowNotice(
            'IRCTC showed an unexpected popup — the app left it alone. Read it and answer it yourself, then tap “Find train & continue” again.',
          );
          return true;
        case 'CAPTCHA_REQUIRED':
        case 'OTP_REQUIRED':
          if (phase === 'searching' || phase === 'reviewing' || phase === 'filling' || phase === 'paying') {
            haltedPhaseRef.current = phase;
            setFlowPhase('idle');
            if (type === 'CAPTCHA_REQUIRED') {
              setFlowNotice(
                'IRCTC is showing a CAPTCHA — solve it yourself, then tap “Find train & continue” again to resume.',
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

  // The WebView's onMessage keeps a stable identity (its dep array never
  // changes), so engine events must reach the LATEST handleFlowEvent through
  // a ref. Without this, the first-render closure — where trip is still
  // null — would answer every event forever, and the passenger plan could
  // never build no matter how many passengers are saved. Same pattern as
  // onSearchFlowTapRef below.
  const handleFlowEventRef = useRef<
    (type: string, data: { step?: string; detail?: string }) => boolean
  >(() => false);
  handleFlowEventRef.current = handleFlowEvent;

  // A dropped message is still evidence: log it into the fill log so a
  // rejected (spoofed or stale) event is visible instead of silent.
  const logSeedReject = useCallback((type: string) => {
    setEvents((prev) => [
      ...prev.slice(-29),
      { type: 'SEED_REJECTED', t: Date.now(), data: { label: type } } as unknown as FillEvent,
    ]);
  }, []);

  const onMessage = useCallback(
    (ev: WebViewMessageEvent) => {
      try {
        const e = JSON.parse(ev.nativeEvent.data) as {
          type: string;
          t?: number;
          seed?: number;
          data?: Record<string, unknown>;
        };
        if (e && typeof e.type === 'string') {
          if (e.type === 'FORM_PROBE_RESULT') {
            // Probe results are authenticated against the probe slot's
            // seed; anything else is a page script trying to fake one.
            if (e.seed !== probeSeed.current) {
              logSeedReject(e.type);
              probeResolver.current = null;
              return;
            }
            const slot = probeResolver.current;
            probeResolver.current = null;
            if (slot) {
              const d = (e.data ?? {}) as { ready?: boolean; reason?: string };
              slot.resolve({ ready: !!d.ready, reason: typeof d.reason === 'string' ? d.reason : 'error' });
            }
            return;
          }
          if (e.type === 'RESUME_PROBE_RESULT') {
            // Resume-probe answer: which IRCTC page is showing. Authenticated
            // against the resume-probe slot's seed, like the form probe.
            if (e.seed !== resumeProbeSeed.current) {
              logSeedReject(e.type);
              resumeProbeResolver.current = null;
              return;
            }
            if (resumeProbeTimer.current) {
              clearTimeout(resumeProbeTimer.current);
              resumeProbeTimer.current = null;
            }
            const slot = resumeProbeResolver.current;
            resumeProbeResolver.current = null;
            if (slot) {
              const d = (e.data ?? {}) as { page?: string };
              slot(typeof d.page === 'string' ? d.page : 'unknown');
            }
            return;
          }
          if (e.type === 'OTP_PLACED' || e.type === 'OTP_PLACE_FAILED') {
            if (e.seed !== flowSeed.current) {
              logSeedReject(e.type);
              return;
            }
            // #42: the code leaves React state as soon as it is confirmed
            // placed (or failed) — it never lingers in memory.
            setOtpDigits(['', '', '', '', '', '']);
            setOtpRequired(false);
            if (e.type === 'OTP_PLACE_FAILED') {
              setFlowNotice(
                "The app couldn't find the OTP box on IRCTC's page — type the OTP on their page yourself.",
              );
            }
            return;
          }
          // #40: every engine event must echo the seed of the most recent
          // injection. Drop (and log) anything with a missing or stale
          // seed — it came from a page script, not from our engine.
          if (typeof e.seed !== 'number' || e.seed !== flowSeed.current) {
            logSeedReject(e.type);
            return;
          }
          // Pre-booking flow events (language → login → search form).
          // CAPTCHA_REQUIRED belongs to the pre-book handler ONLY while a
          // pre-book run is actually in progress (#15); a CAPTCHA during
          // the extended flow must reach handleFlowEvent so the state
          // machine resets to idle with the resume notice.
          if (
            e.type === 'PREBOOK_STARTED' ||
            e.type === 'PREBOOK_STEP' ||
            e.type === 'PREBOOK_STEP_MISSING' ||
            (e.type === 'CAPTCHA_REQUIRED' && prebookActive.current) ||
            e.type === 'LOGIN_FAILED' ||
            e.type === 'PREBOOK_DONE' ||
            (e.type === 'OTP_REQUIRED' && prebookActive.current)
          ) {
            handlePrebookEvent(e.type, (e.data ?? {}) as { step?: string; detail?: string });
            return;
          }
          // Extended flow events (search → select → fill → review).
          if (handleFlowEventRef.current(e.type, (e.data ?? {}) as { step?: string; detail?: string })) {
            return;
          }
          pushEvent(e as FillEvent);
        }
      } catch {
        /* non-engine messages ignored */
      }
    },
    [pushEvent, handlePrebookEvent, logSeedReject],
  );

  // Denial detection: Akamai serves its "Access Denied" page with HTTP 403
  // on the original URL. onHttpError may not fire on all Android versions,
  // so we also sniff the document title on every navigation.
  const onHttpError = useCallback((e: WebViewHttpErrorEvent) => {
    if (e.nativeEvent.statusCode === 403) setAccessDenied(true);
  }, []);

  const onNavigationStateChange = useCallback((navState: { canGoBack: boolean; title?: string; url?: string }) => {
    setCanGoBack(navState.canGoBack);
    // Remember the last IRCTC page so a restart reopens where the user was.
    const navUrl = navState.url ?? '';
    if (navUrl && isAllowedUrl(navUrl)) {
      void SecureStore.setItemAsync(LAST_IRCTC_URL_KEY, navUrl).catch(() => {});
    }
    const title = navState.title ?? '';
    if (/access denied/i.test(title)) {
      setAccessDenied(true);
    } else if (
      // #24: only clear a denial flag on a confirmed real page — a titled
      // navigation that doesn't look like an error/denial page. Clearing
      // on any titled redirect let the banner flap on error chains.
      title.length > 0 &&
      !/access denied|denied|forbidden|blocked|error|not found|404|403/i.test(title)
    ) {
      setAccessDenied(false);
    }
  }, []);

  // Opens IRCTC in the REAL browser app (explicit intent, no chooser),
  // not a Custom Tab and not the WebView. The fill + tap services gate on
  // real-browser packages, so only the full browser app guarantees they
  // engage. Tapping the button IS the permission — no extra confirmation
  // dialog, because every second counts in Tatkal.
  const openInChrome = useCallback(() => {
    void (async () => {
      const where = await openInChromeApp(IRCTC_TRAIN_SEARCH_URL);
      if (!where) {
        setPrebookNotice(
          'Could not open a browser. Please install Chrome from the Play Store, then try again.',
        );
      } else if (where.startsWith('browser:')) {
        // No Chrome installed: automation still runs in the default
        // browser, but IRCTC works best in Chrome.
        setPrebookNotice(
          'Opened in your default browser instead of Chrome. For the smoothest booking, install Chrome from the Play Store.',
        );
      }
    })();
  }, []);

  const onShouldStartLoadWithRequest = useCallback((req: ShouldStartLoadRequest) => {
    const url = req.url;
    // A UPI/wallet payment intent: ask first, then hand it to the user's own
    // app so they can pay there themselves, then come back. Returning false
    // stops the WebView from trying to load it (it can't — these aren't web
    // pages). #44: never auto-open a payment URL the page requested — the
    // user must confirm, because a compromised page could otherwise fire a
    // collect request at them.
    //
    // intent:// URLs (Android) are the other way a PSP gateway hands off to
    // the wallet app (PhonePe's web gateway does this). Only intents that
    // name a payment scheme/package are treated as payment handoffs — any
    // other intent URL falls through to the allowlist and is blocked.
    const isPaymentIntent = (() => {
      if (PAYMENT_INTENT_RE.test(url)) return true;
      if (/^intent:/i.test(url)) {
        const u = url.toLowerCase();
        return (
          u.includes('scheme=upi') ||
          u.includes('scheme=phonepe') ||
          u.includes('scheme=tez') ||
          u.includes('scheme=paytmmp') ||
          u.includes('scheme=bhim') ||
          u.includes('package=com.phonepe.app') ||
          u.includes('package=com.google.android.apps.nbu.paisa.user') ||
          u.includes('package=net.one97.paytm') ||
          u.includes('package=in.org.npci.upiapp') ||
          u.includes('package=com.upi.axispay')
        );
      }
      return false;
    })();
    if (isPaymentIntent) {
      const scheme = url.split(':')[0].toLowerCase();
      // intent:// URLs name the target in scheme=/package= params instead.
      const intentTarget = (() => {
        if (scheme !== 'intent') return null;
        const u = url.toLowerCase();
        if (u.includes('com.phonepe.app')) return 'PhonePe';
        if (u.includes('com.google.android.apps.nbu.paisa.user')) return 'Google Pay (Tez)';
        if (u.includes('net.one97.paytm')) return 'Paytm';
        if (u.includes('in.org.npci.upiapp') || u.includes('com.upi.axispay')) return 'your UPI app';
        return null;
      })();
      const target = intentTarget ?? PAYMENT_INTENT_NAMES[scheme] ?? 'your payment app';
      Alert.alert(
        'Open payment app?',
        `IRCTC's page wants to open ${target} to collect this payment. Nothing is paid automatically — you'll review and approve it yourself inside ${target}.`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Open',
            onPress: () => {
              setPaymentHandoff(true);
              setPaymentHandoffError(null);
              void Linking.openURL(url).catch(() => setPaymentHandoffError(url));
            },
          },
        ],
      );
      return false;
    }
    const ok = isAllowedUrl(url) || (isPaymentHost(url) && paymentNavAllowedRef.current);
    if (!ok) setBlockedUrl(url);
    else if (isPaymentHost(url)) setBlockedUrl(null); // clear any stale block warning
    return ok; // G9: only irctc.co.in loads in the WebView (+ PSP gateways while paying)
  }, []);

  // Explicit user tap ONLY — there is no timer, no auto-fire path.
  // First a probe checks the passenger-details page is actually open; if it
  // isn't, we show guidance instead of running a silent no-op fill.
  const onFillTap = useCallback(async () => {
    if (fillState !== 'idle') return;
    setFormNotice(null);
    const plan = await buildPlan();
    if (!plan) return;
    // #19: the probe slot carries a generation number, so a second tap
    // can't hijack or prematurely resolve the first tap's probe promise.
    const gen = probeGen.current + 1;
    probeGen.current = gen;
    const probeSeedNow = mintSeed();
    probeSeed.current = probeSeedNow;
    const probeResult = await new Promise<{ ready: boolean; reason: string }>(
      (resolve) => {
        probeResolver.current = { gen, resolve };
        webRef.current?.injectJavaScript(buildFormProbeScript(probeSeedNow));
        // If the page never answers (e.g. still loading), treat as no-form
        // rather than hanging the button forever.
        setTimeout(() => {
          const slot = probeResolver.current;
          if (slot && slot.gen === gen) {
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
          : 'The passenger form isn\u2019t open on this page yet — select your train and class on IRCTC first, then tap “Fill my form (manual)” on the passenger-details page.',
      );
      return;
    }
    const fillSeed = mintSeed();
    flowSeed.current = fillSeed;
    webRef.current?.injectJavaScript(buildFillScript(plan, { seed: fillSeed }));
  }, [fillState, buildPlan]);

  // Pre-booking flow: explicit user tap ONLY. Builds the plan from the trip
  // + the saved (encrypted) IRCTC login + language preference, then injects
  // the pre-booking script. Each step is idempotent, so tapping again after
  // a manual CAPTCHA/OTP resumes where the engine stopped.
  const onPrebookTap = useCallback(async () => {
    // #18: prebookState flips to 'running' only when PREBOOK_STARTED comes
    // back from the page — prebookActive is the synchronous guard against a
    // double-tap injecting two login scripts (two SIGN IN taps would burn
    // IRCTC's login-attempt budget).
    if (prebookState === 'running' || prebookActive.current) return;
    setPrebookNotice(null);
    if (!trip) return;
    const creds = await loadIrctcCredentials();
    if (!creds) {
      setPrebookNotice(
        'Save your IRCTC login first: Home → “IRCTC account”.',
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
    haltedPhaseRef.current = null;
    const prebookSeed = mintSeed();
    flowSeed.current = prebookSeed;
    webRef.current?.injectJavaScript(buildPrebookScript(plan, { seed: prebookSeed }));
  }, [prebookState, trip]);

  // Extended flow (user-authorized 2026-09-27): explicit user tap ONLY.
  // Taps Search Trains, picks the trip's train/class/date, taps Book Now,
  // taps Yes on IRCTC's station-mismatch confirmation, then auto-chains the
  // fill engine, the review engine (Skip card, payment mode, Continue) and
  // the payment engine (Review Journey -> Payment Methods -> provider ->
  // Pay & Book). Stops at the payment gateway — the user pays by hand.
  // Every stage is idempotent, so re-tapping after a manual CAPTCHA/OTP
  // resumes.
  const flowBusySince = useRef(0);
  // Asks the WebView which IRCTC page is showing. Resolves 'unknown' if the
  // page never answers (still loading) rather than hanging the button.
  const probeResumePage = useCallback((): Promise<string> => {
    return new Promise((resolve) => {
      const seedNow = mintSeed();
      resumeProbeSeed.current = seedNow;
      resumeProbeResolver.current = resolve;
      webRef.current?.injectJavaScript(buildResumeProbeScript(seedNow));
      resumeProbeTimer.current = setTimeout(() => {
        if (resumeProbeResolver.current) {
          resumeProbeResolver.current = null;
          resolve('unknown');
        }
      }, 4000);
    });
  }, []);
  const onSearchFlowTap = useCallback(async () => {
    const now = Date.now();
    // #17: synchronous double-tap guard. flowPhase only flips to a busy
    // value when SEARCH_STARTED comes back from the WebView (~100–500ms
    // after injection), so two quick taps would both inject a script.
    // Ignore a tap that lands within the settle window of a fresh start.
    if (flowPhaseRef.current === 'idle' && now - flowBusySince.current < 2000) return;
    if (
      flowPhaseRef.current === 'searching' ||
      flowPhaseRef.current === 'filling' ||
      flowPhaseRef.current === 'reviewing' ||
      flowPhaseRef.current === 'paying'
    ) {
      // A tap while genuinely busy is ignored — but a phase stuck with no
      // progress (e.g. the injected script died silently) must not brick
      // the button forever. #16: the button stays ENABLED during busy
      // phases precisely so this stuck-recovery stays reachable. The
      // engines are idempotent, so a fresh tap after 2 idle minutes
      // safely resumes.
      if (now - flowBusySince.current < 120000) return;
      setFlowPhase('idle');
    }
    setFlowNotice(null);
    // A new start clears the halted-step display.
    haltedPhaseRef.current = null;
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
    // #21: the busy timestamp is only meaningful once a flow actually
    // starts — set it after trip/plan validation, not before.
    flowBusySince.current = now;
    // #23: a fresh flow means manual fill is available again.
    setFillState('idle');
    // Page-aware resume: start the engine matching the IRCTC page that's
    // actually showing instead of always restarting from the search form.
    // (A halt on the Review Journey page used to rewind the stepper to
    // Search and run the search script on the wrong page.)
    const page = await probeResumePage();
    // A second tap's probe may have resolved first and started a flow —
    // never inject twice.
    if (flowPhaseRef.current !== 'idle') return;
    if (isPaymentEnginePage(page)) {
      // The payment engine is resume-safe: it skips steps already past,
      // taps the Review Journey Continue, then methods → provider → Pay & Book.
      // This covers resuming from the Review Journey page, the Payment
      // Methods page, and the provider page alike.
      const paymentPlan: PaymentPlan = {
        paymentMethod: (trip?.paymentMethod ?? 'default') as PaymentMethodChoice,
        paymentProvider: (trip?.paymentProvider ?? 'default') as PaymentProviderChoice,
      };
      setFlowPhase('paying');
      paymentNavAllowedRef.current = true; // a PSP handoff may follow
      skippedProviderRef.current = null;
      const paySeed = mintSeed();
      flowSeed.current = paySeed;
      webRef.current?.injectJavaScript(buildPaymentScript(paymentPlan, { seed: paySeed }));
      return;
    }
    if (page === 'passenger') {
      // Re-run the fill (idempotent) — FILL_COMPLETE auto-chains the review.
      const fillPlan = await buildPlan();
      if (!fillPlan) {
        setFlowPhase('idle');
        setFlowNotice('No passengers saved yet — add them on the Passengers screen first.');
        return;
      }
      setFlowPhase('filling');
      const fillSeed = mintSeed();
      flowSeed.current = fillSeed;
      webRef.current?.injectJavaScript(buildFillScript(fillPlan, { seed: fillSeed }));
      return;
    }
    const searchSeed = mintSeed();
    flowSeed.current = searchSeed;
    // A brand-new search flow: PSP gateway navigation is not expected yet.
    paymentNavAllowedRef.current = false;
    webRef.current?.injectJavaScript(buildPostSearchScript(plan, { seed: searchSeed }));
  }, [trip, buildPlan, probeResumePage]);

  // Keep the ref pointing at the latest flow starter (it closes over the
  // current flowPhase/trip). Clear a pending auto-start if we unmount.
  onSearchFlowTapRef.current = onSearchFlowTap;
  useEffect(
    () => () => {
      if (autoStartTimer.current) clearTimeout(autoStartTimer.current);
    },
    [],
  );

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
    // #61: try the known id first, then fall back to any input whose
    // label/placeholder/aria-label/name mentions OTP. Report back so the
    // app knows whether the code actually landed (OTP_PLACED) or the
    // field couldn't be found (OTP_PLACE_FAILED). The seed authenticates
    // the reply like any other engine message.
    const seed = flowSeed.current;
    const js =
      `(function(){var CODE=${JSON.stringify(code)};var SEED=${seed};` +
      `function done(ok){try{if(window.ReactNativeWebView&&window.ReactNativeWebView.postMessage){window.ReactNativeWebView.postMessage(JSON.stringify({type:ok?'OTP_PLACED':'OTP_PLACE_FAILED',t:Math.round(performance.now()),seed:SEED,data:{}}));}}catch(e){}}` +
      `function fill(el){try{el.focus();}catch(e){}try{el.value=CODE;}catch(e){}try{el.dispatchEvent(new Event('input',{bubbles:true}));}catch(e){}try{el.dispatchEvent(new Event('change',{bubbles:true}));}catch(e){}}` +
      `var el=document.getElementById('otpInput');` +
      `if(!el){var inputs=document.querySelectorAll('input');for(var i=0;i<inputs.length;i++){var inp=inputs[i];var hay=((inp.getAttribute('aria-label')||'')+' '+(inp.getAttribute('placeholder')||'')+' '+(inp.name||'')+' '+(inp.id||'')).toLowerCase();if(hay.indexOf('otp')>=0){el=inp;break;}}}` +
      `if(!el){var labs=document.querySelectorAll('label');for(var j=0;j<labs.length;j++){var lt=labs[j].textContent||'';if(lt.toLowerCase().indexOf('otp')>=0){if(labs[j].control){el=labs[j].control;break;}var inner=labs[j].querySelector('input');if(inner){el=inner;break;}}}}` +
      `if(el){fill(el);done(true);}else{done(false);}true;})();`;
    webRef.current?.injectJavaScript(js);
    // The overlay stays open until OTP_PLACED / OTP_PLACE_FAILED confirms
    // the outcome — the user can retry or dismiss it meanwhile.
  }, [otpDigits]);

  // (Only the user-authorized flow above taps IRCTC's Search/Book/Continue
  // buttons. This file never touches payment, CAPTCHA, or OTP — those are
  // always the user's own hand.)

  const otpComplete = otpDigits.every((d) => d !== '');

  const { theme } = useTheme();
  const ty = theme.typography;

  // ---- Presentation-only derivations (read-only mapping over existing state; no new state) ----
  const FLOW_PHASE_INDEX = { idle: 0, searching: 1, filling: 2, reviewing: 3, paying: 4, done: 5 } as const;
  const phaseIdx = FLOW_PHASE_INDEX[flowPhase];
  // When the flow halted mid-way, keep the stepper on the halted step instead
  // of rewinding to Search — the notice already says which step to do by hand.
  const haltedStep =
    haltedPhaseRef.current === 'searching' ? 2
    : haltedPhaseRef.current === 'filling' ? 3
    : haltedPhaseRef.current === 'reviewing' ? 4
    : haltedPhaseRef.current === 'paying' ? 5
    : null;
  const stepperCurrent =
    prebookState === 'running' ? 0
    : flowPhase === 'idle' && haltedStep !== null ? haltedStep
    : prebookState === 'done' && flowPhase === 'idle' ? 1
    : flowPhase === 'searching' ? 2
    : flowPhase === 'filling' ? 3
    : flowPhase === 'reviewing' ? 4
    : flowPhase === 'paying' ? 5
    : flowPhase === 'done' ? 6
    : 0;
  const lastEvent = events.length > 0 ? events[events.length - 1] : null;
  const lastSignal = lastEvent ? `Last signal: ${lastEvent.type}` : undefined;
  const automationSteps: AutomationStep[] = [
    {
      label: 'Log in & fill the search form',
      detail: prebookState === 'running' ? lastSignal : undefined,
      state: prebookState === 'done' ? 'done' : prebookState === 'running' ? 'active' : 'pending',
    },
    {
      label: 'Search trains & pick your train',
      detail: flowPhase === 'searching' ? lastSignal : undefined,
      state: phaseIdx > 1 ? 'done' : phaseIdx === 1 ? 'active' : 'pending',
    },
    {
      label: 'Fill passenger details',
      detail: flowPhase === 'filling' || fillState === 'filling' ? lastSignal : undefined,
      state: phaseIdx > 2 || fillState === 'done' ? 'done' : phaseIdx === 2 || fillState === 'filling' ? 'active' : 'pending',
    },
    {
      label: 'Review & choose payment mode',
      detail: flowPhase === 'reviewing' ? lastSignal : undefined,
      state: phaseIdx > 3 ? 'done' : phaseIdx === 3 ? 'active' : 'pending',
    },
    {
      label: 'Payment steps up to the gateway',
      detail: flowPhase === 'paying' ? lastSignal : undefined,
      state: phaseIdx > 4 ? 'done' : phaseIdx === 4 ? 'active' : 'pending',
    },
    {
      label: 'Pay on IRCTC — your final action',
      state: phaseIdx === 5 ? 'waiting' : 'pending',
    },
  ];

  // Intervention-card routing for the existing notice strings: prefix match
  // on the exact strings the engines already set — derived from existing
  // state only, no new state, no copy changes.
  const flowInterventionKind =
    flowNotice && flowNotice.indexOf('IRCTC is showing a CAPTCHA') === 0 ? 'captcha'
    : flowNotice && flowNotice.indexOf('IRCTC showed an unexpected popup') === 0 ? 'unknown'
    : flowNotice && flowNotice.indexOf('at the payment gateway') >= 0 && flowPhase === 'done' ? 'payment'
    : null;
  const prebookInterventionKind =
    prebookNotice && prebookNotice.indexOf('IRCTC is showing a CAPTCHA on the login') === 0 ? 'captcha'
    : prebookNotice && prebookNotice.indexOf('IRCTC wants an OTP for this login') === 0 ? 'otp'
    : null;

  // Notice text styling only — the message strings are kept exactly as the
  // engines set them (they carry safety meaning).
  const noticeTone = {
    danger: { fg: theme.colors.dangerOnTint, bg: theme.colors.dangerTint, icon: 'alertTriangle' as const },
    warn: { fg: theme.colors.warnOnTint, bg: theme.colors.warnTint, icon: 'alertTriangle' as const },
    info: { fg: theme.colors.infoOnTint, bg: theme.colors.infoTint, icon: 'info' as const },
    success: { fg: theme.colors.successOnTint, bg: theme.colors.successTint, icon: 'check' as const },
  };
  const renderNotice = (msg: string, tone: keyof typeof noticeTone) => {
    const n = noticeTone[tone];
    return (
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'flex-start',
          backgroundColor: n.bg,
          borderRadius: theme.radius.md,
          padding: theme.spacing.md,
        }}
      >
        <Icon name={n.icon} size={ICON_SIZE.xs} color={n.fg} />
        <Text
          style={{
            flex: 1,
            marginLeft: theme.spacing.sm,
            fontSize: ty.bodySm.size,
            lineHeight: ty.bodySm.lineHeight,
            color: n.fg,
          }}
        >
          {msg}
        </Text>
      </View>
    );
  };

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.bg }}>
      <View style={{ flex: 1.15, backgroundColor: '#fff' }}>
        {urlReady ? (
          <WebView
            ref={webRef}
            source={{ uri: initialUrl }}
          userAgent={STOCK_CHROME_MOBILE_UA}
          javaScriptEnabled
          domStorageEnabled
          onMessage={onMessage}
          onShouldStartLoadWithRequest={onShouldStartLoadWithRequest}
          onNavigationStateChange={onNavigationStateChange}
          onHttpError={onHttpError}
          onError={(e: WebViewErrorEvent) => setLoadError(e.nativeEvent.description)}
          startInLoadingState
          allowFileAccess={false} // audit #43: the WebView must not read device files
          allowFileAccessFromFileURLs={false}
          />
        ) : null}
      </View>

      {accessDenied && (
        <View style={{ paddingHorizontal: theme.spacing.lg, paddingTop: theme.spacing.sm }}>
          <InterventionCard
            kind="unknown"
            title="IRCTC blocked the in-app browser"
            message="IRCTC's protection (Access Denied) treats the in-app browser as a bot — this is their rule and the app won't try to sneak past it. Continue in a real Chrome tab: it shares your Chrome login and IRCTC serves it normally."
            primaryLabel="Continue in Chrome"
            onPrimary={openInChrome}
          />
        </View>
      )}
      {formNotice && (
        <View style={{ paddingHorizontal: theme.spacing.lg, paddingTop: theme.spacing.sm }}>
          {renderNotice(formNotice, 'warn')}
        </View>
      )}

      {loadError && (
        <View style={{ paddingHorizontal: theme.spacing.lg, paddingTop: theme.spacing.sm }}>
          {renderNotice(`IRCTC failed to load: ${loadError}`, 'danger')}
        </View>
      )}
      {paymentHandoff && (
        <View style={{ paddingHorizontal: theme.spacing.lg, paddingTop: theme.spacing.sm }}>
          {renderNotice(
            'Payment opened in your UPI app — complete it there yourself, then check your PNR on IRCTC. The copilot never touches your money.',
            'success',
          )}
        </View>
      )}
      {paymentHandoffError && (
        <View style={{ paddingHorizontal: theme.spacing.lg, paddingTop: theme.spacing.sm }}>
          {renderNotice(
            "Couldn't open your UPI app for the payment. Complete the payment manually — your booking is waiting on IRCTC's page.",
            'warn',
          )}
        </View>
      )}
      {blockedUrl && (
        <View style={{ paddingHorizontal: theme.spacing.lg, paddingTop: theme.spacing.sm }}>
          {renderNotice(
            `Blocked non-IRCTC navigation (G9): ${blockedUrl.slice(0, 80)}\nIf this was a PAYMENT page, note its exact address and tell the developer — payment hosts are only added after a manual review.`,
            'warn',
          )}
        </View>
      )}

      <ScrollView
        style={{ flex: 1, backgroundColor: theme.colors.bg }}
        contentContainerStyle={{ padding: theme.spacing.lg, paddingBottom: theme.spacing.xxl }}
      >
        <Card style={{ marginBottom: theme.spacing.md }}>
          <Text
            style={{
              fontSize: ty.h3.size,
              fontWeight: ty.h3.weight,
              lineHeight: ty.h3.lineHeight,
              color: theme.colors.ink,
              marginBottom: theme.spacing.md,
            }}
          >
            Booking progress
          </Text>
          <ProgressStepper
            steps={['Login', 'Search', 'Train', 'Passengers', 'Review', 'Payment', 'Done']}
            current={stepperCurrent}
            accessibilityLabel="Booking progress: login, search, train, passengers, review, payment, done"
          />
        </Card>

        <PrimaryButton
          title={
            prebookState === 'running'
              ? 'Booking… watch the page'
              : prebookState === 'done'
                ? 'Search filled — review it above'
                : 'Start booking'
          }
          icon="ticket"
          fullWidth
          disabled={prebookState === 'running'}
          onPress={onPrebookTap}
        />

        {/* Master kill-switch for the tap automation. When OFF, the tap
            service never starts and a running automation halts immediately.
            A persistent notification with a STOP button also appears while
            automation runs, so it can be killed from anywhere. */}
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginTop: theme.spacing.md,
            paddingVertical: theme.spacing.sm,
            paddingHorizontal: theme.spacing.md,
            borderRadius: 12,
            backgroundColor: automationOn ? theme.colors.surface : '#3B1F1F',
            borderWidth: 1,
            borderColor: automationOn ? theme.colors.line : '#B3261E',
          }}
        >
          <View style={{ flex: 1, marginRight: theme.spacing.sm }}>
            <Text style={[theme.typography.body, { fontWeight: '700' }]}>
              Auto-booking {automationOn ? 'ON' : 'OFF'}
            </Text>
            <Text style={[theme.typography.caption, { color: theme.colors.muted }]}>
              {automationOn
                ? 'The app will fill and tap in Chrome until payment.'
                : 'Automation halted. Turn ON to use auto mode.'}
            </Text>
          </View>
          <Switch
            value={automationOn}
            onValueChange={(v) => {
              setAutomationOn(v);
              void setAutomationEnabled(v);
            }}
          />
        </View>

        {/* Booking automation (native services): syncs the trip data to the
            encrypted native store, then opens IRCTC in real Chrome where the
            fill + tap services take over until the payment page. */}
        <PrimaryButton
          title="Book in Chrome (auto)"
          icon="externalLink"
          fullWidth
          onPress={() => {
            void (async () => {
              if (!automationOn) {
                // Tapping this button IS the go-ahead: switch auto-booking
                // ON (same master switch as the Quick Settings tile).
                await setAutomationEnabled(true);
                setAutomationOn(true);
              }
              const synced = await syncAutofillData(tripId);
              if (!synced) {
                setPrebookNotice(
                  'Could not prepare your booking details (passengers or trip missing). Check your trip and passengers, then try again.',
                );
                return;
              }
              openInChrome();
            })();
          }}
        />

        {prebookNotice && (
          <View style={{ marginTop: theme.spacing.sm }}>
            {prebookInterventionKind ? (
              <InterventionCard
                kind={prebookInterventionKind}
                message={prebookNotice}
                primaryLabel="Got it"
                onPrimary={() => setPrebookNotice(null)}
              />
            ) : (
              renderNotice(prebookNotice, 'warn')
            )}
          </View>
        )}

        <PrimaryButton
          title={
            flowPhase === 'searching'
              ? 'Finding your train… watch the page'
              : flowPhase === 'filling'
                ? 'Filling… watch the page'
                : flowPhase === 'reviewing'
                  ? 'Reviewing… watch the page'
                  : flowPhase === 'paying'
                    ? 'Choosing payment… watch the page'
                    : flowPhase === 'done'
                      ? 'At payment gateway — pay by hand now'
                      : 'Find train & continue'
          }
          icon="search"
          fullWidth
          // #16: the button stays ENABLED during busy phases so the
          // 120s stuck-recovery in onSearchFlowTap is reachable; the
          // busy guard there ignores premature taps. #20: 'done' is
          // terminal — the button is armed-off so a tap can't re-run
          // the automation after the payment gateway was reached.
          disabled={flowPhase === 'done'}
          onPress={onSearchFlowTap}
          style={{ marginTop: theme.spacing.md }}
        />

        {flowNotice && (
          <View style={{ marginTop: theme.spacing.sm }}>
            {flowInterventionKind ? (
              <InterventionCard
                kind={flowInterventionKind}
                message={flowNotice}
                primaryLabel="Got it"
                onPrimary={() => setFlowNotice(null)}
              />
            ) : (
              renderNotice(flowNotice, 'warn')
            )}
          </View>
        )}

        <SecondaryButton
          title={
            fillState === 'idle'
              ? 'Fill my form (manual)'
              : fillState === 'filling'
                ? 'Filling… watch the page'
                : 'Form filled'
          }
          icon="edit"
          fullWidth
          disabled={fillState !== 'idle'}
          onPress={onFillTap}
          style={{ marginTop: theme.spacing.md }}
        />

        <Text
          style={{
            color: theme.colors.muted,
            fontSize: ty.caption.size,
            lineHeight: ty.caption.lineHeight + 4,
            textAlign: 'center',
            marginTop: theme.spacing.sm,
          }}
        >
          The flow taps Search Trains, Book Now, the station-mismatch Yes,
          and the review page's Continue for you — and stops at payment.
          CAPTCHA, OTP and the actual payment are always your own hand.
        </Text>
        <View
          style={{
            marginTop: theme.spacing.sm,
            borderColor: theme.colors.line,
            borderWidth: 1,
            borderRadius: theme.radius.md,
            padding: theme.spacing.md,
          }}
        >
          <Text
            style={{
              color: theme.colors.muted,
              fontSize: ty.caption.size,
              lineHeight: ty.caption.lineHeight + 4,
              textAlign: 'center',
            }}
          >
            Second lane: the official RailOne app books the same Tatkal quota
            (same IRCTC backend). Its pre-loaded wallet can pay faster than
            UPI/bank redirects at 10:00.
          </Text>
        </View>

        <Text
          style={{
            fontSize: ty.h3.size,
            fontWeight: ty.h3.weight,
            lineHeight: ty.h3.lineHeight,
            color: theme.colors.ink,
            marginTop: theme.spacing.xl,
            marginBottom: theme.spacing.sm,
          }}
        >
          Live status
        </Text>
        <AutomationStatus steps={automationSteps} />

        {events.length > 0 && (
          <Card variant="outlined" padding="sm" style={{ marginTop: theme.spacing.md }}>
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                marginBottom: theme.spacing.xs,
              }}
            >
              <Icon name="history" size={ICON_SIZE.xs} color={theme.colors.muted} />
              <Text
                style={{
                  color: theme.colors.ink,
                  fontSize: ty.bodySm.size,
                  fontWeight: '700',
                  marginLeft: theme.spacing.xs,
                }}
              >
                Fill log
              </Text>
            </View>
            {events.map((e, i) => (
              <Text key={i} style={{ color: theme.colors.muted, fontSize: 11, fontFamily: 'monospace' }}>
                {e.type}
                {e.data && (e.data as { label?: string }).label
                  ? ` · ${(e.data as { label?: string }).label}`
                  : ''}
              </Text>
            ))}
          </Card>
        )}

        <GhostButton
          icon="arrowLeft"
          title="Back to countdown"
          onPress={nav.back}
          fullWidth
          style={{ marginTop: theme.spacing.sm }}
        />
      </ScrollView>

      {otpRequired && (
        <View
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: theme.colors.overlay,
            justifyContent: 'center',
            padding: theme.spacing.xl,
          }}
          accessibilityViewIsModal
          accessibilityLabel="One-time password entry"
        >
          <Card variant="elevated">
            <Text
              style={{
                color: theme.colors.primary,
                fontSize: ty.h2.size,
                fontWeight: '800',
                marginBottom: theme.spacing.xs,
              }}
            >
              Aadhaar OTP required
            </Text>
            <Text
              style={{
                color: theme.colors.muted,
                fontSize: ty.bodySm.size,
                lineHeight: ty.bodySm.lineHeight,
                marginBottom: theme.spacing.md,
              }}
            >
              IRCTC sent a 6-digit OTP to your Aadhaar-linked mobile. Type it
              here and we'll place it on the page for you.
            </Text>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: theme.spacing.md }}>
              {otpDigits.map((d, i) => (
                <TextInput
                  key={i}
                  ref={(r) => {
                    otpRefs.current[i] = r;
                  }}
                  style={{
                    width: 44,
                    height: 52,
                    backgroundColor: theme.colors.surface2,
                    color: theme.colors.ink,
                    borderColor: theme.colors.line,
                    borderWidth: 1,
                    borderRadius: theme.radius.sm,
                    textAlign: 'center',
                    fontSize: 22,
                    fontWeight: '700',
                  }}
                  accessibilityLabel={`OTP digit ${i + 1} of 6`}
                  keyboardType="numeric"
                  maxLength={1}
                  value={d}
                  autoFocus={i === 0}
                  onChangeText={(text) => onOtpDigit(i, text)}
                />
              ))}
            </View>
            <PrimaryButton
              title="Place OTP on the page"
              disabled={!otpComplete}
              onPress={onPlaceOtp}
              fullWidth
            />
            <GhostButton
              title="I'll type it on the page myself"
              onPress={() => setOtpRequired(false)}
              fullWidth
              style={{ marginTop: theme.spacing.xs }}
            />
          </Card>
        </View>
      )}
    </View>
  );
}
