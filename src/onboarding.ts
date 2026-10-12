/**
 * Onboarding completion flag — Wave 2a.
 *
 * Stored DIRECTLY in expo-secure-store under our own key. This module does
 * NOT touch vaultStore (per the wave brief): the flag is a tiny plain
 * string ('1'), not vault data, so it skips AES and uses the OS keystore
 * alone. In-memory cache avoids a native round-trip on every app start.
 */
import * as SecureStore from 'expo-secure-store';

const KEY = 'tatkal_onboarding_done';

let cache: boolean | null = null;

export async function isOnboardingDone(): Promise<boolean> {
  if (cache !== null) return cache;
  try {
    const v = await SecureStore.getItemAsync(KEY);
    cache = v === '1';
  } catch {
    // Storage unavailable: treat as not done so onboarding still shows.
    cache = false;
  }
  return cache;
}

export async function setOnboardingDone(): Promise<void> {
  try {
    await SecureStore.setItemAsync(KEY, '1');
  } catch {
    // Non-fatal: the in-memory cache still marks it done for this session.
  }
  cache = true;
}

/** Test/dev escape hatch — not wired to any UI. */
export async function clearOnboardingDone(): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(KEY);
  } catch {
    // ignore
  }
  cache = false;
}
