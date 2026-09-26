/**
 * TripSetup — journey details + class + passenger selection.
 * "Save trip" persists (encrypted) and moves to the Countdown screen.
 *
 * Tatkal PNR cap (MAX_PASSENGERS_PER_TATKAL_PNR = 4) is enforced in the UI:
 * once 4 are selected, the rest disable.
 */
import React, { useCallback, useState } from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { BERTH_LABELS, C } from '../theme';
import { TATKAL_TIMING } from '../timingConfig';
import { tatkalBookingOpen } from '../core/timing';
import {
  MAX_PASSENGERS_PER_TATKAL_PNR,
  TATKAL_AC_CLASSES,
  TATKAL_NONAC_CLASSES,
} from '../core/tatkalConfig';
import {
  loadPassengers,
  loadTrips,
  newId,
  saveTrips,
  type Passenger,
  type Trip,
} from '../vaultStore';
import type { Nav } from '../App';
import { useFocusLoad } from './hooks';
import StationField from './StationField';
import TrainField from './TrainField';
import DatePickerField from './DatePickerField';

export default function TripSetupScreen({ nav }: { nav: Nav }) {
  const [passengers, setPassengers] = useState<Passenger[]>([]);
  const [trainNo, setTrainNo] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [journeyDate, setJourneyDate] = useState('');
  const [classCode, setClassCode] = useState<string>('3A');
  const [selected, setSelected] = useState<string[]>([]);
  const [error, setError] = useState('');

  const reload = useCallback(async () => setPassengers(await loadPassengers()), []);
  useFocusLoad(reload);

  const isAC = (TATKAL_AC_CLASSES as readonly string[]).includes(classCode);

  const togglePax = (id: string) => {
    setSelected((s) =>
      s.includes(id)
        ? s.filter((x) => x !== id)
        : s.length >= MAX_PASSENGERS_PER_TATKAL_PNR
          ? s // cap enforced: ignore taps beyond 4
          : [...s, id],
    );
  };

  const save = async () => {
    setError('');
    const t = trainNo.trim();
    const f = from.trim().toUpperCase();
    const tt = to.trim().toUpperCase();
    const d = journeyDate.trim();
    if (!/^\d{5}$/.test(t)) {
      setError('Train number must be exactly 5 digits — use “Find train number” below if you don’t know it.');
      return;
    }
    if (!f || !tt) {
      setError('Pick the from and to stations from the search list.');
      return;
    }
    if (f === tt) {
      setError('From and to stations can’t be the same.');
      return;
    }
    if (selected.length === 0) {
      setError('Select at least one passenger.');
      return;
    }
    if (!d) {
      setError('Pick the journey date from the calendar.');
      return;
    }
    // Validate the date by running the real window math (throws on bad input).
    try {
      tatkalBookingOpen(d, isAC, TATKAL_TIMING);
    } catch {
      setError('That journey date is outside the booking window.');
      return;
    }
    const trip: Trip = {
      id: newId('trip'),
      trainNo: t,
      from: f,
      to: tt,
      journeyDate: d,
      classCode,
      isAC,
      passengerIds: selected,
      createdAt: Date.now(),
    };
    const trips = await loadTrips();
    try {
      await saveTrips([...trips, trip]);
    } catch (e) {
      setError(
        'Could not save the trip — storage unavailable. ' +
          String(e instanceof Error ? e.message : e),
      );
      return;
    }
    nav.go({ name: 'countdown', tripId: trip.id });
  };

  const capHit = selected.length >= MAX_PASSENGERS_PER_TATKAL_PNR;

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={styles.inner}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={styles.title}>New trip</Text>

      <TrainField
        label="Train"
        value={trainNo}
        onSelect={setTrainNo}
        placeholder="Type train name or number…"
      />
      <TouchableOpacity onPress={() => nav.go({ name: 'trainLookup' })}>
        <Text style={styles.link}>🔍 Train not in the list? Find it on IRCTC →</Text>
      </TouchableOpacity>

      <StationField label="From" value={from} onSelect={setFrom} placeholder="Type station name or code…" />
      <StationField label="To" value={to} onSelect={setTo} placeholder="Type station name or code…" />

      <DatePickerField label="Journey date" value={journeyDate} onSelect={setJourneyDate} />

      <Text style={styles.label}>Class — AC opens 10:00, Non-AC opens 11:00 IST</Text>
      <Text style={styles.groupLabel}>AC classes</Text>
      <View style={styles.chips}>
        {TATKAL_AC_CLASSES.map((c) => (
          <TouchableOpacity
            key={c}
            style={[styles.chip, classCode === c && styles.chipOn]}
            onPress={() => setClassCode(c)}
          >
            <Text style={[styles.chipText, classCode === c && styles.chipTextOn]}>{c}</Text>
          </TouchableOpacity>
        ))}
      </View>
      <Text style={styles.groupLabel}>Non-AC classes</Text>
      <View style={styles.chips}>
        {TATKAL_NONAC_CLASSES.map((c) => (
          <TouchableOpacity
            key={c}
            style={[styles.chip, classCode === c && styles.chipOn]}
            onPress={() => setClassCode(c)}
          >
            <Text style={[styles.chipText, classCode === c && styles.chipTextOn]}>{c}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <Text style={styles.label}>
        Passengers (max {MAX_PASSENGERS_PER_TATKAL_PNR} per Tatkal PNR) —{' '}
        {selected.length} selected
      </Text>
      {passengers.length === 0 && (
        <Text style={styles.hint}>
          No passengers saved yet — add them on the Passengers screen first.
        </Text>
      )}
      {passengers.map((p) => {
        const on = selected.includes(p.id);
        const disabled = !on && capHit;
        return (
          <TouchableOpacity
            key={p.id}
            disabled={disabled}
            style={[styles.pax, on && styles.paxOn, disabled && styles.paxDisabled]}
            onPress={() => togglePax(p.id)}
          >
            <Text style={[styles.paxText, on && styles.paxTextOn]}>
              {on ? '☑ ' : '☐ '}
              {p.name}, {p.age} · {BERTH_LABELS[p.berthPref] ?? p.berthPref}
            </Text>
          </TouchableOpacity>
        );
      })}

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <TouchableOpacity style={styles.primary} onPress={save}>
        <Text style={styles.primaryText}>Save trip → Countdown</Text>
      </TouchableOpacity>
      <TouchableOpacity style={styles.back} onPress={nav.back}>
        <Text style={styles.backText}>← Back</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  inner: { padding: 16, paddingBottom: 40 },
  title: { color: C.lime, fontSize: 22, fontWeight: '800', marginBottom: 12 },
  label: { color: C.muted, fontSize: 13, marginTop: 10, marginBottom: 6 },
  groupLabel: { color: C.ink, fontSize: 12, fontWeight: '700', marginTop: 8, marginBottom: 6 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    borderColor: C.line, borderWidth: 1, borderRadius: 16,
    paddingHorizontal: 14, paddingVertical: 8,
  },
  chipOn: { backgroundColor: C.lime, borderColor: C.lime },
  chipText: { color: C.ink, fontSize: 14 },
  chipTextOn: { color: C.bg, fontWeight: '800' },
  hint: { color: C.muted, fontSize: 13, marginBottom: 8 },
  pax: {
    borderColor: C.line, borderWidth: 1, borderRadius: 8,
    padding: 11, marginBottom: 6,
  },
  paxOn: { borderColor: C.lime, backgroundColor: '#182114' },
  paxDisabled: { opacity: 0.35 },
  paxText: { color: C.ink, fontSize: 14 },
  paxTextOn: { fontWeight: '700' },
  error: { color: C.danger, fontSize: 13, marginTop: 10 },
  link: { color: C.lime, fontSize: 13, fontWeight: '700', marginTop: 6 },
  primary: {
    backgroundColor: C.lime, borderRadius: 10, padding: 14,
    alignItems: 'center', marginTop: 16,
  },
  primaryText: { color: C.bg, fontSize: 16, fontWeight: '800' },
  back: { alignItems: 'center', padding: 12 },
  backText: { color: C.ink, fontSize: 14, fontWeight: '600' },
});
