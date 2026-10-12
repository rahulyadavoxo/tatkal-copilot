/**
 * Theme persistence tests: the user's light/dark choice must survive an app
 * restart (it used to reset to the system scheme after every OTA update).
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

jest.mock('react-native', () => ({
  Appearance: { getColorScheme: () => 'dark', addChangeListener: jest.fn() },
}));

describe('theme persistence', () => {
  beforeEach(() => {
    jest.resetModules();
    const ss = jest.requireMock('expo-secure-store') as { __store: Map<string, string> };
    ss.__store.clear();
  });

  it('loadSavedTheme applies a saved light mode', async () => {
    const ss = jest.requireMock('expo-secure-store') as {
      setItemAsync: (k: string, v: string) => Promise<void>;
    };
    await ss.setItemAsync('tatkal.theme.mode', 'light');
    const { loadSavedTheme, getThemeMode } = require('../theme');
    await loadSavedTheme();
    expect(getThemeMode()).toBe('light');
  });

  it('loadSavedTheme ignores garbage values', async () => {
    const ss = jest.requireMock('expo-secure-store') as {
      setItemAsync: (k: string, v: string) => Promise<void>;
    };
    await ss.setItemAsync('tatkal.theme.mode', 'neon');
    const { loadSavedTheme, getThemeMode } = require('../theme');
    await loadSavedTheme();
    expect(getThemeMode()).toBe('dark'); // system default in this mock
  });

  it('loadSavedTheme with nothing saved keeps the system default', async () => {
    const { loadSavedTheme, getThemeMode } = require('../theme');
    await loadSavedTheme();
    expect(getThemeMode()).toBe('dark');
  });
});
