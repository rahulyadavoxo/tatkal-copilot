/**
 * App update flow (EAS Update / expo-updates) with a visible interface.
 *
 * The user asked for updates to never happen silently: every check,
 * download and restart is surfaced in the UI, and a downloaded update
 * restarts the app automatically so it takes effect right away.
 *
 * States: idle → checking → downloading → ready → restarting
 *                        ↘ upToDate / error / unsupported
 *
 * expo-updates only works in a real (release) build — in dev it reports
 * isEnabled=false and everything below degrades to 'unsupported'.
 */
import * as Updates from 'expo-updates';

export type UpdateStatus =
  | 'idle'
  | 'checking'
  | 'downloading'
  | 'ready'
  | 'restarting'
  | 'upToDate'
  | 'error'
  | 'unsupported';

/** Narrow view of the expo-updates API this module uses (fakes in tests). */
export interface UpdatesApi {
  readonly isEnabled: boolean;
  readonly updateId?: string | null;
  checkForUpdateAsync(): Promise<{ isAvailable: boolean }>;
  fetchUpdateAsync(): Promise<unknown>;
  reloadAsync(): Promise<void>;
}

const realApi: UpdatesApi = Updates as unknown as UpdatesApi;

type Listener = (status: UpdateStatus) => void;

let status: UpdateStatus = 'idle';
let lastCheckedAt: number | null = null;
let checkInFlight: Promise<void> | null = null;
const listeners = new Set<Listener>();

export function getUpdateStatus(): UpdateStatus {
  return status;
}

export function getLastCheckedAt(): number | null {
  return lastCheckedAt;
}

/**
 * Short id of the update this app is currently running (first 8 chars of
 * expo-updates' updateId). Shown in Settings → App updates so a version can
 * be verified on-device. Null in dev / when expo-updates has no update id.
 */
export function getCurrentUpdateShortId(api: UpdatesApi = realApi): string | null {
  try {
    const id = api.updateId;
    return typeof id === 'string' && id.length >= 8 ? id.slice(0, 8) : null;
  } catch {
    return null;
  }
}

export function subscribeUpdateStatus(listener: Listener): () => void {
  listeners.add(listener);
  try {
    listener(status);
  } catch {
    // A listener must never break the subscriber either.
  }
  return () => {
    listeners.delete(listener);
  };
}

function setStatus(next: UpdateStatus): void {
  status = next;
  listeners.forEach((l) => {
    try {
      l(next);
    } catch {
      // A listener must never break the update flow.
    }
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** expo-updates reports isEnabled=false in dev / Expo Go — never check there. */
export function updatesSupported(api: UpdatesApi = realApi): boolean {
  return api.isEnabled;
}

/** "just now" / "5 min ago" / "14:32" for the Settings row. */
export function formatLastChecked(ts: number, now: number = Date.now()): string {
  const diffSec = Math.max(0, Math.round((now - ts) / 1000));
  if (diffSec < 60) return 'just now';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin} min ago`;
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

async function runCheck(api: UpdatesApi): Promise<void> {
  if (!updatesSupported(api)) {
    setStatus('unsupported');
    return;
  }
  setStatus('checking');
  let available = false;
  try {
    const res = await api.checkForUpdateAsync();
    available = !!res.isAvailable;
    lastCheckedAt = Date.now();
  } catch {
    setStatus('error');
    return;
  }
  if (!available) {
    setStatus('upToDate');
    return;
  }
  setStatus('downloading');
  try {
    await api.fetchUpdateAsync();
  } catch {
    setStatus('error');
    return;
  }
  setStatus('ready');
  // Let the user actually read "Update ready — restarting…" before the
  // reload tears the JS runtime down.
  await sleep(1500);
  setStatus('restarting');
  try {
    await api.reloadAsync();
  } catch {
    // reloadAsync usually resolves right as the runtime is torn down; a
    // rejection here just means the restart didn't happen.
    setStatus('error');
  }
}

/**
 * Check for an update, download it visibly, and restart into it.
 * Concurrent calls share the in-flight check. Never throws — failures
 * surface as the 'error' status for the UI to show.
 */
export function checkForAppUpdate(api: UpdatesApi = realApi): Promise<void> {
  if (!checkInFlight) {
    checkInFlight = runCheck(api).finally(() => {
      checkInFlight = null;
    });
  }
  return checkInFlight;
}

/** Test-only: reset module state between cases. */
export function __resetUpdatesForTests(): void {
  status = 'idle';
  lastCheckedAt = null;
  checkInFlight = null;
  listeners.clear();
}
