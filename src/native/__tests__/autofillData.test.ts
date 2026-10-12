/**
 * Tests for the Chrome-side automation payload: the fill-data builder and
 * the choreography map (a step-for-step port of the in-app WebView flow).
 */
import {
  BOOKING_STAGES,
  buildFillData,
  DEFAULT_CHOREO_MAP,
  DEFAULT_FIELD_MAP,
  scanChoreoPaymentStop,
  tripPassengersForFill,
} from '../autofillData';
import { requiredFloorMs } from '../../core/fillEngine';
import type { Passenger, Trip } from '../../vaultStore';

const trip: Trip = {
  id: 't1',
  trainNo: '12951',
  from: 'DTO',
  to: 'NDLS',
  journeyDate: '2026-10-11',
  classCode: '3A',
  quota: 'GENERAL',
  isAC: true,
  passengerIds: ['p1', 'p2'],
  contactMobile: '9876543210',
  travelInsurance: false,
  autoUpgradation: false,
  paymentMode: 'default',
  paymentMethod: 'default',
  paymentProvider: 'default',
  createdAt: 1791619200000,
};

const passengers: Passenger[] = [
  { id: 'p1', name: 'Rahul Kumar', age: 30, gender: 'M', berthPref: 'LB' },
  { id: 'p2', name: 'Asha Devi', age: 28, gender: 'F', berthPref: 'SL', mealPref: 'Jain Meal' },
  { id: 'p3', name: 'Third', age: 50, gender: 'O', berthPref: 'UB' },
];

type Step = Record<string, unknown> & { do: string };
type Page = { id: string; stage: number; detect: Record<string, unknown>; steps: Step[] };
const pages = DEFAULT_CHOREO_MAP.pages as unknown as Page[];
const page = (id: string): Page => {
  const p = pages.find((x) => x.id === id);
  if (!p) throw new Error('no page ' + id);
  return p;
};

describe('buildFillData', () => {
  it('maps trip fields to flat keys', () => {
    const d = buildFillData(trip, passengers);
    expect(d['trip.fromCode']).toBe('DTO');
    expect(d['trip.toCode']).toBe('NDLS');
    expect(d['trip.date']).toBe('11/10/2026');
    expect(d['trip.dateCard']).toBe('11 Oct');
    expect(d['trip.classCode']).toBe('3A');
    expect(d['trip.classOptions']).toBe('3A|All Classes');
    expect(d['trip.quota']).toBe('GENERAL');
    expect(d['trip.quotaOptions']).toBe('GENERAL');
    expect(d['trip.trainNo']).toBe('12951');
    expect(d['trip.mobile']).toBe('9876543210');
  });

  it('resolves station names', () => {
    const d = buildFillData(trip, passengers);
    expect(d['trip.fromName']).toBeTruthy();
    expect(d['trip.toName']).toBeTruthy();
  });

  it('maps passengers in trip order with gender, nationality, berth and meal', () => {
    const d = buildFillData(trip, passengers);
    expect(d['passenger.count']).toBe('2');
    expect(d['passenger.0.name']).toBe('Rahul Kumar');
    expect(d['passenger.0.age']).toBe('30');
    expect(d['passenger.0.gender']).toBe('Male');
    expect(d['passenger.0.genderOptions']).toBe('Male');
    expect(d['passenger.0.berthOptions']).toBe('Lower');
    expect(d['passenger.0.nationality']).toBe('India');
    expect(d['passenger.0.meal']).toBe('Veg');
    expect(d['passenger.1.name']).toBe('Asha Devi');
    expect(d['passenger.1.gender']).toBe('Female');
    expect(d['passenger.1.berthOptions']).toBe('Side Lower');
    expect(d['passenger.1.meal']).toBe('Jain Meal');
    expect(d['passenger.2.name']).toBeUndefined();
  });

  it('falls back to every saved passenger (cap 4) like the app', () => {
    const t = { ...trip, passengerIds: [] };
    expect(tripPassengersForFill(t, passengers).map((p) => p.id)).toEqual(['p1', 'p2', 'p3']);
    const d = buildFillData(t, passengers);
    expect(d['passenger.2.genderOptions']).toBe('Other|Transgender');
  });

  it('insurance and auto-upgradation follow the trip', () => {
    expect(buildFillData(trip, passengers)['trip.insuranceOption']).toBe("No, I don't want");
    expect(buildFillData(trip, passengers)['trip.autoUpgradation']).toBe('');
    const t = { ...trip, travelInsurance: true, autoUpgradation: true };
    expect(buildFillData(t, passengers)['trip.insuranceOption']).toBe('Yes, and I accept');
    expect(buildFillData(t, passengers)['trip.autoUpgradation']).toBe('true');
  });

  it('payment mode, method and provider resolve like the WebView plans', () => {
    const d0 = buildFillData(trip, passengers);
    expect(d0['review.paymentModeTokens']).toBe('');
    expect(d0['pay.methodPattern']).toBe('');
    expect(d0['pay.providerName']).toBe('');
    const d1 = buildFillData(
      { ...trip, paymentMode: 'bhim', paymentMethod: 'multiple', paymentProvider: 'phonepe' },
      passengers,
    );
    expect(d1['review.paymentModeTokens']).toBe('bhim|upi');
    expect(d1['pay.methodPattern']).toBe('multiple payment service');
    expect(d1['pay.providerName']).toBe('phonepe');
    // iPay has no provider list: provider is not applied (paymentEngine rule).
    const d2 = buildFillData({ ...trip, paymentMethod: 'ipay', paymentProvider: 'phonepe' }, passengers);
    expect(d2['pay.providerName']).toBe('');
    expect(new RegExp(d2['pay.methodPattern']).test('irctc ipay')).toBe(true);
  });

  it('tatkal trips carry the window-open instant; general trips do not', () => {
    expect(buildFillData(trip, passengers)['trip.tatkalOpenAt']).toBe('');
    const d = buildFillData({ ...trip, quota: 'TATKAL' }, passengers);
    expect(d['trip.isTatkal']).toBe('true');
    // 2026-10-11 AC -> 2026-10-10 10:00 IST
    expect(new Date(Number(d['trip.tatkalOpenAt'])).toISOString()).toBe('2026-10-10T04:30:00.000Z');
  });

  it('carries the fill-engine pacing floor', () => {
    expect(buildFillData(trip, passengers)['pace.paxFloorMs']).toBe(String(requiredFloorMs(2)));
  });

  it('language follows the saved preference', () => {
    expect(buildFillData(trip, passengers)['site.language']).toBe('English');
    expect(buildFillData(trip, passengers, null, { language: 'hi' })['site.language']).toBe('हिंदी');
  });

  it('includes credentials only when given, never otherwise', () => {
    const d = buildFillData(trip, passengers);
    expect(Object.keys(d).some((k) => k.startsWith('irctc.'))).toBe(false);
    expect(JSON.stringify(d).toLowerCase()).not.toContain('password');
    const c = buildFillData(trip, passengers, { username: 'u', password: 'p' });
    expect(c['irctc.username']).toBe('u');
    expect(c['irctc.password']).toBe('p');
  });
});

describe('choreography map', () => {
  it('field map has a version and entries', () => {
    expect(DEFAULT_FIELD_MAP.version).toBeGreaterThan(0);
    expect(DEFAULT_FIELD_MAP.fields.length).toBeGreaterThan(0);
  });

  it('mirrors the app 7-step progress', () => {
    expect(DEFAULT_CHOREO_MAP.stages).toEqual(BOOKING_STAGES);
    expect(BOOKING_STAGES).toEqual(['Login', 'Search', 'Train', 'Passengers', 'Review', 'Payment', 'Done']);
    for (const p of pages) {
      expect(p.stage).toBeGreaterThanOrEqual(1);
      expect(p.stage).toBeLessThanOrEqual(6);
      for (const s of p.steps) {
        expect(typeof s.say).toBe('string');
        if (s.stage !== undefined) expect(s.stage).toBeGreaterThanOrEqual(1);
      }
    }
  });

  it('every step type is one the native engine implements', () => {
    const known = new Set([
      'tap', 'tapLogin', 'fillField', 'typeAndPickSuggestion', 'setDate', 'selectDropdownOption',
      'selectRadio', 'checkbox', 'tapInCard', 'waitForPage', 'confirmPopup', 'focusCaptcha',
      'submitLogin', 'waitTatkal', 'addPassengerRow', 'waitUserCaptcha', 'selectOption',
    ]);
    for (const p of pages) for (const s of p.steps) expect(known.has(s.do)).toBe(true);
  });

  it('page ids are unique and later stages are tried first', () => {
    const ids = pages.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    const order = ['providers', 'payMethods', 'reviewJourney', 'popup', 'passengers', 'trainList', 'search'];
    const idx = order.map((id) => ids.indexOf(id));
    expect(idx.every((v, i) => i === 0 || v > idx[i - 1])).toBe(true);
    expect(ids.slice(0, 2)).toEqual(['language', 'login']);
  });

  it('runs the in-app stages in the in-app order', () => {
    expect(page('search').steps.map((s) => s.do)).toEqual([
      'tapLogin', 'typeAndPickSuggestion', 'typeAndPickSuggestion', 'setDate',
      'selectDropdownOption', 'selectDropdownOption', 'waitTatkal', 'tap',
    ]);
    expect(page('trainList').steps.map((s) => s.target ?? s.do)).toEqual(['class', 'date', 'waitTatkal', 'bookNow']);
    const pax = page('passengers').steps.map((s) => s.say as string);
    expect(pax[0]).toBe('filling passenger 1 name');
    expect(pax).toContain('adding passenger 4');
    expect(pax.slice(-6)).toEqual([
      'filling the contact mobile', 'choosing travel insurance', 'ticking auto-upgradation',
      'skipping the co-branded card offer', 'choosing the payment mode', 'tapping Continue',
    ]);
    expect(page('payMethods').steps.map((s) => s.do)).toEqual(['selectOption', 'tap']);
    expect(page('providers').steps.map((s) => s.do)).toEqual(['selectOption', 'tap']);
  });

  it('search form uses station codes, the class fallback and the quota', () => {
    const s = page('search').steps;
    expect(s[1].valueKey).toBe('trip.fromCode');
    expect(s[2].valueKey).toBe('trip.toCode');
    expect(s[3].valueKey).toBe('trip.date');
    expect(s[4].optionsKey).toBe('trip.classOptions');
    expect(s[5].optionsKey).toBe('trip.quotaOptions');
  });

  it('Search Trains and Book Now wait for the Tatkal window', () => {
    const search = page('search').steps;
    const gate = search.findIndex((s) => s.do === 'waitTatkal');
    const tapSearch = search.findIndex((s) => s.do === 'tap');
    expect(gate).toBeGreaterThan(-1);
    expect(gate).toBe(tapSearch - 1);
    const tl = page('trainList').steps;
    expect(tl.findIndex((s) => s.do === 'waitTatkal')).toBe(tl.findIndex((s) => s.target === 'bookNow') - 1);
  });

  it('login never solves the captcha: focus, then the in-app submit rule', () => {
    const s = page('login').steps.map((x) => x.do);
    expect(s).toEqual(['fillField', 'fillField', 'submitLogin']);
  });

  it('auto-upgradation only when the trip asks; payment mode only when not default', () => {
    const steps = page('passengers').steps;
    expect(steps.find((s) => s.do === 'checkbox')?.onlyIf).toBe('trip.autoUpgradation');
    expect(steps.find((s) => s.tokensKey)?.onlyIf).toBe('review.paymentModeTokens');
  });

  it('popup step answers only the station-mismatch confirmation', () => {
    const s = page('popup').steps[0];
    expect(s.do).toBe('confirmPopup');
    expect(s.markers).toEqual(['booking from', 'searched trains', 'boarding']);
  });

  it('Continue / Book Now taps are never machine-gunned', () => {
    for (const p of pages) {
      for (const s of p.steps) {
        if (s.do === 'tap' && /continue/i.test(String(s.text))) expect(s.maxTaps).toBe(1);
      }
    }
    expect(page('trainList').steps[3].maxTaps).toBe(2);
  });

  it('loader, OTP and run limits are set', () => {
    expect(DEFAULT_CHOREO_MAP.loader.anyContains).toContain('please wait');
    expect(DEFAULT_CHOREO_MAP.loader.slowAfterMs).toBe(90_000);
    expect(DEFAULT_CHOREO_MAP.otp.anyContains.length).toBeGreaterThan(0);
    expect(DEFAULT_CHOREO_MAP.runIdleTimeoutMs).toBeGreaterThan(90_000);
  });

  it('every choreography valueKey/optionsKey/onlyIf exists in the fill data', () => {
    const d = buildFillData(
      { ...trip, quota: 'TATKAL', paymentMode: 'cards', paymentMethod: 'multiple', paymentProvider: 'payu', autoUpgradation: true, passengerIds: ['p1', 'p2', 'p3', 'p4'] },
      [...passengers, { id: 'p4', name: 'Four', age: 9, gender: 'M', berthPref: 'NP' }],
      { username: 'u', password: 'p' },
    );
    for (const p of pages) {
      for (const s of p.steps) {
        for (const k of ['valueKey', 'optionsKey', 'onlyIf', 'textKey', 'tokensKey', 'patternKey', 'gateKey']) {
          const key = s[k];
          if (typeof key === 'string') expect(d).toHaveProperty([key]);
        }
      }
      const pk = (p as { paceFloorKey?: string }).paceFloorKey;
      if (pk) expect(d).toHaveProperty([pk]);
    }
  });
});

describe('payment stop (CI scanner)', () => {
  it('the shipped map passes', () => {
    expect(scanChoreoPaymentStop(DEFAULT_CHOREO_MAP as never)).toEqual([]);
  });

  it('Pay & Book is the one and only final step, last on its page', () => {
    const finals = pages.flatMap((p) => p.steps.filter((s) => s.final === true).map((s) => ({ p, s })));
    expect(finals).toHaveLength(1);
    expect(finals[0].p.id).toBe('providers');
    expect(finals[0].p.steps[finals[0].p.steps.length - 1]).toBe(finals[0].s);
  });

  const clone = () => JSON.parse(JSON.stringify(DEFAULT_CHOREO_MAP));

  it('catches a step after Pay & Book', () => {
    const m = clone();
    m.pages.find((p: Page) => p.id === 'providers').steps.push({ do: 'tap', text: 'Proceed', say: 'x' });
    expect(scanChoreoPaymentStop(m)).toContain('steps follow the final Pay & Book tap');
  });

  it('catches a second Pay & Book tap', () => {
    const m = clone();
    m.pages.find((p: Page) => p.id === 'payMethods').steps.push({ do: 'tap', text: 'Pay & Book', say: 'x' });
    expect(scanChoreoPaymentStop(m)).toContain('non-final step taps Pay & Book on page payMethods');
  });

  it('catches a gateway page being scripted', () => {
    const m = clone();
    m.pages.push({ id: 'gw', stage: 6, detect: { allContains: ['phonepe'] }, steps: [] });
    expect(scanChoreoPaymentStop(m)).toContain('page gw is detected by gateway text');
  });

  it('catches payment-detail entry and a widened host allowlist', () => {
    const m = clone();
    m.pages[0].steps.push({ do: 'fillField', valueKey: 'pay.upiId', say: 'x' });
    m.gateway.allowHosts.push('payu.in');
    const hits = scanChoreoPaymentStop(m);
    expect(hits).toContain('step types a payment/secret value (pay.upiId)');
    expect(hits).toContain('gateway.allowHosts must be exactly ["irctc.co.in"]');
  });

  it('catches a retrying Pay & Book', () => {
    const m = clone();
    const prov = m.pages.find((p: Page) => p.id === 'providers');
    prov.steps[prov.steps.length - 1].retryAfterMs = 3000;
    expect(scanChoreoPaymentStop(m)).toContain('final step must never retry');
  });
});
