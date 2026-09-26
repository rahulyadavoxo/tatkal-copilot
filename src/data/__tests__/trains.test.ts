import { TRAINS, searchTrains } from '../trains';

describe('train directory (offline)', () => {
  test('famous trains present with correct numbers', () => {
    const byNo = new Map(TRAINS.map((t) => [t.no, t.name]));
    expect(byNo.get('12951')).toMatch(/rajdhani/i);
    expect(byNo.get('12301')).toMatch(/rajdhani/i);
    expect(byNo.get('12002')).toMatch(/shatabdi/i);
    expect(byNo.get('12259')).toMatch(/duronto/i);
    expect(byNo.get('22435')).toMatch(/vande bharat/i);
  });

  test('directory is large and has no duplicate numbers', () => {
    expect(TRAINS.length).toBeGreaterThan(1000);
    const nos = TRAINS.map((t) => t.no);
    expect(new Set(nos).size).toBe(nos.length);
  });

  test('every entry has a 5-digit number and a real name', () => {
    for (const t of TRAINS) {
      expect(t.no).toMatch(/^\d{5}$/);
      expect(t.name.length).toBeGreaterThan(3);
    }
  });

  test('number-prefix query ranks the exact train first', () => {
    const r = searchTrains('12951');
    expect(r.length).toBeGreaterThan(0);
    expect(r[0].no).toBe('12951');
  });

  test('name search finds trains', () => {
    const nos = searchTrains('rajdhani', 60).map((t) => t.no);
    expect(nos).toContain('12951');
    expect(nos).toContain('12301');
  });

  test('partial number matches', () => {
    const nos = searchTrains('22435').map((t) => t.no);
    expect(nos).toContain('22435');
  });

  test('empty query returns nothing', () => {
    expect(searchTrains('')).toEqual([]);
    expect(searchTrains('   ')).toEqual([]);
  });

  test('results are capped', () => {
    expect(searchTrains('express', 6).length).toBeLessThanOrEqual(6);
  });
});
