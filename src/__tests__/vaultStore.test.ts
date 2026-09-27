/**
 * vaultStore credential + preference tests.
 *
 * SecureStore and expo-crypto are mocked in-memory: the crypto itself is
 * real (AES-256-GCM via @noble/ciphers), so a save→load round-trip proves
 * the envelope path — but nothing here touches real device storage, and
 * only throwaway test values are used (never real credentials).
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
    __store: store,
  };
});

jest.mock('expo-crypto', () => ({
  // Deterministic stand-in for the native RNG — fine for a round-trip test.
  getRandomBytesAsync: jest.fn(async (n: number) => {
    const a = new Uint8Array(n);
    for (let i = 0; i < n; i++) a[i] = (i * 37 + 11) % 256;
    return a;
  }),
}));

import {
  clearIrctcCredentials,
  loadIrctcCredentials,
  loadPrefs,
  loadTrips,
  PAYMENT_MODE_LABELS,
  saveIrctcCredentials,
  savePrefs,
  saveTrips,
  type PaymentMode,
  type Trip,
} from '../vaultStore';

function sampleTrip(overrides: Partial<Trip> = {}): Trip {
  return {
    id: 'trip-test-1',
    trainNo: '12873',
    from: 'DTO',
    to: 'NDLS',
    journeyDate: '2026-09-29',
    classCode: '3A',
    quota: 'TATKAL',
    isAC: true,
    passengerIds: [],
    contactMobile: '9876543210',
    travelInsurance: true,
    autoUpgradation: false,
    paymentMode: 'default',
    createdAt: Date.now(),
    ...overrides,
  };
}

describe('trip preferences', () => {
  it('round-trips autoUpgradation and paymentMode through the encrypted vault', async () => {
    await saveTrips([sampleTrip({ autoUpgradation: true, paymentMode: 'bhim' })]);
    const [loaded] = await loadTrips();
    expect(loaded.autoUpgradation).toBe(true);
    expect(loaded.paymentMode).toBe('bhim');
  });

  it('labels every payment mode', () => {
    const modes: PaymentMode[] = ['default', 'cards', 'bhim'];
    for (const m of modes) {
      expect(typeof PAYMENT_MODE_LABELS[m]).toBe('string');
      expect(PAYMENT_MODE_LABELS[m].length).toBeGreaterThan(0);
    }
  });

  it('older trips without the new fields stay readable (safe defaults apply at use sites)', async () => {
    const legacy = sampleTrip() as unknown as Record<string, unknown>;
    delete legacy.autoUpgradation;
    delete legacy.paymentMode;
    await saveTrips([legacy as unknown as Trip]);
    const [loaded] = await loadTrips();
    // Use-site defaults: unticked auto-upgradation, IRCTC-default payment.
    expect(loaded.autoUpgradation ?? false).toBe(false);
    expect(loaded.paymentMode ?? 'default').toBe('default');
  });
});

describe('IRCTC credentials', () => {
  it('round-trips through the encrypted vault', async () => {
    await saveIrctcCredentials({ username: 'tu', password: 'tp-1' });
    const back = await loadIrctcCredentials();
    expect(back).toEqual({ username: 'tu', password: 'tp-1' });
  });

  it('is not stored in plaintext', async () => {
    await saveIrctcCredentials({ username: 'plaincheck', password: 'secret-xyz' });
    const mod = jest.requireMock('expo-secure-store') as { __store: Map<string, string> };
    const blobs = [...mod.__store.values()].join(' ');
    expect(blobs).not.toContain('plaincheck');
    expect(blobs).not.toContain('secret-xyz');
  });

  it('returns null when nothing is saved and clears cleanly', async () => {
    await clearIrctcCredentials();
    expect(await loadIrctcCredentials()).toBeNull();
  });
});

describe('prefs', () => {
  it('defaults to English and round-trips Hindi', async () => {
    expect((await loadPrefs()).language).toBe('en');
    await savePrefs({ language: 'hi' });
    expect((await loadPrefs()).language).toBe('hi');
    await savePrefs({ language: 'en' });
  });
});
