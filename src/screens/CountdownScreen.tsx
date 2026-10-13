/**
 * Countdown — ticks every second toward the Tatkal window open.
 *
 * QUOTA BRANCHING (user request 2026-09-27): the countdown + FIRE wait
 * exists ONLY for TATKAL / PREMIUM TATKAL quotas. For any other quota
 * (GENERAL, LADIES, …) the screen shows a plain "Book now" button that
 * opens Booking immediately — no waiting.
 *
 * Tatkal quotas:
 * - T-5min: "Warm up IRCTC session" appears → opens the Booking screen
 *   early so the user can log in to IRCTC ahead of time.
 * - At/after open: big FIRE button enables → opens Booking for the fill.
 *
 * The FIRE button enables 2 minutes before the open instant (user request
 * 2026-10-13: open the IRCTC tab before the window). Previously it enabled
 * exactly at the open instant. Rationale: IRCTC's Tatkal form only goes live at :00 sharp;
 * firing early burns the one-shot paced fill against a dead form, and
 * clock-skew guessing adds risk without benefit. If the phone clock is off,
 * the user still sees the live IRCTC page and taps Fill themselves.
 */
import React, { useEffect, useMemo, useState } from 'react';

/** FIRE enables this long before the window opens (user request 2026-10-13). */
export const FIRE_EARLY_MS = 2 * 60_000;
import { Text, View } from 'react-native';
import { useTheme } from '../theme';
import {
  Badge,
  Card,
  Countdown,
  ErrorState,
  GhostButton,
  Icon,
  PrimaryButton,
  ReadinessCard,
  Screen,
  SecondaryButton,
  ICON_SIZE,
} from '../components/ui';
import { TATKAL_TIMING } from '../timingConfig';
import { msUntilTatkalOpen, tatkalBookingOpen } from '../core/timing';
import { isTatkalQuota } from '../core/tatkalConfig';
import { loadIrctcCredentials, loadTrips, type Trip } from '../vaultStore';
import type { Nav } from '../App';

const WARMUP_MS = 5 * 60 * 1000;
const MISSED_AFTER_MS = 3 * 60 * 60 * 1000; // window realistically dead after ~3h

function istString(d: Date): string {
  // IST is UTC+5:30 with no DST — format manually from the UTC instant.
  // (Hermes' Intl timeZone support is unreliable, so toLocaleString with
  // timeZone: 'Asia/Kolkata' can't be trusted on-device.)
  const ist = new Date(d.getTime() + 5.5 * 3600 * 1000);
  const p = (n: number) => String(n).padStart(2, '0');
  const months = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
  ];
  return `${p(ist.getUTCDate())} ${months[ist.getUTCMonth()]} ${p(ist.getUTCHours())}:${p(ist.getUTCMinutes())}`;
}

export default function CountdownScreen({ nav, tripId }: { nav: Nav; tripId: string }) {
  const { theme } = useTheme();
  const ty = theme.typography;
  const [trip, setTrip] = useState<Trip | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [hasLogin, setHasLogin] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    void loadTrips().then((ts) => {
      setTrip(ts.find((t) => t.id === tripId) ?? null);
      setLoaded(true);
    });
    // Read-only readiness check for the "Get ready" checklist below —
    // only a boolean is kept, never the credentials themselves.
    void loadIrctcCredentials().then((c) => setHasLogin(!!c));
  }, [tripId]);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  // Never let a malformed journeyDate throw during render (that would trip
  // the app-level ErrorBoundary and silently dump the user at home).
  const openResult = useMemo(() => {
    if (!trip) return { open: null as Date | null, error: '' };
    try {
      return { open: tatkalBookingOpen(trip.journeyDate, trip.isAC, TATKAL_TIMING), error: '' };
    } catch (e) {
      return { open: null, error: e instanceof Error ? e.message : String(e) };
    }
  }, [trip]);

  if (!loaded) {
    return (
      <Screen scroll={false} padded={false}>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ color: theme.colors.muted, fontSize: ty.body.size }}>Loading trip…</Text>
        </View>
      </Screen>
    );
  }

  if (!trip) {
    return (
      <Screen>
        <View style={{ flex: 1, justifyContent: 'center' }}>
          <ErrorState
            title="Trip not found"
            message="This trip no longer exists — it may have been deleted."
            onRetry={nav.back}
            retryLabel="Back"
            retryIcon="arrowLeft"
          />
        </View>
      </Screen>
    );
  }

  if (openResult.error || !openResult.open) {
    return (
      <Screen>
        <View style={{ flex: 1, justifyContent: 'center' }}>
          <ErrorState
            title="Trip date is invalid"
            message={`This trip's journey date couldn't be read (${openResult.error || 'unknown date'}). Edit the trip and pick the date from the calendar again.`}
            onRetry={nav.back}
            retryLabel="Back"
            retryIcon="arrowLeft"
          />
        </View>
      </Screen>
    );
  }

  const tripCard = (
    <Card variant="elevated" style={{ marginBottom: theme.spacing.md }}>
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <View
          style={{
            width: 48,
            height: 48,
            borderRadius: 24,
            backgroundColor: theme.colors.primaryTint,
            alignItems: 'center',
            justifyContent: 'center',
            marginRight: theme.spacing.md,
          }}
        >
          <Icon name="train" size={ICON_SIZE.md} color={theme.colors.primaryOnTint} accessibilityLabel="Train" />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: ty.h2.size, fontWeight: '800', color: theme.colors.ink }}>
            {trip.trainNo}
          </Text>
          <Text style={{ fontSize: ty.bodySm.size, color: theme.colors.muted }}>
            {trip.from} → {trip.to}
          </Text>
        </View>
        <Badge label={trip.quota ?? 'TATKAL'} variant="primary" />
      </View>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          marginTop: theme.spacing.md,
          paddingTop: theme.spacing.md,
          borderTopWidth: 1,
          borderTopColor: theme.colors.line,
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}>
          <Icon name="calendar" size={ICON_SIZE.xs} color={theme.colors.muted} />
          <Text style={{ marginLeft: 4, fontSize: ty.bodySm.size, color: theme.colors.muted }}>
            {trip.journeyDate}
          </Text>
        </View>
        <Text style={{ fontSize: ty.bodySm.size, fontWeight: '700', color: theme.colors.ink, marginRight: theme.spacing.md }}>
          {trip.classCode}
        </Text>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <Icon name="users" size={ICON_SIZE.xs} color={theme.colors.muted} />
          <Text style={{ marginLeft: 4, fontSize: ty.bodySm.size, color: theme.colors.muted }}>
            {trip.passengerIds.length} pax
          </Text>
        </View>
      </View>
    </Card>
  );

  // Non-Tatkal quotas: no countdown, no FIRE wait — book straight away.
  if (!isTatkalQuota(trip.quota)) {
    return (
      <Screen>
        <View style={{ flex: 1, justifyContent: 'center' }}>
          {tripCard}
          <Text
            style={{
              color: theme.colors.muted,
              fontSize: ty.bodySm.size,
              textAlign: 'center',
              marginBottom: theme.spacing.lg,
            }}
          >
            No Tatkal window for this quota — book anytime.
          </Text>

          <PrimaryButton
            title="Book now — open IRCTC booking"
            icon="ticket"
            size="lg"
            fullWidth
            accessibilityLabel={`Book now — open IRCTC booking for train ${trip.trainNo}`}
            onPress={() => nav.go({ name: 'booking', tripId })}
          />

          <GhostButton
            icon="arrowLeft"
            title="Back"
            accessibilityLabel="Go back"
            onPress={nav.back}
            fullWidth
            style={{ marginTop: theme.spacing.sm }}
          />
        </View>
      </Screen>
    );
  }

  const open = openResult.open;
  const msLeft = msUntilTatkalOpen(trip.journeyDate, trip.isAC, TATKAL_TIMING, new Date(now));

  const isOpen = msLeft <= 0;
  const missed = msLeft < -MISSED_AFTER_MS;
  const showWarmup = !isOpen && msLeft <= WARMUP_MS;
  // User request 2026-10-13: FIRE enables 2 minutes early (9:58 for AC) so
  // the IRCTC tab can be opened and ready before the window.
  const fireEnabled = msLeft <= FIRE_EARLY_MS;

  // Window-state copy for the countdown's state line.
  const windowState: 'far' | 'soon' | 'final' | 'open' =
    isOpen ? 'open' : msLeft <= 60_000 ? 'final' : msLeft <= 10 * 60_000 ? 'soon' : 'far';
  const stateCopy = {
    far: { text: 'Still a while to go — your trip is prepared', variant: 'info' as const },
    soon: { text: 'Under 10 minutes — get ready', variant: 'warn' as const },
    final: { text: 'Under a minute — stay on this screen', variant: 'warn' as const },
    open: { text: 'Window open — this is your final action on IRCTC', variant: 'success' as const },
  }[windowState];

  return (
    <Screen>
      <View style={{ flex: 1, justifyContent: 'center' }}>
        {tripCard}

        {missed ? (
          <ErrorState
            title="Tatkal window likely closed"
            message="Window likely closed — set up the next trip."
            onRetry={nav.back}
            retryLabel="Back"
            retryIcon="arrowLeft"
          />
        ) : (
          <Card variant="elevated" style={{ alignItems: 'center', marginBottom: theme.spacing.md }}>
            <Countdown
              seconds={Math.max(0, msLeft / 1000)}
              size="lg"
              caption={isOpen ? 'Tatkal window is OPEN' : 'Tatkal window opens in'}
              stateText={stateCopy.text}
              stateVariant={stateCopy.variant}
            />
            <Text
              style={{
                marginTop: theme.spacing.md,
                color: theme.colors.muted,
                fontSize: ty.bodySm.size,
              }}
            >
              Window opens {istString(open)} IST
            </Text>
          </Card>
        )}

        {!isOpen && !missed && (
          <View style={{ marginBottom: theme.spacing.md }}>
            <ReadinessCard
              title="Get ready for the window"
              items={[
                { label: `Trip ${trip.trainNo} · ${trip.from} → ${trip.to} prepared`, done: true },
                { label: 'IRCTC login saved on this device', done: hasLogin },
                { label: 'Warm up your IRCTC session in time', done: false },
              ]}
            />
          </View>
        )}

        {showWarmup && !missed && (
          <SecondaryButton
            title="Warm up IRCTC session — log in now, be ready at :00"
            fullWidth
            accessibilityLabel="Warm up IRCTC session — log in now, be ready at window open"
            onPress={() => nav.go({ name: 'booking', tripId })}
            style={{ marginBottom: theme.spacing.sm }}
          />
        )}

        <PrimaryButton
          title={fireEnabled ? 'FIRE — open IRCTC booking' : 'FIRE (enables 2 min before window)'}
          icon="ticket"
          size="lg"
          fullWidth
          disabled={!fireEnabled}
          accessibilityLabel={
            fireEnabled
              ? 'Fire — open IRCTC booking'
              : 'Fire — disabled until 2 minutes before the Tatkal window'
          }
          onPress={() => nav.go({ name: 'booking', tripId })}
          style={{ marginTop: showWarmup && !missed ? 0 : theme.spacing.sm }}
        />
        {!fireEnabled && !missed && (
          <Text
            style={{
              color: theme.colors.muted,
              fontSize: ty.caption.size,
              textAlign: 'center',
              marginTop: theme.spacing.sm,
            }}
          >
            FIRE enables 2 minutes before {istString(open)} IST so you can open
            IRCTC early; the Tatkal form itself goes live at :00.
          </Text>
        )}

        <GhostButton
          icon="arrowLeft"
          title="Back"
          accessibilityLabel="Go back"
          onPress={nav.back}
          fullWidth
          style={{ marginTop: theme.spacing.sm }}
        />
      </View>
    </Screen>
  );
}
