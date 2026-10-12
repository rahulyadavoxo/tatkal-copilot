/**
 * Alternate-train parser — harness/mock lane only.
 *
 * Moved here from src/core/fillEngine.ts (2026-10-03): it only ever parses
 * the verification harness's mock train-list snapshot (G7 phase) and has no
 * caller in the shipped engines. Keeping it in src/core shipped mock-only
 * dead weight inside the app bundle; src/harness is never bundled.
 */

export interface Alternate {
  trainNo: string;
  date: string;
  classCode: string;
  seatsAvailable: number;
  label: string; // raw row text, for display/debugging
}

/**
 * Parses the mock train-list snapshot for alternate trains. The real page
 * will differ; this is validated against the mock only.
 */
export function parseAlternates(snapshotHtml: string): Alternate[] {
  const alts: Alternate[] = [];
  const rowRe = /<tr[^>]*class="altRow"[^>]*>([\s\S]*?)<\/tr>/gi;
  let m: RegExpExecArray | null;
  while ((m = rowRe.exec(snapshotHtml)) !== null) {
    const row = m[1];
    const attr = (name: string): string => {
      const mm = new RegExp(`data-${name}="([^"]*)"`, 'i').exec(m![0]);
      return mm ? mm[1] : '';
    };
    const text = row.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    const trainNo = attr('train') || (/(\d{5})/.exec(text)?.[1] ?? '');
    const seatsM = /(\d+)\s*seats?/i.exec(text);
    alts.push({
      trainNo,
      date: attr('date'),
      classCode: attr('class'),
      seatsAvailable: seatsM ? parseInt(seatsM[1], 10) : 0,
      label: text,
    });
  }
  return alts;
}
