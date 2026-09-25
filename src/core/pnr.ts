/**
 * PNR tracking — pure logic for the post-booking companion.
 *
 * No network, no storage here: validation + chart-reminder math only.
 * Persistence lives in vaultStore (loadPnrs/savePnrs, encrypted);
 * the screen opens IRCTC's PNR enquiry page inside the G9-allowlisted WebView.
 */

/** A PNR is exactly 10 digits — nothing else. */
export function isValidPnr(s: unknown): s is string {
  return typeof s === 'string' && /^[0-9]{10}$/.test(s);
}

export interface ChartTimes {
  /** ~4h before departure: first chart is usually prepared. */
  firstChart: Date;
  /** ~30min before departure: second/final chart. */
  secondChart: Date;
}

/**
 * Chart-preparation reminders for a departure instant.
 * `departureISO` must be a parseable ISO datetime string; throws otherwise.
 * (4h / 30min are the long-standing railway norms, not exact guarantees —
 * the UI words them with "~".)
 */
export function chartReminderTimes(departureISO: string): ChartTimes {
  const dep = new Date(departureISO);
  if (Number.isNaN(dep.getTime())) {
    throw new Error(`pnr: bad departure datetime "${departureISO}"`);
  }
  return {
    firstChart: new Date(dep.getTime() - 4 * 3_600_000),
    secondChart: new Date(dep.getTime() - 30 * 60_000),
  };
}

/**
 * One-line human reminder from milliseconds until departure.
 * Examples: "departs in 3h 20m — first chart out",
 *            "departs in 10m — final chart out",
 *            "departs in 26h 5m",
 *            "departed — check final chart".
 */
export function formatPnrStatusReminder(msUntilDeparture: number): string {
  if (!Number.isFinite(msUntilDeparture)) {
    throw new Error('pnr: msUntilDeparture must be a finite number');
  }
  if (msUntilDeparture <= 0) return 'departed — check final chart';
  const totalMin = Math.floor(msUntilDeparture / 60_000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  const when = h > 0 ? `${h}h ${m}m` : `${m}m`;
  if (msUntilDeparture <= 30 * 60_000) return `departs in ${when} — final chart out`;
  if (msUntilDeparture <= 4 * 3_600_000) return `departs in ${when} — first chart out`;
  return `departs in ${when}`;
}
