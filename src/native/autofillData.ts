/**
 * Automation data for the native autofill + tap services.
 *
 * Single source of truth for the FIELD MAP, CHOREOGRAPHY MAP, and the
 * FILL DATA builder. Pure logic only (no react-native import) so it stays
 * unit-testable; the bridge write lives in tatkalProbe.ts.
 */
import { STATIONS } from '../data/stations';
import type { Passenger, Trip } from '../vaultStore';
import { MIN_FIELD_GAP_MS, requiredFloorMs } from '../core/fillEngine';
import { normalizeClassCode, toDateCard } from '../core/postSearchEngine';
import { toDMY } from '../core/prebookEngine';
import { isTatkalQuota } from '../core/tatkalConfig';
import {
  AUTO_UPGRADE_LABELS,
  berthOptionText,
  CLASS_VALUE_TEXTS,
  classDropdownWanted,
  COBRAND_SECTION_MARKERS,
  DEFAULT_MEAL,
  DEFAULT_NATIONALITY,
  genderOptionText,
  insuranceOptionText,
  KNOWN_CLASS_CODES,
  languageButtonText,
  paymentMethodPattern,
  paymentModeTokens,
  POPUP_AFFIRM_TEXTS,
  providerApplies,
  QUOTA_VALUE_TEXTS,
  STATION_MISMATCH,
  tatkalOpenAtMs,
} from '../core/stageChoices';

// ------------------------------------------------------------------
// Default field map (autofill service)
// ------------------------------------------------------------------

export const DEFAULT_FIELD_MAP = {
  version: 1,
  fields: [
    {
      dataKey: 'trip.fromName',
      label: 'From station',
      match: { hints: [], idContains: ['from', 'source', 'origin'], labelContains: ['from'] },
    },
    {
      dataKey: 'trip.toName',
      label: 'To station',
      match: { hints: [], idContains: ['to', 'dest'], labelContains: ['to', 'destination'] },
    },
    {
      dataKey: 'trip.date',
      label: 'Journey date',
      match: { hints: ['date'], idContains: ['date', 'journey'], labelContains: ['date'] },
    },
    {
      dataKey: 'trip.mobile',
      label: 'Mobile number',
      match: { hints: ['tel', 'phone'], idContains: ['mobile', 'phone'], labelContains: ['mobile'] },
    },
    // Passenger rows (up to 4; Tatkal PNR cap).
    ...[0, 1, 2, 3].flatMap((i) => [
      {
        dataKey: `passenger.${i}.name`,
        label: `Passenger ${i + 1} name`,
        match: { hints: ['name', 'person-name'], idContains: [`name${i}`, `pax${i}`], labelContains: ['name'] },
      },
      {
        dataKey: `passenger.${i}.age`,
        label: `Passenger ${i + 1} age`,
        match: { hints: [], idContains: [`age${i}`], labelContains: ['age'] },
      },
    ]),
  ],
};

// ------------------------------------------------------------------
// Default choreography map (tap service, real Chrome)
//
// A step-for-step port of the in-app WebView flow (BookingScreen.tsx):
//   prebookEngine   -> pages 'language', 'login', 'search'
//   postSearchEngine-> pages 'trainList', 'popup'
//   fillEngine      -> page  'passengers' (stage 4 steps)
//   reviewEngine    -> page  'passengers' (stage 5 steps: Skip card,
//                      payment mode, Continue — same combined page)
//   paymentEngine   -> pages 'reviewJourney', 'payMethods', 'providers'
//
// The native engine (TatkalTapService.kt) checks `gateway` FIRST on every
// pass: a non-IRCTC host in Chrome's address bar or gateway-only page text
// locks the run down for the session. The single step marked `final`
// ("Pay & Book") also locks the run down the moment it fires. Nothing is
// ever tapped, typed or read after that.
//
// Pages are tried in array order, first unfinished match wins, so later
// booking stages come first: a later page can carry text an earlier page
// also matches (e.g. "passenger details" on Review Journey).
// ------------------------------------------------------------------

/** The app's 7-step Booking progress (BookingScreen stepper), 1-based in `stage`. */
export const BOOKING_STAGES = ['Login', 'Search', 'Train', 'Passengers', 'Review', 'Payment', 'Done'] as const;

const MAX_PAX = 4;

const CLASS_CODE_RE = '\\((?:' + KNOWN_CLASS_CODES.map((c) => c.toLowerCase()).join('|') + ')\\)';

const GENDER_VALUES = ['gender', 'male', 'female', 'transgender', 'other'];
const BERTH_VALUES = [
  'berth preference', 'no preference', 'lower', 'middle', 'upper', 'side lower', 'side upper', 'window side',
];
const NATIONALITY_VALUES = ['india', 'nationality', 'select nationality'];
const MEAL_VALUES = [
  'catering service option', 'veg', 'non veg', 'jain meal', 'veg (diabetic)', 'non veg (diabetic)', 'no food',
];
const NAME_LABELS = ['full name as per govt', 'full name', 'passenger name'];
const AGE_LABELS = ['age'];

function passengerRowSteps(i: number): Record<string, unknown>[] {
  const only = `passenger.${i}.name`;
  const n = i + 1;
  const steps: Record<string, unknown>[] = [];
  if (i > 0) {
    steps.push({
      do: 'addPassengerRow', row: i, labelContains: NAME_LABELS, text: 'Add Passenger',
      onlyIf: only, say: `adding passenger ${n}`,
    });
  }
  steps.push(
    {
      do: 'fillField', labelContains: NAME_LABELS, index: i, fallbackIndex: i * 2,
      valueKey: `passenger.${i}.name`, onlyIf: only, say: `filling passenger ${n} name`,
    },
    {
      do: 'fillField', labelContains: AGE_LABELS, labelExact: true, index: i, fallbackIndex: i * 2 + 1,
      valueKey: `passenger.${i}.age`, onlyIf: only, say: `filling passenger ${n} age`,
    },
    {
      do: 'selectDropdownOption', control: { exactAny: GENDER_VALUES, index: i },
      optionsKey: `passenger.${i}.genderOptions`, onlyIf: only, say: `choosing passenger ${n} gender`,
    },
    {
      // IRCTC defaults to India; a no-op when it already shows India.
      do: 'selectDropdownOption', control: { exactAny: NATIONALITY_VALUES, index: i },
      optionsKey: `passenger.${i}.nationality`, onlyIf: only, optional: true,
      say: `checking passenger ${n} nationality`,
    },
    {
      do: 'selectDropdownOption', control: { exactAny: BERTH_VALUES, index: i },
      optionsKey: `passenger.${i}.berthOptions`, onlyIf: only, say: `choosing passenger ${n} berth`,
    },
    {
      // Mandatory on premium trains only; absent elsewhere (fillEngine: optional).
      do: 'selectDropdownOption', control: { exactAny: MEAL_VALUES, index: i },
      optionsKey: `passenger.${i}.meal`, onlyIf: only, optional: true, say: `choosing passenger ${n} meal`,
    },
  );
  return steps;
}

export const DEFAULT_CHOREO_MAP = {
  version: 2,
  stages: BOOKING_STAGES,
  // Whole-run limits: idle = no progress at all (a stuck page); max = hard cap.
  runIdleTimeoutMs: 10 * 60_000,
  runMaxMs: 60 * 60_000,
  // IRCTC's "Please Wait..." overlay: do nothing while it shows, never count
  // it as a stuck step, never skip; after slowAfterMs say so and keep waiting.
  loader: { anyContains: ['please wait'], slowAfterMs: 90_000 },
  // Pause (do nothing) while IRCTC asks the user for an OTP; resume after.
  otp: { anyContains: ['enter otp', 'one time password', 'otp sent', 'otp has been sent'] },
  // EXPLICIT STOP. Checked before anything else on every pass. Any match ends
  // the run for good: no fills, no taps, no reads. The provider page itself
  // shows PayU / Paytm / PhonePe / Razorpay as options, so gateway brands are
  // matched on the address-bar host, never on page text.
  gateway: {
    allowHosts: ['irctc.co.in'],
    anyContains: [
      'upi pin', 'enter upi id', 'enter vpa', 'card number', 'cvv', 'expiry date',
      'scan qr', 'scan & pay', 'pay securely',
    ],
  },
  pages: [
    {
      // prebookEngine stepLanguage. The alert always shows "Please select
      // your preferred language." (device screenshot 2026-10-12).
      id: 'language',
      stage: 1,
      detect: { allContains: ['preferred language'] },
      steps: [
        {
          do: 'tap', textKey: 'site.language', text: 'English', gesture: true, repeatWhilePage: true,
          say: 'choosing your language',
        },
      ],
    },
    {
      // prebookEngine fillLogin + submitLogin. The CAPTCHA is never solved:
      // the engine focuses it and waits for the user. SIGN IN is tapped only
      // when no CAPTCHA is showing (stepSubmitLogin), otherwise the user taps.
      id: 'login',
      stage: 1,
      detect: {
        anyOf: [['user name', 'password'], ['username', 'password'], ['captcha', 'password']],
      },
      steps: [
        { do: 'fillField', labelContains: ['user name', 'username', 'login id'], loginUser: true, valueKey: 'irctc.username', say: 'filling your user name' },
        { do: 'fillField', labelContains: ['password'], passwordField: true, valueKey: 'irctc.password', say: 'filling your password' },
        { do: 'focusCaptcha', say: 'type the captcha' },
        { do: 'submitLogin', text: 'SIGN IN', say: 'type the captcha, then tap SIGN IN' },
      ],
    },
    {
      // paymentEngine stepProviders: provider (never halts), then ONE tap of
      // "Pay & Book" and STOP. `final` locks the run down after the tap.
      id: 'providers',
      stage: 6,
      detect: { anyOf: [['pay & book'], ['pay and book']] },
      steps: [
        {
          do: 'selectOption', provider: true, textKey: 'pay.providerName', onlyIf: 'pay.providerName',
          optional: true, say: 'choosing your payment provider',
        },
        {
          do: 'tap', textAny: ['Pay & Book', 'Pay and Book'], gesture: true, final: true, slack: 24,
          say: 'tapping Pay & Book',
        },
      ],
    },
    {
      // paymentEngine stepPayMethods.
      id: 'payMethods',
      stage: 6,
      detect: { allContains: ['payment methods'] },
      steps: [
        {
          do: 'selectOption', patternKey: 'pay.methodPattern', onlyIf: 'pay.methodPattern',
          say: 'choosing your payment method',
        },
        {
          do: 'tap', text: 'Continue', fuzzy: true, gesture: true, maxTaps: 1,
          doneWhen: { anyOf: [['pay & book'], ['pay and book']] },
          say: 'tapping Continue',
        },
      ],
    },
    {
      // paymentEngine stepReviewJourney. A CAPTCHA here is the user's.
      id: 'reviewJourney',
      stage: 6,
      detect: { allContains: ['review journey'], noneContains: ['payment methods'] },
      steps: [
        { do: 'waitUserCaptcha', optional: true, say: 'type the captcha' },
        {
          do: 'tap', text: 'Continue', fuzzy: true, gesture: true, maxTaps: 1,
          doneWhen: { anyOf: [['payment methods'], ['pay & book'], ['pay and book']] },
          say: 'tapping Continue',
        },
      ],
    },
    {
      // postSearchEngine stepPopup: Yes only on the station-mismatch text.
      id: 'popup',
      stage: 3,
      detect: { allContains: [STATION_MISMATCH.prompt] },
      steps: [
        {
          do: 'confirmPopup', prompt: STATION_MISMATCH.prompt, markers: STATION_MISMATCH.markers,
          affirm: POPUP_AFFIRM_TEXTS, say: 'confirming the boarding station',
        },
      ],
    },
    {
      // fillEngine (stage 4) then reviewEngine (stage 5) on the same page.
      id: 'passengers',
      stage: 4,
      detect: {
        anyOf: [['passenger details'], ['full name as per govt']],
        noneContains: ['review journey', 'payment methods'],
      },
      // fillEngine pacing floor: never faster than requiredFloorMs(pax).
      paceFloorKey: 'pace.paxFloorMs',
      steps: [
        ...Array.from({ length: MAX_PAX }, (_, i) => passengerRowSteps(i)).flat(),
        {
          do: 'fillField', labelContains: ['mobile'], valueKey: 'trip.mobile', keepExisting: true,
          optional: true, say: 'filling the contact mobile',
        },
        {
          do: 'selectRadio', optionsKey: 'trip.insuranceOption', scopeAny: ['travel insurance'],
          optional: true, say: 'choosing travel insurance',
        },
        {
          do: 'checkbox', labelContains: AUTO_UPGRADE_LABELS, onlyIf: 'trip.autoUpgradation',
          optional: true, say: 'ticking auto-upgradation',
        },
        {
          // reviewEngine stepSkipCard: the co-branded card question's Skip.
          do: 'selectRadio', stage: 5, labelContains: ['skip'], scopeAny: COBRAND_SECTION_MARKERS,
          absentOk: true, optional: true, say: 'skipping the co-branded card offer',
        },
        {
          // reviewEngine stepPayment: 'default' (no tokens) leaves it alone.
          do: 'selectRadio', stage: 5, tokensKey: 'review.paymentModeTokens',
          onlyIf: 'review.paymentModeTokens', exclude: ['skip'], say: 'choosing the payment mode',
        },
        {
          // reviewEngine stepContinue: one tap, never re-tapped.
          do: 'tap', stage: 5, text: 'Continue', fuzzy: true, gesture: true, maxTaps: 1,
          minPageElapsed: true,
          doneWhen: { anyOf: [['review journey'], ['payment methods']] },
          say: 'tapping Continue',
        },
      ],
    },
    {
      // postSearchEngine stepSelectTrain (class tab, availability box, Book Now).
      id: 'trainList',
      stage: 3,
      detect: { allContains: ['book now'], noneContains: ['passenger details'] },
      steps: [
        { do: 'tapInCard', target: 'class', say: 'picking your class' },
        { do: 'tapInCard', target: 'date', say: 'picking your journey date' },
        { do: 'waitTatkal', gateKey: 'trip.tatkalOpenAt', say: 'waiting for the Tatkal window' },
        {
          do: 'tapInCard', target: 'bookNow', retryAfterMs: 4000, maxTaps: 2,
          doneWhen: { anyOf: [['passenger details'], ['full name as per govt'], [STATION_MISMATCH.prompt]] },
          say: 'tapping Book Now',
        },
      ],
    },
    {
      // prebookEngine openLogin + search form, then postSearchEngine tapSearch.
      id: 'search',
      stage: 2,
      // Never while the login form is up: its inputs would be mistaken for
      // From/To (fields are matched by position).
      detect: { allContains: ['search trains'], noneContains: ['password', 'captcha', 'book now'] },
      steps: [
        { do: 'tapLogin', stage: 1, say: 'opening the login form' },
        // IRCTC's inputs expose no accessible labels (probe 2026-10-12): by
        // position, 0 = From, 1 = To, 2 = Date. Type the code, pick the
        // suggestion carrying it (prebookEngine setAutocomplete).
        { do: 'typeAndPickSuggestion', fieldIndex: 0, valueKey: 'trip.fromCode', say: 'filling From' },
        { do: 'typeAndPickSuggestion', fieldIndex: 1, valueKey: 'trip.toCode', say: 'filling To' },
        { do: 'setDate', fieldIndex: 2, valueKey: 'trip.date', say: 'setting the journey date' },
        {
          do: 'selectDropdownOption',
          control: { exactAny: CLASS_VALUE_TEXTS, regex: CLASS_CODE_RE, index: 0 },
          optionsKey: 'trip.classOptions', say: 'choosing the class',
        },
        {
          do: 'selectDropdownOption', control: { exactAny: QUOTA_VALUE_TEXTS, index: 0 },
          optionsKey: 'trip.quotaOptions', say: 'choosing the quota',
        },
        { do: 'waitTatkal', gateKey: 'trip.tatkalOpenAt', say: 'ready — waiting for the Tatkal window' },
        {
          do: 'tap', textAny: ['Search Trains', 'Search'], exactOnly: true, gesture: true,
          retryAfterMs: 5000, maxTaps: 2, doneWhen: { allContains: ['book now'] },
          say: 'tapping Search Trains',
        },
      ],
    },
  ],
};

// ------------------------------------------------------------------
// Fill data builder
// ------------------------------------------------------------------

const stationName = (code: string): string =>
  STATIONS.find((s) => s.code === code)?.name ?? code;

/** Same rule as vaultStore.resolveTripPassengers (linked first, else every saved one), capped at 4. */
export function tripPassengersForFill(trip: Trip, all: Passenger[]): Passenger[] {
  const linked = (trip.passengerIds ?? [])
    .map((id) => all.find((p) => p.id === id))
    .filter((p): p is Passenger => !!p);
  return (linked.length > 0 ? linked : all).slice(0, MAX_PAX);
}

const pipe = (xs: readonly string[]): string => xs.join('|');

/**
 * Flat key/value map the native engine reads. Carries everything the
 * WebView plans carry (PrebookPlan, PostSearchPlan, FillPlan, ReviewPlan,
 * PaymentPlan), with each choice resolved by src/core/stageChoices.ts.
 */
export function buildFillData(
  trip: Trip,
  passengers: Passenger[],
  creds?: { username: string; password: string } | null,
  opts: { language?: 'en' | 'hi' } = {},
): Record<string, string> {
  let dateDMY = trip.journeyDate;
  let dateCard = '';
  try { dateDMY = toDMY(trip.journeyDate); } catch { /* keep raw */ }
  try { dateCard = toDateCard(trip.journeyDate); } catch { /* none */ }
  const quota = (trip.quota ?? 'TATKAL').trim();
  const method = trip.paymentMethod ?? 'default';
  const provider = trip.paymentProvider ?? 'default';
  const methodPattern = paymentMethodPattern(method);
  const modeTokens = paymentModeTokens(trip.paymentMode ?? 'default');
  const openAt = tatkalOpenAtMs({
    quota, journeyDate: trip.journeyDate, classCode: trip.classCode, isAC: trip.isAC,
  });
  const pax = tripPassengersForFill(trip, passengers);

  const data: Record<string, string> = {
    'site.language': languageButtonText(opts.language ?? 'en'),
    'trip.fromName': stationName(trip.from),
    'trip.fromCode': trip.from,
    'trip.toName': stationName(trip.to),
    'trip.toCode': trip.to,
    'trip.date': dateDMY,
    'trip.dateCard': dateCard,
    'trip.classCode': normalizeClassCode(trip.classCode || 'ALL'),
    'trip.classOptions': pipe(classDropdownWanted(trip.classCode)),
    'trip.quota': quota,
    'trip.quotaOptions': quota,
    'trip.trainNo': trip.trainNo,
    'trip.mobile': trip.contactMobile ?? '',
    'trip.insuranceOption': pipe(insuranceOptionText(trip.travelInsurance ?? true)),
    // Empty = falsy for the engine's onlyIf: ticked only when asked for.
    'trip.autoUpgradation': trip.autoUpgradation ? 'true' : '',
    'trip.isTatkal': isTatkalQuota(quota) ? 'true' : '',
    'trip.tatkalOpenAt': openAt === null ? '' : String(openAt),
    'passenger.count': String(pax.length),
    'review.paymentMode': trip.paymentMode ?? 'default',
    'review.paymentModeTokens': modeTokens ? pipe(modeTokens) : '',
    'pay.method': method,
    'pay.methodPattern': methodPattern ?? '',
    'pay.provider': provider,
    'pay.providerName': providerApplies(method, provider) ? provider : '',
    'pace.paxFloorMs': String(requiredFloorMs(Math.max(1, pax.length))),
    'pace.minGapMs': String(MIN_FIELD_GAP_MS),
  };
  if (creds?.username) data['irctc.username'] = creds.username;
  if (creds?.password) data['irctc.password'] = creds.password;
  pax.forEach((p, i) => {
    data[`passenger.${i}.name`] = p.name;
    data[`passenger.${i}.age`] = String(p.age);
    data[`passenger.${i}.gender`] = genderOptionText(p.gender)[0];
    data[`passenger.${i}.genderOptions`] = pipe(genderOptionText(p.gender));
    data[`passenger.${i}.berth`] = p.berthPref;
    data[`passenger.${i}.berthOptions`] = pipe(berthOptionText(p.berthPref));
    data[`passenger.${i}.nationality`] = DEFAULT_NATIONALITY;
    data[`passenger.${i}.meal`] = p.mealPref || DEFAULT_MEAL;
  });
  return data;
}

// ------------------------------------------------------------------
// Payment-stop scanner (CI): proves the choreography can never act past
// the single "Pay & Book" tap, and never on a gateway page.
// ------------------------------------------------------------------

type ScanStep = Record<string, unknown>;
type ScanPage = { id?: string; detect?: unknown; steps?: ScanStep[] };
type ScanMap = { gateway?: { allowHosts?: string[]; anyContains?: string[] }; pages?: ScanPage[] };

const PAY_BOOK_RE = /pay\s*(&|and)\s*book/i;
const GATEWAY_BRAND_RE = /payu|paytm|phonepe|razorpay|billdesk|ccavenue|juspay|upi\s*pin|cvv|card\s*number/i;
const FORBIDDEN_VALUE_RE = /card|cvv|upi|vpa|otp|captcha|pin\b/i;

export function scanChoreoPaymentStop(map: ScanMap): string[] {
  const hits: string[] = [];
  const gw = map.gateway;
  if (!gw || JSON.stringify(gw.allowHosts) !== JSON.stringify(['irctc.co.in'])) {
    hits.push('gateway.allowHosts must be exactly ["irctc.co.in"]');
  }
  for (const must of ['upi pin', 'cvv', 'card number']) {
    if (!gw?.anyContains?.includes(must)) hits.push(`gateway.anyContains lacks "${must}"`);
  }
  const finals: Array<{ page: ScanPage; idx: number }> = [];
  for (const page of map.pages ?? []) {
    if (GATEWAY_BRAND_RE.test(JSON.stringify(page.detect ?? {}))) {
      hits.push(`page ${page.id} is detected by gateway text`);
    }
    (page.steps ?? []).forEach((step, idx) => {
      const labels = [step.text, step.textKey, ...((step.textAny as unknown[]) ?? [])]
        .filter((x): x is string => typeof x === 'string');
      const mentionsPayBook = labels.some((l) => PAY_BOOK_RE.test(l));
      if (step.final === true) finals.push({ page, idx });
      else if (mentionsPayBook) hits.push(`non-final step taps Pay & Book on page ${page.id}`);
      const vk = step.valueKey;
      if (typeof vk === 'string' && FORBIDDEN_VALUE_RE.test(vk)) {
        hits.push(`step types a payment/secret value (${vk})`);
      }
      if (step.do === 'tap' && step.repeatWhilePage && page.id !== 'language') {
        hits.push(`repeating tap outside the language alert (page ${page.id})`);
      }
    });
  }
  if (finals.length !== 1) {
    hits.push(`final-step count != 1 (${finals.length})`);
  } else {
    const { page, idx } = finals[0];
    const step = (page.steps ?? [])[idx];
    const labels = [step.text, ...((step.textAny as unknown[]) ?? [])].filter(
      (x): x is string => typeof x === 'string',
    );
    if (step.do !== 'tap') hits.push('final step is not a tap');
    if (!labels.length || !labels.every((l) => PAY_BOOK_RE.test(l))) {
      hits.push('final step must tap only Pay & Book');
    }
    if (step.textKey) hits.push('final step label must be literal');
    if (step.maxTaps !== undefined && step.maxTaps !== 1) hits.push('final step may tap once only');
    if (step.retryAfterMs !== undefined) hits.push('final step must never retry');
    if (idx !== (page.steps ?? []).length - 1) hits.push('steps follow the final Pay & Book tap');
  }
  return hits;
}
