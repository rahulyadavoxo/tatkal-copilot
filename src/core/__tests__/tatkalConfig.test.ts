import { IRCTC_CLASSES, IRCTC_QUOTAS, isAcClass } from '../tatkalConfig';

describe('IRCTC_CLASSES (user-requested selector list)', () => {
  test('contains exactly the 14 requested options in order', () => {
    expect([...IRCTC_CLASSES]).toEqual([
      'All Classes',
      'EA',
      '1A',
      'EV',
      'EC',
      '2A',
      'FC',
      '3A',
      '3E',
      'VC',
      'CC',
      'SL',
      'VS',
      '2S',
    ]);
  });

  test('every entry is a non-empty string with no duplicates', () => {
    const seen = new Set<string>();
    for (const c of IRCTC_CLASSES) {
      expect(typeof c).toBe('string');
      expect(c.length).toBeGreaterThan(0);
      expect(seen.has(c)).toBe(false);
      seen.add(c);
    }
  });
});

describe('isAcClass (Tatkal countdown timing)', () => {
  test('AC classes resolve to the 10:00 window', () => {
    for (const c of ['EA', '1A', 'EV', 'EC', '2A', '3A', '3E', 'VC', 'CC', 'VS']) {
      expect(isAcClass(c)).toBe(true);
    }
  });

  test('non-AC classes resolve to the 11:00 window', () => {
    for (const c of ['FC', 'SL', '2S']) {
      expect(isAcClass(c)).toBe(false);
    }
  });

  test('All Classes and unknown codes default to the earlier (AC) window', () => {
    expect(isAcClass('All Classes')).toBe(true);
    expect(isAcClass('BOGUS')).toBe(true);
  });
});

describe('IRCTC_QUOTAS (user-requested quota list)', () => {
  test('contains exactly the 7 requested quotas', () => {
    expect([...IRCTC_QUOTAS]).toEqual([
      'GENERAL',
      'LADIES',
      'LOWER BERTH/SR.CITIZEN',
      'PERSON WITH DISABILITY',
      'DUTY PASS',
      'TATKAL',
      'PREMIUM TATKAL',
    ]);
  });
});
