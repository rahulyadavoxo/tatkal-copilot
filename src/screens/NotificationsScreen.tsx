/**
 * Notification center (§39) — DERIVED LOCALLY from vault data.
 *
 * No backend, no push: every row is computed at render from real data with
 * real timestamps —
 *   - "Tatkal window opens in X" for upcoming Tatkal-quota trips, using the
 *     same window math as the countdown (core/timing + TATKAL_TIMING).
 *   - "Chart preparation" hints for tracked PNRs with a future departure
 *     (core/pnr chart math, "~" honest wording).
 *   - "Complete your setup" for readiness gaps that really exist: no
 *     passengers saved, no IRCTC login saved, or an upcoming trip with no
 *     passengers attached.
 *   - "Booking session paused": no on-device source of truth exists, so no
 *     such row is ever invented.
 *
 * Unread tracking is a simple in-memory Set (no new storage).
 */
import React, { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../theme';
import type { Theme } from '../theme';
import {
  loadIrctcCredentials,
  loadPassengers,
  loadPnrs,
  loadTrips,
} from '../vaultStore';
import { chartReminderTimes } from '../core/pnr';
import { TATKAL_TIMING } from '../timingConfig';
import { tatkalBookingOpen } from '../core/timing';
import { isTatkalQuota } from '../core/tatkalConfig';
import type { Nav, Route } from '../App';
import { useFocusLoad } from './hooks';
import {
  AppHeader,
  EmptyState,
  Screen,
  Skeleton,
} from '../components/ui';
import { Icon, ICON_SIZE, type IconName } from '../components/icons';

/** In-memory unread set — intentionally not persisted. */
const readIds = new Set<string>();

interface Notification {
  id: string;
  icon: IconName;
  title: string;
  message: string;
  /** Event instant (ms epoch) — used for sorting + relative time. */
  time: number;
  route: Route;
}

const MONTHS_SHORT = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

/** IST clock, Hermes-safe (no Intl timeZone reliance): "12 Oct, 10:00 IST". */
function istClock(d: Date): string {
  const ist = new Date(d.getTime() + 5.5 * 3600 * 1000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${ist.getUTCDate()} ${MONTHS_SHORT[ist.getUTCMonth()]}, ${p(ist.getUTCHours())}:${p(ist.getUTCMinutes())} IST`;
}

function relTime(ts: number, now: number): string {
  const diff = ts - now;
  const abs = Math.abs(diff);
  const m = Math.floor(abs / 60_000);
  const h = Math.floor(m / 60);
  const d = Math.floor(h / 24);
  const s = d > 0 ? `${d}d` : h > 0 ? `${h}h ${m % 60}m` : `${m}m`;
  return diff >= 0 ? `in ${s}` : `${s} ago`;
}

function isDateISO(iso: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(iso);
}

function todayISO(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

async function buildNotifications(): Promise<Notification[]> {
  const now = Date.now();
  const today = todayISO();
  const out: Notification[] = [];
  const [trips, pnrs, passengers, creds] = await Promise.all([
    loadTrips(),
    loadPnrs(),
    loadPassengers(),
    loadIrctcCredentials(),
  ]);

  // Tatkal windows for upcoming Tatkal-quota trips (real window math).
  for (const t of trips) {
    if (!isDateISO(t.journeyDate) || t.journeyDate < today) continue;
    if (!isTatkalQuota(t.quota)) continue;
    let open: Date;
    try {
      open = tatkalBookingOpen(t.journeyDate, t.isAC, TATKAL_TIMING);
    } catch {
      continue; // malformed journey date: skip, never crash the list
    }
    const openMs = open.getTime();
    const label = `${t.trainNo} · ${t.from} → ${t.to} · ${t.classCode}`;
    if (openMs > now && openMs - now <= 7 * 24 * 3_600_000) {
      out.push({
        id: `tatkal-${t.id}`,
        icon: 'clock',
        title: `Tatkal window opens ${relTime(openMs, now)}`,
        message: `${label}. The window opens ${istClock(open)} — be ready on IRCTC's site. The app never books for you.`,
        time: openMs,
        route: { name: 'tripSetup', tripId: t.id },
      });
    } else if (openMs <= now && now - openMs <= 24 * 3_600_000) {
      out.push({
        id: `tatkal-open-${t.id}`,
        icon: 'clock',
        title: `Tatkal window opened ${relTime(openMs, now)}`,
        message: `${label}. The window opened at ${istClock(open)} — complete your booking on IRCTC's site.`,
        time: openMs,
        route: { name: 'tripSetup', tripId: t.id },
      });
    }
  }

  // Chart-preparation hints for tracked PNRs with a future departure.
  for (const p of pnrs) {
    if (!p.departureISO) continue;
    let firstChart: Date;
    try {
      firstChart = chartReminderTimes(p.departureISO).firstChart;
    } catch {
      continue;
    }
    const fc = firstChart.getTime();
    if (fc > now && fc - now <= 48 * 3_600_000) {
      out.push({
        id: `chart-${p.id}`,
        icon: 'info',
        title: `Chart preparation soon — PNR ${p.pnr}`,
        message: `The first chart is usually prepared around ${istClock(firstChart)} (about 4 hours before departure). Timings vary — check IRCTC for the live status.`,
        time: fc,
        route: { name: 'pnr' },
      });
    }
  }

  // Readiness gaps that really exist.
  if (passengers.length === 0) {
    out.push({
      id: 'gap-passengers',
      icon: 'users',
      title: 'Add your passengers',
      message: 'Save passenger details once — the app fills them into IRCTC\'s form for you at booking time.',
      time: now,
      route: { name: 'passengers' },
    });
  }
  if (!creds) {
    out.push({
      id: 'gap-irctc',
      icon: 'lock',
      title: 'Save your IRCTC login',
      message: 'Stored encrypted on this device and filled into IRCTC\'s official login page only.',
      time: now,
      route: { name: 'irctcAccount' },
    });
  }
  for (const t of trips) {
    if (!isDateISO(t.journeyDate) || t.journeyDate < today) continue;
    if (t.passengerIds.length === 0) {
      out.push({
        id: `gap-trippax-${t.id}`,
        icon: 'ticket',
        title: `Trip ${t.from} → ${t.to} has no passengers`,
        message: `Attach passengers to your ${t.trainNo} trip so the booking-day checklist is complete.`,
        time: now,
        route: { name: 'tripSetup', tripId: t.id },
      });
    }
  }

  out.sort((a, b) => a.time - b.time);
  return out;
}

export default function NotificationsScreen({ nav }: { nav: Nav }) {
  const { theme } = useTheme();
  const s = styles(theme);
  const [items, setItems] = useState<Notification[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [, setTick] = useState(0);
  const bump = useCallback(() => setTick((n) => n + 1), []);

  const reload = useCallback(async () => {
    setItems(await buildNotifications());
    setLoaded(true);
  }, []);
  useFocusLoad(reload);

  const unread = items.filter((n) => !readIds.has(n.id));

  const openNotif = (n: Notification) => {
    readIds.add(n.id);
    bump();
    nav.go(n.route);
  };

  const markAllRead = () => {
    items.forEach((n) => readIds.add(n.id));
    bump();
  };

  const now = Date.now();

  return (
    <Screen>
      <AppHeader
        title="Notifications"
        subtitle="From your trips and PNRs, on this phone"
        onBack={nav.back}
        actions={unread.length > 0 ? [{ icon: 'check', label: 'Mark all notifications as read', onPress: markAllRead }] : []}
      />

      {!loaded ? (
        <View style={s.loading}>
          <Skeleton height={84} />
          <Skeleton height={84} style={s.loadingGap} />
          <Skeleton height={84} style={s.loadingGap} />
        </View>
      ) : items.length === 0 ? (
        <EmptyState
          icon="bell"
          title="You're all caught up"
          message="Reminders appear here when you have upcoming trips, saved PNRs, or setup left to finish."
        />
      ) : (
        items.map((n) => {
          const isUnread = !readIds.has(n.id);
          return (
            <Pressable
              key={n.id}
              onPress={() => openNotif(n)}
              accessibilityRole="button"
              accessibilityLabel={`${n.title}. ${n.message}`}
              style={({ pressed }) => [s.row, pressed && s.rowPressed]}
            >
              <View style={s.iconWrap}>
                <Icon name={n.icon} size={ICON_SIZE.sm} color={theme.colors.primary} accessibilityLabel={n.title} />
              </View>
              <View style={s.textWrap}>
                <View style={s.titleRow}>
                  {isUnread && <View style={s.dot} accessibilityLabel="Unread" />}
                  <Text style={s.title} numberOfLines={2}>{n.title}</Text>
                </View>
                <Text style={s.message} numberOfLines={3}>{n.message}</Text>
                <Text style={s.time}>{relTime(n.time, now)}</Text>
              </View>
              <Icon name="chevronRight" size={ICON_SIZE.sm} color={theme.colors.faint} accessibilityLabel="" />
            </Pressable>
          );
        })
      )}

    </Screen>
  );
}

const styles = (theme: Theme) => StyleSheet.create({
  loading: { marginTop: theme.spacing.md },
  loadingGap: { marginTop: theme.spacing.sm },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.md,
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.md,
    padding: theme.spacing.md,
    marginBottom: theme.spacing.sm,
    minHeight: 56,
  },
  rowPressed: { opacity: 0.7 },
  iconWrap: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: theme.colors.primaryTint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  textWrap: { flex: 1 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: theme.colors.primary },
  title: {
    flex: 1,
    color: theme.colors.ink,
    fontSize: theme.typography.body.size,
    fontWeight: '700',
    lineHeight: theme.typography.body.lineHeight,
  },
  message: {
    color: theme.colors.muted,
    fontSize: theme.typography.bodySm.size,
    lineHeight: theme.typography.bodySm.lineHeight,
    marginTop: 2,
  },
  time: {
    color: theme.colors.faint,
    fontSize: theme.typography.caption.size,
    marginTop: 4,
  },
});
