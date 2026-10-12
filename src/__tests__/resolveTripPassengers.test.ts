/**
 * resolveTripPassengers tests: which passengers a trip will book.
 *
 * Rule: explicitly linked passengers win when they still exist in the
 * vault; otherwise the trip falls back to the saved passengers (Tatkal PNR
 * cap: 4) so a traveller saved once works on every trip. Same native-module
 * mocks as vaultStore.test.ts — the helper itself is pure.
 */
jest.mock('expo-secure-store', () => {
  const store = new Map<string, string>();
  return {
    getItemAsync: jest.fn(async (k: string) => (store.has(k) ? store.get(k)! : null)),
    setItemAsync: jest.fn(async (k: string, v: string) => {
      store.set(k, v);
    }),
    deleteItemAsync: jest.fn(async (k: string) => {
      store.delete(k);
    }),
  };
});

jest.mock('expo-crypto', () => ({
  getRandomBytesAsync: jest.fn(async (n: number) => new Uint8Array(n)),
}));

import {
  resolveTripPassengers,
  type Passenger,
  type Trip,
} from '../vaultStore';

function pax(id: string, name: string): Passenger {
  return { id, name, age: 30, gender: 'M', berthPref: 'LB' };
}

function trip(passengerIds: string[]): Trip {
  return {
    id: 'trip-1',
    trainNo: '20407',
    from: 'DTO',
    to: 'NDLS',
    journeyDate: '2026-10-08',
    classCode: '3A',
    quota: 'TATKAL',
    isAC: true,
    passengerIds,
    contactMobile: '',
    travelInsurance: true,
    autoUpgradation: false,
    paymentMode: 'default',
    paymentMethod: 'default',
    paymentProvider: 'default',
    createdAt: 0,
  };
}

describe('resolveTripPassengers', () => {
  it('returns linked passengers in trip order when they resolve', () => {
    const all = [pax('a', 'Asha'), pax('b', 'Bina'), pax('c', 'Chand')];
    const got = resolveTripPassengers(trip(['c', 'a']), all);
    expect(got.map((p) => p.id)).toEqual(['c', 'a']);
  });

  it('returns exactly the linked subset — no fallback top-up', () => {
    const all = [pax('a', 'Asha'), pax('b', 'Bina'), pax('c', 'Chand')];
    const got = resolveTripPassengers(trip(['b']), all);
    expect(got.map((p) => p.id)).toEqual(['b']);
  });

  it('falls back to all saved passengers when the trip links none', () => {
    const all = [pax('a', 'Asha'), pax('b', 'Bina')];
    const got = resolveTripPassengers(trip([]), all);
    expect(got.map((p) => p.id)).toEqual(['a', 'b']);
  });

  it('falls back when linked ids are dangling (passenger deleted)', () => {
    const all = [pax('b', 'Bina')];
    const got = resolveTripPassengers(trip(['gone-1', 'gone-2']), all);
    expect(got.map((p) => p.id)).toEqual(['b']);
  });

  it('caps the fallback at 4 (Tatkal PNR cap)', () => {
    const all = ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => pax(id, id));
    const got = resolveTripPassengers(trip([]), all);
    expect(got).toHaveLength(4);
    expect(got.map((p) => p.id)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('returns [] when the vault is empty', () => {
    expect(resolveTripPassengers(trip([]), [])).toEqual([]);
    expect(resolveTripPassengers(trip(['x']), [])).toEqual([]);
  });
});
