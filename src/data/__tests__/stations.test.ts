import { STATIONS, searchStations } from '../stations';

describe('station directory (offline)', () => {
  test('major stations present with correct codes', () => {
    const byCode = new Map(STATIONS.map((s) => [s.code, s.name]));
    expect(byCode.get('NDLS')).toMatch(/new delhi/i);
    expect(byCode.get('HWH')).toMatch(/howrah/i);
    expect(byCode.get('BCT')).toMatch(/mumbai central/i);
    expect(byCode.get('LKO')).toMatch(/lucknow/i);
    expect(byCode.get('MAS')).toMatch(/chennai/i);
  });

  test('directory is large and has no duplicate codes', () => {
    expect(STATIONS.length).toBeGreaterThan(5000);
    const codes = STATIONS.map((s) => s.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  test('code-prefix query surfaces the exact station near the top', () => {
    const r = searchStations('NDL');
    expect(r.length).toBeGreaterThan(0);
    expect(r.slice(0, 4).map((s) => s.code)).toContain('NDLS');
  });

  test('name search finds stations', () => {
    const codes = searchStations('lucknow').map((s) => s.code);
    expect(codes).toContain('LKO');
    expect(codes).toContain('LJN');
  });

  test('partial name matches', () => {
    const codes = searchStations('howra').map((s) => s.code);
    expect(codes).toContain('HWH');
  });

  test('empty query returns nothing', () => {
    expect(searchStations('')).toEqual([]);
    expect(searchStations('   ')).toEqual([]);
  });

  test('results are capped', () => {
    expect(searchStations('a', 6).length).toBeLessThanOrEqual(6);
  });
});
