/**
 * Bridge to the native Phase 0/1 automation probe (TatkalProbeModule).
 * Android-only; every function degrades gracefully elsewhere.
 */
import { NativeModules, Platform } from 'react-native';

interface ProbeNativeModule {
  isAutofillServiceEnabled(): Promise<boolean>;
  isTapServiceEnabled(): Promise<boolean>;
  openAutofillSettings(): void;
  openAccessibilitySettings(): void;
  getProbeReport(): Promise<string>;
  requestTap(target: string): Promise<boolean>;
  clearProbeData(): Promise<boolean>;
  writeAutofillData(fieldMap: string, choreoMap: string, fillData: string): Promise<boolean>;
}

const M = NativeModules.TatkalProbe as ProbeNativeModule | undefined;

export const isProbeAvailable = (): boolean =>
  Platform.OS === 'android' && !!M;

export interface ProbeReport {
  autofillDump: string;
  autofillHost: string;
  tapDump: string;
  tapResult: string;
}

export async function isAutofillServiceEnabled(): Promise<boolean> {
  try {
    return (await M?.isAutofillServiceEnabled()) ?? false;
  } catch {
    return false;
  }
}

export async function isTapServiceEnabled(): Promise<boolean> {
  try {
    return (await M?.isTapServiceEnabled()) ?? false;
  } catch {
    return false;
  }
}

export function openAutofillSettings(): void {
  try {
    M?.openAutofillSettings();
  } catch {
    /* noop */
  }
}

export function openAccessibilitySettings(): void {
  try {
    M?.openAccessibilitySettings();
  } catch {
    /* noop */
  }
}

export async function getProbeReport(): Promise<ProbeReport | null> {
  try {
    const raw = await M?.getProbeReport();
    if (!raw) return null;
    return JSON.parse(raw) as ProbeReport;
  } catch {
    return null;
  }
}

export async function requestTap(target: string): Promise<boolean> {
  try {
    return (await M?.requestTap(target)) ?? false;
  } catch {
    return false;
  }
}

export async function clearProbeData(): Promise<boolean> {
  try {
    return (await M?.clearProbeData()) ?? false;
  } catch {
    return false;
  }
}

export async function writeAutofillData(
  fieldMap: string,
  choreoMap: string,
  fillData: string,
): Promise<boolean> {
  try {
    return (await M?.writeAutofillData(fieldMap, choreoMap, fillData)) ?? false;
  } catch {
    return false;
  }
}

/**
 * Syncs the current automation data for a trip to the native encrypted
 * prefs. Call on app start and whenever trips/passengers change.
 */
export async function syncAutofillData(tripId: string): Promise<boolean> {
  try {
    if (Platform.OS !== 'android' || !M?.writeAutofillData) return false;
    const { loadPassengers, loadTrips } = await import('../vaultStore');
    const { buildFillData, DEFAULT_CHOREO_MAP, DEFAULT_FIELD_MAP } =
      await import('./autofillData');
    const [trips, passengers] = await Promise.all([loadTrips(), loadPassengers()]);
    const trip = trips.find((t) => t.id === tripId);
    if (!trip) return false;
    return await writeAutofillData(
      JSON.stringify(DEFAULT_FIELD_MAP),
      JSON.stringify(DEFAULT_CHOREO_MAP),
      JSON.stringify(buildFillData(trip, passengers)),
    );
  } catch {
    return false;
  }
}
