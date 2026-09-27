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
 * The FIRE button enables EXACTLY at the computed open instant — no 60s
 * early-enable. Rationale: IRCTC's Tatkal form only goes live at :00 sharp;
 * firing early burns the one-shot paced fill against a dead form, and
 * clock-skew guessing adds risk without benefit. If the phone clock is off,
 * the user still sees the live IRCTC page and taps Fill themselves.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { C } from '../theme';
import { TATKAL_TIMING } from '../timingConfig';
import { msUntilTatkalOpen, tatkalBookingOpen } from '../core/timing';
import { isTatkalQuota } from '../core/tatkalConfig';
import { loadTrips, type Trip } from '../vaultStore';
import type { Nav } from '../App';

const WARMUP_MS = 5 * 60 * 1000;
const MISSED_AFTER_MS = 3 * 60 * 60 * 1000; // window realistically dead after ~3h

function fmt(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const d = Math.floor(total / 86400);
  const h = Math.floor((total % 86400) / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return d > 0 ? `${d}d ${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(h)}:${pad(m)}:${pad(s)}`;
}

function istString(d: Date): string {
  return d.toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

export default function CountdownScreen({ nav, tripId }: { nav: Nav; tripId: string }) {
  const [trip, setTrip] = useState<Trip | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    void loadTrips().then((ts) => setTrip(ts.find((t) => t.id === tripId) ?? null));
  }, [tripId]);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const open = useMemo(
    () => (trip ? tatkalBookingOpen(trip.journeyDate, trip.isAC, TATKAL_TIMING) : null),
    [trip],
  );
  const msLeft =
    trip && open
      ? msUntilTatkalOpen(trip.journeyDate, trip.isAC, TATKAL_TIMING, new Date(now))
      : null;

  if (!trip || open === null || msLeft === null) {
    return (
      <View style={styles.root}>
        <Text style={styles.muted}>Loading trip…</Text>
      </View>
    );
  }

  // Non-Tatkal quotas: no countdown, no FIRE wait — book straight away.
  if (!isTatkalQuota(trip.quota)) {
    return (
      <View style={styles.root}>
        <Text style={styles.title}>
          {trip.trainNo} · {trip.from} → {trip.to}
        </Text>
        <Text style={styles.sub}>
          {trip.journeyDate} · {trip.classCode} · {trip.quota} ·{' '}
          {trip.passengerIds.length} pax
        </Text>
        <Text style={styles.sub}>No Tatkal window for this quota — book anytime.</Text>

        <TouchableOpacity
          style={styles.fire}
          onPress={() => nav.go({ name: 'booking', tripId })}
        >
          <Text style={styles.fireText}>🎫 Book now — open IRCTC booking</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.back} onPress={nav.back}>
          <Text style={styles.backText}>← Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const isOpen = msLeft <= 0;
  const missed = msLeft < -MISSED_AFTER_MS;
  const showWarmup = !isOpen && msLeft <= WARMUP_MS;

  return (
    <View style={styles.root}>
      <Text style={styles.title}>
        {trip.trainNo} · {trip.from} → {trip.to}
      </Text>
      <Text style={styles.sub}>
        {trip.journeyDate} · {trip.classCode} · {trip.quota} ·{' '}
        {trip.passengerIds.length} pax
      </Text>
      <Text style={styles.sub}>Window opens {istString(open)} IST</Text>

      <View style={styles.clockWrap}>
        {missed ? (
          <Text style={styles.missed}>Window likely closed — set up the next trip.</Text>
        ) : isOpen ? (
          <Text style={styles.openText}>TATKAL WINDOW OPEN</Text>
        ) : (
          <>
            <Text style={styles.clock}>{fmt(msLeft)}</Text>
            <Text style={styles.muted}>until the window opens</Text>
          </>
        )}
      </View>

      {showWarmup && !missed && (
        <TouchableOpacity
          style={styles.warmup}
          onPress={() => nav.go({ name: 'booking', tripId })}
        >
          <Text style={styles.warmupText}>
            Warm up IRCTC session — log in now, be ready at :00
          </Text>
        </TouchableOpacity>
      )}

      <TouchableOpacity
        style={[styles.fire, !isOpen && styles.fireDisabled]}
        disabled={!isOpen}
        onPress={() => nav.go({ name: 'booking', tripId })}
      >
        <Text style={[styles.fireText, !isOpen && styles.fireTextDisabled]}>
          {isOpen ? '🔥 FIRE — open IRCTC booking' : 'FIRE (enables at window open)'}
        </Text>
      </TouchableOpacity>
      {!isOpen && !missed && (
        <Text style={styles.note}>
          FIRE enables exactly at {istString(open)} IST — no early fire; the
          Tatkal form only goes live at :00.
        </Text>
      )}

      <TouchableOpacity style={styles.back} onPress={nav.back}>
        <Text style={styles.backText}>← Back</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg, padding: 16, justifyContent: 'center' },
  title: { color: C.ink, fontSize: 20, fontWeight: '800', textAlign: 'center' },
  sub: { color: C.muted, fontSize: 13, textAlign: 'center', marginTop: 4 },
  clockWrap: { alignItems: 'center', marginVertical: 36 },
  clock: { color: C.lime, fontSize: 52, fontWeight: '800', fontVariant: ['tabular-nums'] },
  muted: { color: C.muted, fontSize: 14, textAlign: 'center' },
  openText: { color: C.lime, fontSize: 26, fontWeight: '800', textAlign: 'center' },
  missed: { color: C.danger, fontSize: 16, textAlign: 'center' },
  warmup: {
    borderColor: C.lime, borderWidth: 1, borderRadius: 10,
    padding: 14, alignItems: 'center', marginBottom: 10,
  },
  warmupText: { color: C.lime, fontSize: 14, fontWeight: '700', textAlign: 'center' },
  fire: {
    backgroundColor: C.lime, borderRadius: 12, padding: 18, alignItems: 'center',
  },
  fireDisabled: { backgroundColor: C.card, borderColor: C.line, borderWidth: 1 },
  fireText: { color: C.bg, fontSize: 18, fontWeight: '800' },
  fireTextDisabled: { color: C.muted },
  note: { color: C.muted, fontSize: 12, textAlign: 'center', marginTop: 10 },
  back: { alignItems: 'center', padding: 14, marginTop: 8 },
  backText: { color: C.ink, fontSize: 14, fontWeight: '600' },
});
