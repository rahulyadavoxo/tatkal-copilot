/**
 * Automation data for the native autofill + tap services.
 *
 * Single source of truth for the FIELD MAP, CHOREOGRAPHY MAP, and the
 * FILL DATA builder. Pure logic only (no react-native import) so it stays
 * unit-testable; the bridge write lives in tatkalProbe.ts.
 */
import { STATIONS } from '../data/stations';
import type { Passenger, Trip } from '../vaultStore';

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
// Default choreography map (tap service)
// ------------------------------------------------------------------

export const DEFAULT_CHOREO_MAP = {
  version: 1,
  // Checked FIRST on every event. Any match locks the service down for the
  // session: no fills, no taps, no observation. Cannot be disabled.
  paymentKill: {
    anyContains: [
      'pay & book',
      'pay and book',
      'payment options',
      'select bank',
      'upi pin',
      'payment gateway',
      'multiple payment service',
    ],
  },
  pages: [
    {
      // IRCTC shows a language prompt on first visit ("Please select your
      // preferred language"). Handle it before anything else so it never
      // blocks the search page. Checked first: first-match wins.
      id: 'language',
      // The alert always shows "Please select your preferred language."
      // (device screenshot 2026-10-12). Only that sentence, so the main
      // page's language toggle can never re-trigger this page.
      detect: { allContains: ['preferred language'] },
      // textKey: the language saved in the app (English / हिंदी).
      // gesture: a real finger tap (Chrome can ignore synthetic clicks);
      // repeatWhilePage: tap again until the alert is gone.
      steps: [{ do: 'tap', textKey: 'site.language', text: 'English', gesture: true, repeatWhilePage: true }],
    },
    {
      // IRCTC login form: fill the saved credentials (user decision
      // 2026-10-12). Filled on IRCTC's official login page only. Does NOT
      // tap login/submit — the user solves the CAPTCHA and taps by hand.
      id: 'login',
      detect: {
        allContains: ['user name', 'password'],
        anyOf: [['user name', 'password'], ['username', 'password'], ['captcha', 'password']],
      },
      steps: [
        { do: 'fillField', labelContains: ['user name', 'username', 'login id'], loginUser: true, valueKey: 'irctc.username' },
        { do: 'fillField', labelContains: ['password'], passwordField: true, valueKey: 'irctc.password' },
      ],
    },
    {
      id: 'search',
      // Never while the login form is up: its inputs would be mistaken
      // for From/To (fields are matched by position).
      detect: { allContains: ['search trains'], noneContains: ['password', 'captcha'] },
      steps: [
        // If logged out, IRCTC shows a LOGIN button in the header. Tap it
        // to open the login form; the 'login' safety page then takes over
        // (does nothing) until the user finishes logging in manually.
        // If already logged in the button is absent and this is a no-op.
        // tapLogin: LOGIN text, a login/profile icon, or the top-right
        // person glyph; skipped when already logged in.
        { do: 'tapLogin' },
        // IRCTC's inputs expose no accessible labels (probe 2026-10-12);
        // match by position: 0 = From, 1 = To, 2 = Date.
        { do: 'fillField', fieldIndex: 0, valueKey: 'trip.fromName', pickSuggestion: true },
        { do: 'fillField', fieldIndex: 1, valueKey: 'trip.toName', pickSuggestion: true },
        { do: 'fillField', fieldIndex: 2, valueKey: 'trip.date' },
        { do: 'tap', text: 'Search Trains' },
      ],
    },
    {
      id: 'passengers',
      detect: { allContains: ['passenger details'] },
      steps: [
        // Passenger rows are filled in order; the native engine matches
        // fields by their labels within each row.
        { do: 'fillField', labelContains: ['name'], valueKey: 'passenger.0.name' },
        { do: 'fillField', labelContains: ['mobile'], valueKey: 'trip.mobile' },
        { do: 'tap', text: 'Continue' },
      ],
    },
    {
      id: 'review',
      detect: { allContains: ['review journey'] },
      steps: [{ do: 'tap', text: 'Continue' }],
    },
  ],
};

// ------------------------------------------------------------------
// Fill data builder
// ------------------------------------------------------------------

const stationName = (code: string): string =>
  STATIONS.find((s) => s.code === code)?.name ?? code;

function toDDMMYYYY(yyyyMmDd: string): string {
  // IRCTC's date field displays slashes ("12/10/2026", seen on device).
  const [y, m, d] = yyyyMmDd.split('-');
  return y && m && d ? `${d}/${m}/${y}` : yyyyMmDd;
}

export function buildFillData(
  trip: Trip,
  passengers: Passenger[],
  creds?: { username: string; password: string } | null,
): Record<string, string> {
  const data: Record<string, string> = {
    'trip.fromName': stationName(trip.from),
    'trip.fromCode': trip.from,
    'trip.toName': stationName(trip.to),
    'trip.toCode': trip.to,
    'trip.date': toDDMMYYYY(trip.journeyDate),
    'trip.classCode': trip.classCode,
    'trip.quota': trip.quota,
    'trip.trainNo': trip.trainNo,
    'trip.mobile': trip.contactMobile,
  };
  if (creds?.username) data['irctc.username'] = creds.username;
  if (creds?.password) data['irctc.password'] = creds.password;
  const tripPassengers = trip.passengerIds
    .map((id) => passengers.find((p) => p.id === id))
    .filter((p): p is Passenger => !!p)
    .slice(0, 4);
  tripPassengers.forEach((p, i) => {
    data[`passenger.${i}.name`] = p.name;
    data[`passenger.${i}.age`] = String(p.age);
    data[`passenger.${i}.gender`] =
      p.gender === 'M' ? 'Male' : p.gender === 'F' ? 'Female' : 'Transgender';
    data[`passenger.${i}.berth`] = p.berthPref;
  });
  return data;
}
