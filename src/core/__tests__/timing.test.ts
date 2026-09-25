import { tatkalBookingOpen, msUntilTatkalOpen, TatkalConfig } from '../timing';

// Presumed values — L1 research spike confirms or corrects these in tatkalConfig.ts.
const CFG: TatkalConfig = { openDaysBefore: 1, acOpenHourIST: 10, nonAcOpenHourIST: 11 };

describe('tatkal window math (G6)', () => {
  test('AC: opens day before at 10:00 IST', () => {
    const open = tatkalBookingOpen('2026-10-02', true, CFG);
    expect(open.toISOString()).toBe('2026-10-01T04:30:00.000Z');
  });

  test('non-AC: opens day before at 11:00 IST', () => {
    const open = tatkalBookingOpen('2026-10-02', false, CFG);
    expect(open.toISOString()).toBe('2026-10-01T05:30:00.000Z');
  });

  test('month boundary: journey Nov 1 → opens Oct 31', () => {
    const open = tatkalBookingOpen('2026-11-01', true, CFG);
    expect(open.toISOString()).toBe('2026-10-31T04:30:00.000Z');
  });

  test('year boundary: journey Jan 1 → opens Dec 31 previous year', () => {
    const open = tatkalBookingOpen('2027-01-01', false, CFG);
    expect(open.toISOString()).toBe('2026-12-31T05:30:00.000Z');
  });

  test('leap day journey works', () => {
    const open = tatkalBookingOpen('2028-02-29', true, CFG);
    expect(open.toISOString()).toBe('2028-02-28T04:30:00.000Z');
  });

  test('msUntilTatkalOpen is negative once open', () => {
    const ms = msUntilTatkalOpen('2026-10-02', true, CFG, new Date('2026-10-01T05:00:00.000Z'));
    expect(ms).toBeLessThan(0);
  });

  test('msUntilTatkalOpen positive before opening', () => {
    const ms = msUntilTatkalOpen('2026-10-02', true, CFG, new Date('2026-10-01T04:00:00.000Z'));
    expect(ms).toBe(30 * 60_000);
  });

  test('bad dates rejected', () => {
    expect(() => tatkalBookingOpen('2026-02-30', true, CFG)).toThrow();
    expect(() => tatkalBookingOpen('not-a-date', true, CFG)).toThrow();
    expect(() => tatkalBookingOpen('2026-13-01', true, CFG)).toThrow();
  });
});
