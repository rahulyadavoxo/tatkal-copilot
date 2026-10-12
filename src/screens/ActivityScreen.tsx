/**
 * Bookings (§38) — trip records from the encrypted vault.
 *
 * Tabs: Upcoming / Completed / Cancelled, derived ENTIRELY from saved trips:
 *   - Upcoming: journeyDate >= today (device-local)
 *   - Completed: journeyDate < today
 *   - Cancelled: no source of truth exists on-device (deleted trips are
 *     gone, not archived) — an honest empty state, never invented rows.
 *
 * Honesty rule: the app NEVER books by itself, so these are plans the user
 * prepared — never confirmed seats. No PNR link exists between trips and
 * tracked PNRs, so no PNR is shown unless a real link exists (none does).
 */
import React, { useCallback, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../theme';
import type { Theme } from '../theme';
import { loadTrips, type Trip } from '../vaultStore';
import type { Nav } from '../App';
import { useFocusLoad } from './hooks';
import {
  AppHeader,
  BookingCard,
  Card,
  EmptyState,
  Screen,
  SegmentedControl,
  Skeleton,
} from '../components/ui';
import { Icon, ICON_SIZE } from '../components/icons';

type Tab = 'upcoming' | 'completed' | 'cancelled';

const MONTHS_SHORT = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

function todayISO(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** "2026-10-12" → "12 Oct 2026". Falls back to the raw string on garbage. */
function fmtDay(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  const mo = Number(m[2]);
  if (mo < 1 || mo > 12) return iso;
  return `${Number(m[3])} ${MONTHS_SHORT[mo - 1]} ${m[1]}`;
}

function tripSubtitle(t: Trip): string {
  return `Train ${t.trainNo} · Class ${t.classCode} · ${fmtDay(t.journeyDate)}`;
}

export default function ActivityScreen({ nav }: { nav: Nav }) {
  const { theme } = useTheme();
  const s = styles(theme);
  const [trips, setTrips] = useState<Trip[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [tab, setTab] = useState<Tab>('upcoming');

  const reload = useCallback(async () => {
    setTrips(await loadTrips());
    setLoaded(true);
  }, []);
  useFocusLoad(reload);

  const today = todayISO();
  const upcoming = trips
    .filter((t) => t.journeyDate >= today)
    .sort((a, b) => a.journeyDate.localeCompare(b.journeyDate));
  const completed = trips
    .filter((t) => t.journeyDate < today)
    .sort((a, b) => b.journeyDate.localeCompare(a.journeyDate));

  const goTrip = (tripId: string) => nav.go({ name: 'tripSetup', tripId });

  return (
    <Screen>
      <AppHeader title="Activity" subtitle="Trips you've prepared on this phone" />

      <Card variant="outlined" style={s.honestyCard}>
        <View style={s.honestyRow}>
          <Icon name="info" size={ICON_SIZE.sm} color={theme.colors.muted} accessibilityLabel="Note" />
          <Text style={s.honestyText}>
            The app never books by itself, so nothing here is a confirmed
            booking — these are trip setups you prepared for your own booking
            on IRCTC.
          </Text>
        </View>
      </Card>

      <SegmentedControl<Tab>
        label="Show"
        value={tab}
        onChange={setTab}
        options={[
          { value: 'upcoming', label: 'Upcoming' },
          { value: 'completed', label: 'Completed' },
          { value: 'cancelled', label: 'Cancelled' },
        ]}
      />

      {!loaded ? (
        <View style={s.loading}>
          <Skeleton height={110} />
          <Skeleton height={110} style={s.loadingGap} />
          <Skeleton height={110} style={s.loadingGap} />
        </View>
      ) : tab === 'upcoming' ? (
        upcoming.length === 0 ? (
          <EmptyState
            icon="calendar"
            title="No upcoming trips"
            message="Plan a trip to get a Tatkal countdown and a booking-day checklist."
            actionLabel="Plan a trip"
            onAction={() => nav.go({ name: 'tripSetup' })}
          />
        ) : (
          upcoming.map((t) => (
            <View key={t.id} style={s.cardWrap}>
              <BookingCard
                title={`${t.from} → ${t.to}`}
                subtitle={tripSubtitle(t)}
                status="info"
                statusLabel="Planned trip"
                icon="train"
                onPress={() => goTrip(t.id)}
              />
            </View>
          ))
        )
      ) : tab === 'completed' ? (
        completed.length === 0 ? (
          <EmptyState
            icon="history"
            title="No past trip records"
            message="Trips whose journey date has passed appear here as records."
          />
        ) : (
          completed.map((t) => (
            <View key={t.id} style={s.cardWrap}>
              <BookingCard
                title={`${t.from} → ${t.to}`}
                subtitle={tripSubtitle(t)}
                status="neutral"
                statusLabel="Past trip record"
                icon="train"
                onPress={() => goTrip(t.id)}
              />
            </View>
          ))
        )
      ) : (
        <EmptyState
          icon="ticket"
          title="No cancelled bookings"
          message="There's no record of cancelled bookings on this device — trips you remove are deleted, not tracked as cancelled."
        />
      )}

    </Screen>
  );
}

const styles = (theme: Theme) => StyleSheet.create({
  honestyCard: { marginBottom: theme.spacing.md },
  honestyRow: { flexDirection: 'row', gap: theme.spacing.sm },
  honestyText: {
    flex: 1,
    color: theme.colors.muted,
    fontSize: theme.typography.bodySm.size,
    lineHeight: theme.typography.bodySm.lineHeight,
  },
  cardWrap: { marginBottom: theme.spacing.sm },
  loading: { marginTop: theme.spacing.md },
  loadingGap: { marginTop: theme.spacing.sm },
});
