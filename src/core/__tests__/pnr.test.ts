import {
  chartReminderTimes,
  formatPnrStatusReminder,
  isValidPnr,
} from '../pnr';

describe('isValidPnr', () => {
  test('accepts exactly 10 digits', () => {
    expect(isValidPnr('1234567890')).toBe(true);
    expect(isValidPnr('0000000000')).toBe(true);
  });

  test('rejects wrong lengths', () => {
    expect(isValidPnr('123456789')).toBe(false);
    expect(isValidPnr('12345678901')).toBe(false);
    expect(isValidPnr('')).toBe(false);
  });

  test('rejects non-digits and padding', () => {
    expect(isValidPnr('123456789a')).toBe(false);
    expect(isValidPnr(' 1234567890')).toBe(false);
    expect(isValidPnr('1234567890 ')).toBe(false);
    expect(isValidPnr('1234-567890')).toBe(false);
  });

  test('rejects non-strings', () => {
    expect(isValidPnr(1234567890)).toBe(false);
    expect(isValidPnr(null)).toBe(false);
    expect(isValidPnr(undefined)).toBe(false);
  });
});

describe('chartReminderTimes', () => {
  test('first chart ~4h before, second ~30min before', () => {
    const { firstChart, secondChart } = chartReminderTimes('2026-10-02T10:00:00+05:30');
    expect(firstChart.toISOString()).toBe('2026-10-02T00:30:00.000Z'); // 06:00 IST
    expect(secondChart.toISOString()).toBe('2026-10-02T04:00:00.000Z'); // 09:30 IST
  });

  test('midnight crossing lands on the previous day', () => {
    const { firstChart, secondChart } = chartReminderTimes('2026-10-02T02:00:00+05:30');
    expect(firstChart.toISOString()).toBe('2026-10-01T16:30:00.000Z'); // 22:00 IST Oct 1
    expect(secondChart.toISOString()).toBe('2026-10-01T20:00:00.000Z'); // 01:30 IST Oct 2
  });

  test('garbage input throws', () => {
    expect(() => chartReminderTimes('not-a-date')).toThrow();
    expect(() => chartReminderTimes('')).toThrow();
    expect(() => chartReminderTimes('2026-13-45')).toThrow();
  });
});

describe('formatPnrStatusReminder', () => {
  test('departed', () => {
    expect(formatPnrStatusReminder(0)).toBe('departed — check final chart');
    expect(formatPnrStatusReminder(-5_000)).toBe('departed — check final chart');
  });

  test('inside 30min → final chart out', () => {
    expect(formatPnrStatusReminder(10 * 60_000)).toBe('departs in 10m — final chart out');
  });

  test('inside 4h → first chart out', () => {
    expect(formatPnrStatusReminder(2 * 3_600_000)).toBe('departs in 2h 0m — first chart out');
    expect(formatPnrStatusReminder(3 * 3_600_000 + 20 * 60_000)).toBe(
      'departs in 3h 20m — first chart out',
    );
  });

  test('beyond 4h → plain countdown', () => {
    expect(formatPnrStatusReminder(26 * 3_600_000 + 5 * 60_000)).toBe('departs in 26h 5m');
  });

  test('non-finite throws', () => {
    expect(() => formatPnrStatusReminder(NaN)).toThrow();
    expect(() => formatPnrStatusReminder(Infinity)).toThrow();
  });
});
