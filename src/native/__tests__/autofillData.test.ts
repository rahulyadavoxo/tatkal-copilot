/**
 * Tests for the automation fill-data builder (native bridge payload).
 * Verifies the flat key/value map the native services consume.
 */
import { buildFillData, DEFAULT_CHOREO_MAP, DEFAULT_FIELD_MAP } from '../autofillData';
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
  { id: 'p2', name: 'Asha Devi', age: 28, gender: 'F', berthPref: 'MB' },
];

describe('buildFillData', () => {
  it('maps trip fields to flat keys', () => {
    const d = buildFillData(trip, passengers);
    expect(d['trip.fromCode']).toBe('DTO');
    expect(d['trip.toCode']).toBe('NDLS');
    expect(d['trip.date']).toBe('11/10/2026');
    expect(d['trip.classCode']).toBe('3A');
    expect(d['trip.mobile']).toBe('9876543210');
  });

  it('resolves station names', () => {
    const d = buildFillData(trip, passengers);
    expect(d['trip.fromName']).toBeTruthy();
    expect(d['trip.toName']).toBeTruthy();
  });

  it('maps passengers in trip order, capped at 4', () => {
    const d = buildFillData(trip, passengers);
    expect(d['passenger.0.name']).toBe('Rahul Kumar');
    expect(d['passenger.0.age']).toBe('30');
    expect(d['passenger.1.name']).toBe('Asha Devi');
    expect(d['passenger.3.name']).toBeUndefined();
  });

  it('never includes credential keys', () => {
    const d = buildFillData(trip, passengers);
    expect(Object.keys(d).some((k) => k.startsWith('credentials.'))).toBe(false);
    expect(JSON.stringify(d).toLowerCase()).not.toContain('password');
  });
});

describe('default maps', () => {
  it('field map has a version and entries', () => {
    expect(DEFAULT_FIELD_MAP.version).toBeGreaterThan(0);
    expect(DEFAULT_FIELD_MAP.fields.length).toBeGreaterThan(0);
  });

  it('choreography map has the payment kill-switch first', () => {
    const kill: string[] = DEFAULT_CHOREO_MAP.paymentKill.anyContains.map((s: string) =>
      s.toLowerCase(),
    );
    expect(kill.some((s: string) => s.includes('pay & book'))).toBe(true);
  });

  it('every choreography valueKey exists in the fill data or is a literal', () => {
    const d = buildFillData(trip, passengers, { username: 'u', password: 'p' });
    for (const page of DEFAULT_CHOREO_MAP.pages) {
      for (const step of page.steps) {
        const key = (step as { valueKey?: string }).valueKey;
        if (key) expect(d[key]).toBeDefined();
      }
    }
  });
});
