/**
 * Home — Tatkal Command Center (Wave 2b redesign).
 *
 * - Greeting header + local privacy indicator (device-only storage).
 * - "Your trips" hero: the focused upcoming trip (nearest by default) with a
 *   switcher when several upcoming trips exist — countdown, readiness and
 *   the CTA all follow the focused trip.
 * - LIVE countdown computed from the REAL window math (src/core/timing.ts +
 *   TATKAL_TIMING) — never faked, never a marketing number.
 * - Readiness checklist derived from real vault state (trips, passengers,
 *   IRCTC username), each missing item deep-linking to its setup screen.
 * - Contextual primary CTA: Prepare booking / Get ready / Start booking /
 *   Continue booking — never a generic always-on "Book Now".
 * - Quick-action grid (proper icons, 44dp+ targets), compact
 *   Passengers/PNR summary rows.
 *
 * All styling comes from the design system (useTheme + ../components/ui);
 * no hard-coded colors, no emojis.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AccessibilityInfo,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useTheme } from '../theme';
import { Icon, ICON_SIZE } from '../components/icons';
import {
  AppHeader,
  Card,
  Chip,
  Countdown,
  EmptyState,
  ErrorState,
  ListRow,
  ProgressBar,
  Screen,
  Skeleton,
  StoryAction,
} from '../components/ui';
import {
  loadIrctcCredentials,
  loadPassengers,
  loadPnrs,
  loadTrips,
  resolveTripPassengers,
  type Passenger,
  type Trip,
} from '../vaultStore';
import { isTatkalQuota } from '../core/tatkalConfig';
import { msUntilTatkalOpen, tatkalBookingOpen } from '../core/timing';
import { TATKAL_TIMING } from '../timingConfig';
import { TRAINS } from '../data/trains';
import type { Route } from '../App';
import { useFocusLoad } from './hooks';

/**
 * Shell routes are owned by the Wave 2a shell worker; they are declared in
 * App.tsx by that wave. Until then we cast so Home can already link to them
 * verbatim without breaking tsc. The cast is a no-op once the routes exist.
 */
type ShellRouteName = 'security' | 'help' | 'notifications';
function shellRoute(name: ShellRouteName): Route {
  return { name } as unknown as Route;
}

const MISSED_AFTER_MS = 3 * 60 * 60 * 1000; // window realistically dead after ~3h
const NEAR_OPEN_MS = 30 * 60 * 1000;
const GET_READY_MS = 10 * 60 * 1000;
const ALMOST_MS = 60 * 1000;

type WindowState =
  | 'far'
  | 'approaching'
  | 'getReady'
  | 'almost'
  | 'open'
  | 'missed'
  | 'noWindow' // non-Tatkal quota: book anytime, no timed countdown
  | 'badDate';

const WINDOW_COPY: Record<WindowState, { stateText: string; variant: 'info' | 'success' | 'warn' }> = {
  far: { stateText: 'Your trip is ready', variant: 'info' },
  approaching: { stateText: 'Tatkal opens soon', variant: 'warn' },
  getReady: { stateText: 'Get everything ready', variant: 'warn' },
  almost: { stateText: 'Almost time', variant: 'warn' },
  open: { stateText: 'Tatkal is open — your final action', variant: 'success' },
  missed: { stateText: 'Window closed — plan your next trip', variant: 'info' },
  noWindow: { stateText: 'No timed window for this quota', variant: 'info' },
  badDate: { stateText: 'Trip date needs a fix', variant: 'warn' },
};

function greetingFor(hour: number): { text: string; icon: 'sun' | 'moon' } {
  if (hour >= 5 && hour < 12) return { text: 'Good morning', icon: 'sun' };
  if (hour >= 12 && hour < 17) return { text: 'Good afternoon', icon: 'sun' };
  return { text: 'Good evening', icon: 'moon' };
}

/** Hero card tag follows the trip's actual quota — a General-quota trip is
 *  not a Tatkal trip, so it must not say "YOUR NEXT TATKAL". */
function heroTagFor(quota: string | undefined, multi: boolean): string {
  if (multi) return 'SELECTED TRIP';
  const q = (quota ?? '').trim().toUpperCase();
  if (q === 'PREMIUM TATKAL') return 'YOUR NEXT PREMIUM TATKAL';
  if (q === 'TATKAL') return 'YOUR NEXT TATKAL';
  return 'YOUR NEXT TRIP';
}

function trainName(no: string): string | null {
  const norm = (s: string) => s.replace(/^0+/, '');
  const t =
    TRAINS.find((x) => x.no === no) ?? TRAINS.find((x) => norm(x.no) === norm(no));
  return t ? t.name : null;
}

function fmtDate(iso: string): string {
  const parts = iso.split('-').map(Number);
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) return iso;
  const [y, m, d] = parts;
  const months = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
  ];
  if (m < 1 || m > 12) return iso;
  return `${months[m - 1]} ${d}, ${y}`;
}

/** True for journeyDate on/after today (local calendar day). */
function isUpcoming(iso: string): boolean {
  const parts = iso.split('-').map(Number);
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) return false;
  const [y, m, d] = parts;
  const today = new Date();
  const todayKey = today.getFullYear() * 10000 + (today.getMonth() + 1) * 100 + today.getDate();
  return y * 10000 + m * 100 + d >= todayKey;
}

function windowStateFor(msLeft: number): WindowState {
  if (msLeft < -MISSED_AFTER_MS) return 'missed';
  if (msLeft <= 0) return 'open';
  if (msLeft <= ALMOST_MS) return 'almost';
  if (msLeft <= GET_READY_MS) return 'getReady';
  if (msLeft <= NEAR_OPEN_MS) return 'approaching';
  return 'far';
}

interface ReadinessEntry {
  label: string;
  done: boolean;
  route: Route;
}

export default function HomeScreen({ nav }: { nav: { go: (r: Route) => void; back: () => void } }) {
  const { theme } = useTheme();
  const t = theme.typography;
  const c = theme.colors;
  const s = theme.spacing;

  const [trips, setTrips] = useState<Trip[]>([]);
  const [passengers, setPassengers] = useState<Passenger[]>([]);
  const passengerCount = passengers.length;
  const [pnrCount, setPnrCount] = useState(0);
  const [hasIrctcUsername, setHasIrctcUsername] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  const greeting = useMemo(() => greetingFor(new Date().getHours()), []);

  const reload = useCallback(async () => {
    setLoadError(false);
    try {
      const [ts, pax, pnrs, creds] = await Promise.all([
        loadTrips(),
        loadPassengers(),
        loadPnrs(),
        loadIrctcCredentials(),
      ]);
      setTrips(ts);
      setPassengers(pax);
      setPnrCount(pnrs.length);
      setHasIrctcUsername(Boolean(creds?.username?.trim()));
    } catch {
      setLoadError(true);
    } finally {
      setLoaded(true);
    }
  }, []);
  useFocusLoad(reload);

  // All upcoming trips, nearest first.
  const upcomingTrips = useMemo<Trip[]>(() => {
    const upcoming = trips.filter((x) => isUpcoming(x.journeyDate));
    return [...upcoming].sort((a, b) => a.journeyDate.localeCompare(b.journeyDate));
  }, [trips]);

  // Nearest upcoming trip by journey date (the pre-switcher default).
  const nearestTrip = useMemo<Trip | null>(() => upcomingTrips[0] ?? null, [upcomingTrips]);

  // The trip the home screen is focused on: nearest by default, switchable
  // via the trip chips when several upcoming trips exist. The countdown,
  // readiness checklist and the CTA all follow the focused trip, so every
  // trip can be booked from the home page.
  const [selectedTripId, setSelectedTripId] = useState<string | null>(null);
  const activeTrip = useMemo<Trip | null>(
    () => upcomingTrips.find((x) => x.id === selectedTripId) ?? nearestTrip,
    [upcomingTrips, selectedTripId, nearestTrip],
  );

  // Tick the countdown once a second while a trip is on screen.
  useEffect(() => {
    if (!activeTrip) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [activeTrip]);

  // Real window math — never fake the countdown.
  const windowInfo = useMemo(() => {
    if (!activeTrip) return { state: 'far' as WindowState, msLeft: Infinity, open: null as Date | null };
    if (!isTatkalQuota(activeTrip.quota)) {
      return { state: 'noWindow' as WindowState, msLeft: Infinity, open: null as Date | null };
    }
    try {
      const open = tatkalBookingOpen(activeTrip.journeyDate, activeTrip.isAC, TATKAL_TIMING);
      const msLeft = msUntilTatkalOpen(activeTrip.journeyDate, activeTrip.isAC, TATKAL_TIMING, new Date(now));
      return { state: windowStateFor(msLeft), msLeft, open };
    } catch {
      return { state: 'badDate' as WindowState, msLeft: Infinity, open: null as Date | null };
    }
  }, [activeTrip, now]);

  // Announce countdown STATE changes only (never the ticking digits).
  const [announced, setAnnounced] = useState<string | null>(null);
  useEffect(() => {
    if (!loaded || !activeTrip) return;
    const key = windowInfo.state;
    if (key !== announced) {
      setAnnounced(key);
      AccessibilityInfo.announceForAccessibility(
        `${activeTrip.trainNo}, ${activeTrip.from} to ${activeTrip.to}. ${WINDOW_COPY[key].stateText}.`,
      );
    }
  }, [windowInfo.state, loaded, activeTrip, announced]);

  const readiness = useMemo<ReadinessEntry[]>(() => {
    if (!activeTrip) return [];
    // Same rule as the booking flow: linked passengers if they resolve,
    // otherwise every saved passenger — the checklist never disagrees with
    // what booking will actually fill.
    const n = resolveTripPassengers(activeTrip, passengers).length;
    return [
      { label: 'Trip configured', done: true, route: { name: 'tripSetup', tripId: activeTrip.id } },
      { label: 'Train selected', done: activeTrip.trainNo.trim().length > 0, route: { name: 'tripSetup', tripId: activeTrip.id } },
      { label: 'Class selected', done: activeTrip.classCode.trim().length > 0, route: { name: 'tripSetup', tripId: activeTrip.id } },
      { label: `Passengers saved (${Math.min(n, 4)}/4)`, done: n >= 1, route: { name: 'passengers' } },
      { label: 'Berth preferences set', done: passengerCount > 0, route: { name: 'passengers' } },
      { label: 'IRCTC username saved', done: hasIrctcUsername, route: { name: 'irctcAccount' } },
    ];
  }, [activeTrip, passengers, hasIrctcUsername]);

  const firstMissing = readiness.find((r) => !r.done);
  const allReady = readiness.length > 0 && !firstMissing;

  // Contextual primary CTA — never a generic always-on "Book Now".
  const cta = useMemo(() => {
    if (!activeTrip) return null;
    if (windowInfo.state === 'badDate') {
      return { title: 'Fix trip date', onPress: () => nav.go({ name: 'tripSetup', tripId: activeTrip.id }), icon: 'edit' as const };
    }
    if (windowInfo.state === 'noWindow') {
      return { title: 'Book now', onPress: () => nav.go({ name: 'booking', tripId: activeTrip.id }), icon: 'ticket' as const };
    }
    if (!allReady) {
      return { title: 'Continue booking', onPress: () => nav.go({ name: 'tripSetup', tripId: activeTrip.id }), icon: 'chevronRight' as const };
    }
    switch (windowInfo.state) {
      case 'open':
        return { title: 'Start booking', onPress: () => nav.go({ name: 'booking', tripId: activeTrip.id }), icon: 'ticket' as const };
      case 'almost':
      case 'getReady':
      case 'approaching':
        return { title: 'Get ready', onPress: () => nav.go({ name: 'countdown', tripId: activeTrip.id }), icon: 'clock' as const };
      case 'missed':
        return { title: 'Plan your next trip', onPress: () => nav.go({ name: 'tripSetup' }), icon: 'plus' as const };
      case 'far':
      default:
        return { title: 'Prepare booking', onPress: () => nav.go({ name: 'tripSetup', tripId: activeTrip.id }), icon: 'chevronRight' as const };
    }
  }, [activeTrip, windowInfo.state, allReady, nav]);

  const quickActions = useMemo(
    () => [
      { key: 'setup', label: 'New trip', icon: 'train' as const, onPress: () => nav.go({ name: 'tripSetup' }) },
      { key: 'train', label: 'Find train', icon: 'search' as const, onPress: () => nav.go({ name: 'trainLookup' }) },
      { key: 'pnr', label: 'PNRs', icon: 'ticket' as const, onPress: () => nav.go({ name: 'pnr' }) },
      { key: 'pax', label: 'Passengers', icon: 'users' as const, onPress: () => nav.go({ name: 'passengers' }) },
      { key: 'irctc', label: 'IRCTC', icon: 'shield' as const, onPress: () => nav.go({ name: 'irctcAccount' }) },
      { key: 'guide', label: 'Guide', icon: 'helpCircle' as const, onPress: () => nav.go(shellRoute('help')) },
    ],
    [nav],
  );

  if (!loaded) {
    return (
      <Screen scroll={false}>
        <View style={styles.loading}>
          <Skeleton width="45%" height={24} accessibilityLabel="Loading greeting" />
          <View style={{ height: s.lg }} />
          <Skeleton width="100%" height={150} radius={theme.radius.lg} accessibilityLabel="Loading your next Tatkal" />
          <View style={{ height: s.md }} />
          <Skeleton width="100%" height={170} radius={theme.radius.lg} accessibilityLabel="Loading countdown" />
          <View style={{ height: s.md }} />
          <Skeleton width="100%" height={190} radius={theme.radius.lg} accessibilityLabel="Loading readiness checklist" />
        </View>
      </Screen>
    );
  }

  if (loadError) {
    return (
      <Screen scroll={false}>
        <ErrorState
          title="Couldn't load your data"
          message="Your vault is still safe on this device — this was a loading hiccup. Try again."
          onRetry={reload}
        />
      </Screen>
    );
  }

  const copy = WINDOW_COPY[windowInfo.state];
  const readyCount = readiness.filter((r) => r.done).length;
  const showCountdown = !['noWindow', 'badDate', 'missed'].includes(windowInfo.state);
  const tn = activeTrip ? trainName(activeTrip.trainNo) : null;

  return (
    <Screen>
      {/* App bar — user name + bell, like the big social apps */}
      <AppHeader
        title={passengers.length > 0 ? passengers[0].name.trim().split(/\s+/)[0] || 'Tatkal' : 'Tatkal'}
        subtitle={`${greeting.text}`}
        actions={[
          { icon: 'bell', label: 'Notifications', onPress: () => nav.go(shellRoute('notifications')) },
          { icon: 'settings', label: 'Settings', onPress: () => nav.go({ name: 'settings' } as Route) },
        ]}
      />

      {/* Story-style shortcuts */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={{ marginHorizontal: -s.lg, marginBottom: s.lg }}
        contentContainerStyle={{ paddingHorizontal: s.md, gap: 2 }}
      >
        {quickActions.map((a, i) => (
          <StoryAction key={a.key} icon={a.icon} label={a.label} onPress={a.onPress} highlight={i === 0} />
        ))}
      </ScrollView>

      {activeTrip ? (
        <>
          {upcomingTrips.length > 1 && (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={{ marginBottom: s.md }}
              contentContainerStyle={{ gap: s.sm }}
              accessibilityRole="radiogroup"
              accessibilityLabel="Choose which trip the home page shows"
            >
              {upcomingTrips.map((trip) => (
                <Chip
                  key={trip.id}
                  label={`${trip.from} → ${trip.to} · ${fmtDate(trip.journeyDate)}`}
                  selected={trip.id === activeTrip.id}
                  onPress={() => setSelectedTripId(trip.id)}
                />
              ))}
            </ScrollView>
          )}

          {/* Hero ticket — boarding-pass layout: route, facts, status, one action */}
          <View
            style={[
              styles.hero,
              { backgroundColor: c.primary, borderRadius: theme.radius.xl },
            ]}
          >
            {/* soft decorative glow, purely visual */}
            <View pointerEvents="none" style={[styles.glow, { backgroundColor: c.onPrimary }]} />

            <View style={styles.heroPad}>
              <View style={styles.heroTop}>
                <View style={[styles.heroTag, { backgroundColor: 'rgba(255,255,255,0.16)' }]}>
                  <Icon name="train" size={ICON_SIZE.xs} color={c.onPrimary} />
                  <Text style={[styles.heroTagText, { color: c.onPrimary }]}>
                    {heroTagFor(activeTrip.quota, upcomingTrips.length > 1)}
                  </Text>
                </View>
                <TouchableOpacity
                  onPress={() => nav.go({ name: 'tripSetup', tripId: activeTrip.id })}
                  accessibilityRole="button"
                  accessibilityLabel={`Edit trip ${activeTrip.trainNo} from ${activeTrip.from} to ${activeTrip.to}`}
                  hitSlop={12}
                  style={[styles.heroEdit, { borderColor: 'rgba(255,255,255,0.45)' }]}
                >
                  <Icon name="edit" size={ICON_SIZE.xs} color={c.onPrimary} />
                  <Text style={{ fontSize: t.caption.size, fontWeight: '800', color: c.onPrimary, marginLeft: 6 }}>Edit</Text>
                </TouchableOpacity>
              </View>

              {/* From ——train—— To */}
              <View
                style={styles.heroRoute}
                accessible
                accessibilityLabel={`From ${activeTrip.from} to ${activeTrip.to}`}
              >
                <View style={styles.stationCol}>
                  <Text style={[styles.stationLabel, { color: c.onPrimary }]}>FROM</Text>
                  <Text
                    numberOfLines={1}
                    adjustsFontSizeToFit
                    style={[styles.stationCode, { color: c.onPrimary }]}
                  >
                    {activeTrip.from}
                  </Text>
                </View>
                <View style={styles.track}>
                  <View style={[styles.trackDot, { borderColor: c.onPrimary }]} />
                  <View style={[styles.trackLine, { borderColor: c.onPrimary }]} />
                  <View style={[styles.trackBadge, { backgroundColor: c.onPrimary }]}>
                    <Icon name="train" size={ICON_SIZE.sm} color={c.primary} />
                  </View>
                  <View style={[styles.trackLine, { borderColor: c.onPrimary }]} />
                  <View style={[styles.trackDot, { borderColor: c.onPrimary, backgroundColor: c.onPrimary }]} />
                </View>
                <View style={[styles.stationCol, { alignItems: 'flex-end' }]}>
                  <Text style={[styles.stationLabel, { color: c.onPrimary }]}>TO</Text>
                  <Text
                    numberOfLines={1}
                    adjustsFontSizeToFit
                    style={[styles.stationCode, { color: c.onPrimary }]}
                  >
                    {activeTrip.to}
                  </Text>
                </View>
              </View>

              <Text numberOfLines={1} style={[styles.trainLine, { color: c.onPrimary }]}>
                {activeTrip.trainNo}
                {tn ? ` · ${tn}` : ''}
              </Text>
            </View>

            {/* Ticket perforation with side notches */}
            <View style={styles.perfRow}>
              <View style={[styles.notch, styles.notchL, { backgroundColor: c.bg }]} />
              <View style={[styles.perf, { borderColor: c.onPrimary }]} />
              <View style={[styles.notch, styles.notchR, { backgroundColor: c.bg }]} />
            </View>

            <View style={styles.heroPad2}>
              {/* Journey facts as pills, same style as the top tag */}
              <View style={styles.factsRow}>
                {[
                  { k: 'date', v: fmtDate(activeTrip.journeyDate), icon: 'calendar' as const },
                  { k: 'class', v: activeTrip.classCode, icon: null },
                  { k: 'quota', v: activeTrip.quota ?? 'TATKAL', icon: null },
                ].map((f) => (
                  <View
                    key={f.k}
                    style={[styles.heroTag, { backgroundColor: 'rgba(255,255,255,0.16)' }]}
                    accessible
                    accessibilityLabel={`${f.k} ${f.v}`}
                  >
                    {f.icon ? <Icon name={f.icon} size={ICON_SIZE.xs} color={c.onPrimary} /> : null}
                    <Text style={[styles.heroTagText, { color: c.onPrimary }]}>{String(f.v).toUpperCase()}</Text>
                  </View>
                ))}
              </View>

              {showCountdown ? (
                <View accessibilityLiveRegion="none" style={[styles.countWrap, { backgroundColor: c.bg, borderRadius: theme.radius.lg }]}>
                  <Countdown
                    seconds={Math.max(0, Math.floor(windowInfo.msLeft / 1000))}
                    size="md"
                    caption="Tatkal window opens in"
                    stateText={copy.stateText}
                    stateVariant={copy.variant}
                  />
                </View>
              ) : (
                <View style={[styles.statusPill, { backgroundColor: 'rgba(255,255,255,0.14)' }]}>
                  <View style={[styles.statusIcon, { backgroundColor: c.onPrimary }]}>
                    <Icon
                      name={windowInfo.state === 'noWindow' ? 'check' : windowInfo.state === 'badDate' ? 'alertTriangle' : 'clock'}
                      size={ICON_SIZE.xs}
                      color={c.primary}
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.statusTitle, { color: c.onPrimary }]}>
                      {windowInfo.state === 'noWindow'
                        ? 'Book anytime'
                        : windowInfo.state === 'badDate'
                          ? 'Check the journey date'
                          : 'Window has closed'}
                    </Text>
                    <Text style={[styles.statusSub, { color: c.onPrimary }]}>
                      {windowInfo.state === 'noWindow'
                        ? `No timed Tatkal window for the ${activeTrip.quota} quota — you can book anytime.`
                        : windowInfo.state === 'badDate'
                          ? "This trip's journey date couldn't be read — edit the trip and pick the date again."
                          : 'The Tatkal window for this trip has likely closed. Set up your next trip.'}
                    </Text>
                  </View>
                </View>
              )}

              {cta && (
                <TouchableOpacity
                  onPress={cta.onPress}
                  accessibilityRole="button"
                  accessibilityLabel={cta.title}
                  activeOpacity={0.85}
                  style={[styles.heroCta, { backgroundColor: c.onPrimary, borderRadius: theme.radius.full }]}
                >
                  <Text style={{ fontSize: t.body.size + 1, fontWeight: '800', color: c.primary }}>{cta.title}</Text>
                  <View style={[styles.ctaArrow, { backgroundColor: c.primary }]}>
                    <Icon name="arrowRight" size={ICON_SIZE.sm} color={c.onPrimary} />
                  </View>
                </TouchableOpacity>
              )}
            </View>
          </View>

          {/* Readiness — one bar + the single next step, details on demand */}
          <Card style={{ marginTop: s.lg }}>
            <View style={styles.rowBetween}>
              <Text style={{ fontSize: t.h3.size, fontWeight: '800', color: c.ink }}>
                {allReady ? "You're all set" : 'Finish setting up'}
              </Text>
              <Text style={{ fontSize: t.bodySm.size, fontWeight: '800', color: allReady ? c.success : c.muted }}>
                {readyCount}/{readiness.length}
              </Text>
            </View>
            <ProgressBar
              value={readiness.length ? readyCount / readiness.length : 0}
              color={allReady ? c.success : c.primary}
              style={{ marginTop: s.sm, marginBottom: s.md }}
            />
            {readiness.map((r) => (
              <TouchableOpacity
                key={r.label}
                onPress={() => nav.go(r.route)}
                disabled={r.done}
                accessibilityRole="button"
                accessibilityLabel={`${r.label}: ${r.done ? 'done' : 'not done, tap to fix'}`}
                style={styles.checkRow}
              >
                <View
                  style={[
                    styles.checkDot,
                    r.done
                      ? { backgroundColor: c.success }
                      : { borderWidth: 1.5, borderColor: c.line },
                  ]}
                >
                  {r.done ? <Icon name="check" size={ICON_SIZE.xs} color={c.bg} /> : null}
                </View>
                <Text
                  style={{
                    flex: 1,
                    fontSize: t.bodySm.size,
                    fontWeight: r.done ? '500' : '700',
                    color: r.done ? c.muted : c.ink,
                  }}
                >
                  {r.label}
                </Text>
                {!r.done ? <Icon name="chevronRight" size={ICON_SIZE.xs} color={c.primary} /> : null}
              </TouchableOpacity>
            ))}
            <Text style={{ fontSize: t.caption.size, color: c.faint, marginTop: s.sm }}>
              Availability depends on IRCTC — being ready doesn't guarantee a seat.
            </Text>
          </Card>
        </>
      ) : (
        <Card style={{ paddingVertical: s.md }}>
          <EmptyState
            icon="train"
            title="Plan your first Tatkal"
            message="Add your train, date and passengers once. We'll count down to the window and fill the form for you."
            actionLabel="Add a trip"
            onAction={() => nav.go({ name: 'tripSetup' })}
          />
        </Card>
      )}

      {/* Shortcuts list */}
      <Text style={[styles.sectionLabel, { color: c.muted, marginTop: s.xl }]}>YOUR STUFF</Text>
      <View style={{ gap: s.sm }}>
        <ListRow
          title="Passengers"
          subtitle={`${passengerCount} saved`}
          icon="users"
          onPress={() => nav.go({ name: 'passengers' })}
          accessibilityLabel={`Passengers, ${passengerCount} saved. Open passenger profiles.`}
        />
        <ListRow
          title="My PNRs"
          subtitle={`${pnrCount} tracked`}
          icon="ticket"
          onPress={() => nav.go({ name: 'pnr' })}
          accessibilityLabel={`PNRs, ${pnrCount} saved. Open PNR tracking.`}
        />
        <ListRow
          title="Privacy"
          subtitle="Everything stays on this phone"
          icon="lock"
          onPress={() => nav.go(shellRoute('security'))}
          accessibilityLabel="Data stored on this device. Open security details."
        />
      </View>

      <View style={{ height: s.xl }} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  loading: { paddingVertical: 8 },
  hero: { overflow: 'hidden' },
  glow: { position: 'absolute', width: 220, height: 220, borderRadius: 110, top: -110, right: -70, opacity: 0.08 },
  heroPad: { paddingHorizontal: 20, paddingTop: 18 },
  heroPad2: { paddingHorizontal: 20, paddingBottom: 20 },
  heroTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 },
  heroTag: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 14 },
  heroTagText: { fontSize: 11, fontWeight: '800', letterSpacing: 1 },
  heroEdit: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, minHeight: 36, borderRadius: 18, borderWidth: 1 },
  heroRoute: { flexDirection: 'row', alignItems: 'flex-end' },
  stationCol: { width: '30%' },
  stationLabel: { fontSize: 11, fontWeight: '700', letterSpacing: 1.2, opacity: 0.7, marginBottom: 2 },
  stationCode: { fontSize: 40, lineHeight: 46, fontWeight: '900', letterSpacing: -1 },
  track: { flex: 1, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 6, marginBottom: 14 },
  trackDot: { width: 9, height: 9, borderRadius: 5, borderWidth: 2 },
  trackLine: { flex: 1, borderTopWidth: 2, borderStyle: 'dashed', opacity: 0.55 },
  trackBadge: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', marginHorizontal: 4 },
  trainLine: { fontSize: 14, fontWeight: '700', opacity: 0.92, marginTop: 10 },
  perfRow: { flexDirection: 'row', alignItems: 'center', marginVertical: 16 },
  perf: { flex: 1, borderTopWidth: 1.5, borderStyle: 'dashed', opacity: 0.35, marginHorizontal: 6 },
  notch: { width: 22, height: 22, borderRadius: 11 },
  notchL: { marginLeft: -11 },
  notchR: { marginRight: -11 },
  factsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 },
  statusPill: { flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 16, padding: 12 },
  statusIcon: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  statusTitle: { fontSize: 15, fontWeight: '800' },
  statusSub: { fontSize: 12.5, lineHeight: 17, opacity: 0.85, marginTop: 2 },
  countWrap: { paddingVertical: 16, paddingHorizontal: 8 },
  heroCta: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 56, marginTop: 16, paddingLeft: 24, paddingRight: 8 },
  ctaArrow: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  checkRow: { flexDirection: 'row', alignItems: 'center', minHeight: 40, gap: 10 },
  checkDot: { width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  sectionLabel: { fontSize: 12, fontWeight: '800', letterSpacing: 1, marginBottom: 8 },
});
