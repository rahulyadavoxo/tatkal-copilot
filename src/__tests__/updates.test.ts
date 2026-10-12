/**
 * Update flow tests: the visible check → download → auto-restart state
 * machine in src/updates.ts. expo-updates is replaced with a fake API —
 * nothing here touches the network or native modules.
 */
import {
  __resetUpdatesForTests,
  checkForAppUpdate,
  formatLastChecked,
  getCurrentUpdateShortId,
  getLastCheckedAt,
  getUpdateStatus,
  subscribeUpdateStatus,
  type UpdatesApi,
  type UpdateStatus,
} from '../updates';

jest.mock('expo-updates', () => ({ __esModule: true }), { virtual: false });

function fakeApi(overrides: Partial<UpdatesApi> = {}): UpdatesApi {
  return {
    isEnabled: true,
    checkForUpdateAsync: jest.fn().mockResolvedValue({ isAvailable: false }),
    fetchUpdateAsync: jest.fn().mockResolvedValue({ isNew: true }),
    reloadAsync: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

beforeEach(() => {
  __resetUpdatesForTests();
});

describe('checkForAppUpdate', () => {
  it('reports unsupported when expo-updates is disabled (dev build)', async () => {
    const seen: UpdateStatus[] = [];
    subscribeUpdateStatus((s) => seen.push(s));
    const api = fakeApi({ isEnabled: false });
    await checkForAppUpdate(api);
    expect(getUpdateStatus()).toBe('unsupported');
    expect(seen).toContain('unsupported');
    expect(api.checkForUpdateAsync).not.toHaveBeenCalled();
  });

  it('goes checking → upToDate when no update is available', async () => {
    const seen: UpdateStatus[] = [];
    subscribeUpdateStatus((s) => seen.push(s));
    const api = fakeApi();
    await checkForAppUpdate(api);
    expect(seen).toEqual(expect.arrayContaining(['checking', 'upToDate']));
    expect(seen.indexOf('checking')).toBeLessThan(seen.indexOf('upToDate'));
    expect(api.fetchUpdateAsync).not.toHaveBeenCalled();
    expect(api.reloadAsync).not.toHaveBeenCalled();
    expect(getLastCheckedAt()).not.toBeNull();
  });

  it('goes checking → downloading → ready → restarting and reloads on an update', async () => {
    const seen: UpdateStatus[] = [];
    subscribeUpdateStatus((s) => seen.push(s));
    const api = fakeApi({
      checkForUpdateAsync: jest.fn().mockResolvedValue({ isAvailable: true }),
    });
    await checkForAppUpdate(api);
    const order: UpdateStatus[] = ['checking', 'downloading', 'ready', 'restarting'];
    let lastIdx = -1;
    for (const s of order) {
      const idx = seen.indexOf(s);
      expect(idx).toBeGreaterThan(lastIdx);
      lastIdx = idx;
    }
    expect(api.fetchUpdateAsync).toHaveBeenCalledTimes(1);
    expect(api.reloadAsync).toHaveBeenCalledTimes(1);
  });

  it('surfaces check failures as error without downloading', async () => {
    const api = fakeApi({
      checkForUpdateAsync: jest.fn().mockRejectedValue(new Error('offline')),
    });
    await checkForAppUpdate(api);
    expect(getUpdateStatus()).toBe('error');
    expect(api.fetchUpdateAsync).not.toHaveBeenCalled();
    expect(api.reloadAsync).not.toHaveBeenCalled();
  });

  it('surfaces download failures as error without restarting', async () => {
    const api = fakeApi({
      checkForUpdateAsync: jest.fn().mockResolvedValue({ isAvailable: true }),
      fetchUpdateAsync: jest.fn().mockRejectedValue(new Error('timeout')),
    });
    await checkForAppUpdate(api);
    expect(getUpdateStatus()).toBe('error');
    expect(api.reloadAsync).not.toHaveBeenCalled();
  });

  it('never throws — even when reload fails', async () => {
    const api = fakeApi({
      checkForUpdateAsync: jest.fn().mockResolvedValue({ isAvailable: true }),
      reloadAsync: jest.fn().mockRejectedValue(new Error('gone')),
    });
    await expect(checkForAppUpdate(api)).resolves.toBeUndefined();
    expect(getUpdateStatus()).toBe('error');
  });

  it('shares one in-flight check between concurrent callers', async () => {
    const api = fakeApi({
      checkForUpdateAsync: jest.fn().mockResolvedValue({ isAvailable: false }),
    });
    await Promise.all([checkForAppUpdate(api), checkForAppUpdate(api), checkForAppUpdate(api)]);
    expect(api.checkForUpdateAsync).toHaveBeenCalledTimes(1);
  });

  it('a failing listener does not break the flow', async () => {
    subscribeUpdateStatus(() => {
      throw new Error('bad listener');
    });
    const api = fakeApi();
    await expect(checkForAppUpdate(api)).resolves.toBeUndefined();
    expect(getUpdateStatus()).toBe('upToDate');
  });
});

describe('formatLastChecked', () => {  it('says "just now" under a minute', () => {
    const now = 1_000_000;
    expect(formatLastChecked(now - 30_000, now)).toBe('just now');
  });

  it('says "N min ago" under an hour', () => {
    const now = 1_000_000;
    expect(formatLastChecked(now - 5 * 60_000, now)).toBe('5 min ago');
  });

  it('falls back to the clock time for older checks', () => {
    const now = 1_000_000;
    const out = formatLastChecked(now - 3 * 3600_000, now);
    expect(out).toMatch(/^\d{1,2}:\d{2}/);
  });
});

describe('getCurrentUpdateShortId', () => {
  it('returns the first 8 chars of the update id', () => {
    expect(getCurrentUpdateShortId(fakeApi({ updateId: '01a11b78-78bf-71e3-86af-c6bcdc22555c' }))).toBe('01a11b78');
  });

  it('returns null when there is no update id', () => {
    expect(getCurrentUpdateShortId(fakeApi({ updateId: null }))).toBeNull();
    expect(getCurrentUpdateShortId(fakeApi({}))).toBeNull();
  });
});
