/**
 * BookScreen — Wave 2a (brief §43). The Book tab.
 *
 * No fake data anywhere: everything is derived from the encrypted vault.
 * - No trips → "Prepare your first trip" + Create Trip CTA.
 * - Trips → the next upcoming trip card + a readiness checklist + a
 *   contextual CTA: "Prepare trip" (→ tripSetup) when something is missing,
 *   "Start booking" (→ booking) when the trip is fully prepared, with the
 *   complementary action ("Open countdown" / "Review trip") as secondary.
 */
import React, { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet, View } from 'react-native';
import type { Nav } from '../App';
import { useTheme } from '../theme';
import {
  AppHeader,
  EmptyState,
  GhostButton,
  PrimaryButton,
  ReadinessCard,
  Screen,
  SecondaryButton,
  SectionHeader,
  TripCard,
} from '../components/ui';
import {
  loadIrctcCredentials,
  loadTrips,
  saveTrips,
  type Trip,
} from '../vaultStore';
import { useFocusLoad } from './hooks';

const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

function fmtDate(iso: string): string {
  const parts = iso.split('-').map(Number);
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) return iso;
  const [y, m, d] = parts;
  if (m < 1 || m > 12) return iso;
  return `${MONTHS[m - 1]} ${d}, ${y}`;
}

function todayLocal(): string {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

interface BookState {
  loaded: boolean;
  trips: Trip[];
  irctcUsername: string | null;
}

export default function BookScreen({ nav }: { nav: Nav }) {
  const { theme } = useTheme();
  const [state, setState] = useState<BookState>({ loaded: false, trips: [], irctcUsername: null });

  const reload = useCallback(async () => {
    try {
      const [trips, creds] = await Promise.all([
        loadTrips(),
        loadIrctcCredentials(),
      ]);
      // loadPassengers isn't needed for counts — trips carry passengerIds.
      setState({
        loaded: true,
        trips,
        irctcUsername: creds?.username?.trim() || null,
      });
    } catch {
      setState({ loaded: false, trips: [], irctcUsername: null });
    }
  }, []);
  useFocusLoad(reload);

  const removeTrip = useCallback(
    (item: Trip) => {
      Alert.alert(
        'Delete trip?',
        `Delete the ${item.trainNo} trip on ${fmtDate(item.journeyDate)} (${item.from} → ${item.to})? This can't be undone.`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Delete',
            style: 'destructive',
            onPress: () => {
              void (async () => {
                const next = state.trips.filter((t) => t.id !== item.id);
                setState((s) => ({ ...s, trips: next }));
                await saveTrips(next);
              })();
            },
          },
        ],
      );
    },
    [state.trips],
  );

  if (!state.loaded) {
    return (
      <Screen>
        <View style={styles.loading}>
          <ActivityIndicator
            size="large"
            color={theme.colors.primary}
            accessibilityLabel="Loading trips"
          />
        </View>
      </Screen>
    );
  }

  /* ------------------------------- empty ------------------------------- */
  if (state.trips.length === 0) {
    return (
      <Screen>
        <AppHeader title="Book" subtitle="Your assisted Tatkal booking" />
        <EmptyState
          icon="train"
          title="Prepare your first trip"
          message="Save your train, date and travellers once — then the Tatkal window becomes a calm, prepared attempt instead of a scramble."
          actionLabel="Create trip"
          onAction={() => nav.go({ name: 'tripSetup' })}
        />
      </Screen>
    );
  }

  /* --------------------------- next trip card --------------------------- */
  const sorted = [...state.trips].sort((a, b) =>
    a.journeyDate < b.journeyDate ? -1 : a.journeyDate > b.journeyDate ? 1 : 0,
  );
  const today = todayLocal();
  const next = sorted.find((t) => t.journeyDate >= today) ?? sorted[sorted.length - 1];
  const rest = sorted.filter((t) => t.id !== next.id);

  const items = [
    { label: 'Train and journey date set', done: !!next.trainNo && !!next.journeyDate },
    {
      label: `Passengers added (${next.passengerIds.length})`,
      done: next.passengerIds.length > 0,
    },
    { label: 'Contact mobile added', done: next.contactMobile.trim().length > 0 },
    { label: 'IRCTC username saved', done: state.irctcUsername !== null },
  ];
  const ready = items.every((i) => i.done);
  const needsPrep = next.passengerIds.length === 0 || next.contactMobile.trim().length === 0;

  return (
    <Screen>
      <AppHeader title="Book" subtitle="Your assisted Tatkal booking" />
      <TripCard
        fromLabel={next.from}
        toLabel={next.to}
        dateLabel={fmtDate(next.journeyDate)}
        trainLabel={`${next.trainNo} · ${next.classCode} · ${next.quota ?? 'TATKAL'}`}
        onEdit={() => nav.go({ name: 'tripSetup', tripId: next.id })}
        onDelete={() => removeTrip(next)}
      />
      <View style={styles.gap} />
      <ReadinessCard title="Booking readiness" items={items} />
      <View style={styles.cta}>
        {needsPrep ? (
          <>
            <PrimaryButton
              title="Prepare trip"
              onPress={() => nav.go({ name: 'tripSetup', tripId: next.id })}
              fullWidth
              size="lg"
            />
            <View style={styles.gapSm} />
            <SecondaryButton
              title="Open countdown"
              onPress={() => nav.go({ name: 'countdown', tripId: next.id })}
              fullWidth
            />
          </>
        ) : (
          <>
            <PrimaryButton
              title={ready ? 'Start booking' : 'Continue booking'}
              onPress={() => nav.go({ name: 'booking', tripId: next.id })}
              fullWidth
              size="lg"
            />
            <View style={styles.gapSm} />
            <SecondaryButton
              title="Open countdown"
              onPress={() => nav.go({ name: 'countdown', tripId: next.id })}
              fullWidth
            />
          </>
        )}
      </View>
      {rest.length > 0 && (
        <View style={styles.rest}>
          <SectionHeader
            title="Other saved trips"
            subtitle={`${rest.length} more`}
          />
          {rest.map((t) => (
            <View key={t.id} style={styles.restCard}>
              <TripCard
                fromLabel={t.from}
                toLabel={t.to}
                dateLabel={fmtDate(t.journeyDate)}
                trainLabel={`${t.trainNo} · ${t.classCode}`}
                onEdit={() => nav.go({ name: 'tripSetup', tripId: t.id })}
              />
            </View>
          ))}
        </View>
      )}
      <View style={styles.gap} />
      <GhostButton title="Prepare another trip" onPress={() => nav.go({ name: 'tripSetup' })} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 48 },
  gap: { height: 12 },
  gapSm: { height: 8 },
  cta: { marginTop: 16 },
  rest: { marginTop: 20 },
  restCard: { marginBottom: 8 },
});
