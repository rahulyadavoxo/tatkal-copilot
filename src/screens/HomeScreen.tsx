/**
 * Home — saved trips list + entry points.
 */
import React, { useCallback, useState } from 'react';
import {
  FlatList,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { C } from '../theme';
import { loadTrips, saveTrips, type Trip } from '../vaultStore';
import type { Nav } from '../App';
import { useFocusLoad } from './hooks';

export default function HomeScreen({ nav }: { nav: Nav }) {
  const [trips, setTrips] = useState<Trip[]>([]);

  const reload = useCallback(async () => {
    setTrips(await loadTrips());
  }, []);
  useFocusLoad(reload);

  const removeTrip = async (id: string) => {
    const next = trips.filter((t) => t.id !== id);
    setTrips(next);
    await saveTrips(next);
  };

  return (
    <View style={styles.root}>
      <Text style={styles.title}>Tatkal Copilot</Text>
      <Text style={styles.sub}>
        Fastest legitimate Tatkal attempt. You tap — we fill.
      </Text>

      <FlatList
        data={trips}
        keyExtractor={(t) => t.id}
        ListEmptyComponent={
          <Text style={styles.empty}>
            No trips yet. Add your passengers, then set up a trip.
          </Text>
        }
        renderItem={({ item }) => (
          <TouchableOpacity
            style={styles.card}
            onPress={() => nav.go({ name: 'countdown', tripId: item.id })}
          >
            <View style={styles.cardRow}>
              <Text style={styles.cardTitle}>
                {item.trainNo} · {item.from} → {item.to}
              </Text>
              <View style={styles.cardActions}>
                <TouchableOpacity
                  onPress={() => nav.go({ name: 'tripSetup', tripId: item.id })}
                >
                  <Text style={styles.edit}>✎ Edit</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => removeTrip(item.id)}>
                  <Text style={styles.delete}>✕</Text>
                </TouchableOpacity>
              </View>
            </View>
            <Text style={styles.cardSub}>
              {item.journeyDate} · {item.classCode}
              {item.isAC ? ' (AC, opens 10:00)' : ' (Non-AC, opens 11:00)'} ·{' '}
              {item.passengerIds.length} pax
            </Text>
          </TouchableOpacity>
        )}
      />

      <TouchableOpacity
        style={styles.primary}
        onPress={() => nav.go({ name: 'tripSetup' })}
      >
        <Text style={styles.primaryText}>+ New trip</Text>
      </TouchableOpacity>
      <TouchableOpacity
        style={styles.secondary}
        onPress={() => nav.go({ name: 'irctcLogin' })}
      >
        <Text style={styles.secondaryText}>🔑 Log in to IRCTC</Text>
      </TouchableOpacity>
      <TouchableOpacity
        style={styles.secondary}
        onPress={() => nav.go({ name: 'passengers' })}
      >
        <Text style={styles.secondaryText}>Passengers</Text>
      </TouchableOpacity>
      <TouchableOpacity
        style={styles.secondary}
        onPress={() => nav.go({ name: 'pnr' })}
      >
        <Text style={styles.secondaryText}>PNR status</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, padding: 16, backgroundColor: C.bg },
  title: { color: C.lime, fontSize: 26, fontWeight: '800' },
  sub: { color: C.muted, fontSize: 13, marginTop: 4, marginBottom: 16 },
  empty: { color: C.muted, textAlign: 'center', marginTop: 40, fontSize: 14 },
  card: {
    backgroundColor: C.card,
    borderColor: C.line,
    borderWidth: 1,
    borderRadius: 10,
    padding: 14,
    marginBottom: 10,
  },
  cardRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  cardActions: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  edit: { color: C.lime, fontSize: 14, fontWeight: '700', padding: 4 },
  cardTitle: { color: C.ink, fontSize: 16, fontWeight: '700' },
  cardSub: { color: C.muted, fontSize: 12, marginTop: 4 },
  delete: { color: C.danger, fontSize: 16, padding: 4 },
  primary: {
    backgroundColor: C.lime,
    borderRadius: 10,
    padding: 14,
    alignItems: 'center',
    marginTop: 8,
  },
  primaryText: { color: C.bg, fontSize: 16, fontWeight: '800' },
  secondary: {
    borderColor: C.line,
    borderWidth: 1,
    borderRadius: 10,
    padding: 14,
    alignItems: 'center',
    marginTop: 8,
  },
  secondaryText: { color: C.ink, fontSize: 15, fontWeight: '600' },
});
