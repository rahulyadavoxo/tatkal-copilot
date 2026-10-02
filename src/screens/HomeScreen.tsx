/**
 * Home — "Speed Protocol" dashboard (user-supplied mockup, 2026-10-02).
 *
 * Saved trips as live-monitoring cards, real stat counts, and quick
 * controls into the app's real screens. The stats are REAL vault counts —
 * never fabricated marketing numbers.
 */
import React, { useCallback, useState } from 'react';
import {
  Dimensions,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { C } from '../theme';
import { loadPassengers, loadTrips, saveTrips, type Trip } from '../vaultStore';
import { isTatkalQuota } from '../core/tatkalConfig';
import { TRAINS } from '../data/trains';
import { STATIONS } from '../data/stations';
import type { Nav } from '../App';
import { useFocusLoad } from './hooks';

const CARD_W = Math.round(Dimensions.get('window').width * 0.86);

const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

const CLASS_LABELS: Record<string, string> = {
  'All Classes': 'All Classes',
  EA: 'Anubhuti',
  '1A': 'AC First Class',
  EV: 'Vistadome AC',
  EC: 'Executive Chair Car',
  '2A': 'AC 2-Tier',
  FC: 'First Class',
  '3A': 'AC 3-Tier',
  '3E': 'AC 3-Tier Economy',
  VC: 'Vistadome',
  CC: 'AC Chair Car',
  SL: 'Sleeper',
  VS: 'Vistadome',
  '2S': 'Second Sitting',
};

function fmtDate(iso: string): string {
  const parts = iso.split('-').map(Number);
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) return iso;
  const [y, m, d] = parts;
  if (m < 1 || m > 12) return iso;
  return `${MONTHS[m - 1]} ${String(d).padStart(2, '0')}, ${String(y).slice(2)}`;
}

function trainName(no: string): string | null {
  const norm = (s: string) => s.replace(/^0+/, '');
  const t =
    TRAINS.find((x) => x.no === no) ??
    TRAINS.find((x) => norm(x.no) === norm(no));
  return t ? t.name : null;
}

function stationName(code: string): string {
  return STATIONS.find((s) => s.code === code)?.name ?? '';
}

function opensAt(trip: Trip): string {
  const q = trip.quota ?? 'TATKAL';
  if (!isTatkalQuota(q)) return 'book anytime';
  return trip.isAC ? 'opens 10:00' : 'opens 11:00';
}

function classLabel(code: string): string {
  return `${CLASS_LABELS[code] ?? code} (${code})`;
}

export default function HomeScreen({ nav }: { nav: Nav }) {
  const [trips, setTrips] = useState<Trip[]>([]);
  const [travellerCount, setTravellerCount] = useState(0);

  const reload = useCallback(async () => {
    const [ts, pax] = await Promise.all([loadTrips(), loadPassengers()]);
    setTrips(ts);
    setTravellerCount(pax.length);
  }, []);
  useFocusLoad(reload);

  const removeTrip = async (id: string) => {
    const next = trips.filter((t) => t.id !== id);
    setTrips(next);
    await saveTrips(next);
  };

  const goTile = (name: 'irctcAccount' | 'passengers' | 'pnr' | 'trainLookup') =>
    nav.go({ name });

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.inner}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.logo}>
          <Text style={styles.logoBolt}>⚡</Text>
        </View>
        <View>
          <Text style={styles.brand}>
            Tatkal<Text style={styles.brandAccent}>Copilot</Text>
          </Text>
          <Text style={styles.tagline}>SPEED PROTOCOL V2.4</Text>
        </View>
      </View>

      {/* Stats — real vault counts, never fabricated */}
      <View style={styles.stats}>
        <View style={styles.stat}>
          <View style={[styles.statIcon, { backgroundColor: '#1E2B22' }]}>
            <Text style={styles.statEmoji}>✓</Text>
          </View>
          <View>
            <Text style={styles.statLabel}>SAVED TRIPS</Text>
            <Text style={styles.statValue}>{trips.length}</Text>
          </View>
        </View>
        <View style={styles.stat}>
          <View style={[styles.statIcon, { backgroundColor: '#26233A' }]}>
            <Text style={styles.statEmoji}>👥</Text>
          </View>
          <View>
            <Text style={styles.statLabel}>TRAVELLERS</Text>
            <Text style={styles.statValue}>{travellerCount}</Text>
          </View>
        </View>
      </View>

      {/* Live monitoring */}
      <Text style={styles.section}>Live Monitoring</Text>
      {trips.length === 0 ? (
        <View style={styles.emptyCard}>
          <Text style={styles.emptyTitle}>No trips yet</Text>
          <Text style={styles.emptySub}>
            Set up a trip with your train, date and passengers — then launch
            it at the Tatkal window.
          </Text>
          <TouchableOpacity
            style={styles.launch}
            onPress={() => nav.go({ name: 'tripSetup' })}
          >
            <Text style={styles.launchText}>+ Set up a trip</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <ScrollView
          horizontal
          pagingEnabled={false}
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.cards}
          snapToInterval={CARD_W + 12}
          decelerationRate="fast"
        >
          {trips.map((item) => {
            const name = trainName(item.trainNo);
            return (
              <View key={item.id} style={styles.tripCard}>
                <View style={styles.tripTop}>
                  <Text style={styles.liveDot}>
                    <Text style={styles.dot}>●</Text> SAVED TRIP
                  </Text>
                  <Text style={styles.trainLine} numberOfLines={1}>
                    {item.trainNo}
                    {name ? ` • ${name}` : ''}
                  </Text>
                  <View style={styles.cardTools}>
                    <TouchableOpacity
                      onPress={() =>
                        nav.go({ name: 'tripSetup', tripId: item.id })
                      }
                    >
                      <Text style={styles.tool}>✎ Edit</Text>
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => removeTrip(item.id)}>
                      <Text style={[styles.tool, styles.toolDanger]}>✕</Text>
                    </TouchableOpacity>
                  </View>
                </View>
                <View style={styles.tripBody}>
                  <View style={styles.route}>
                    <View style={styles.station}>
                      <Text style={styles.code}>{item.from}</Text>
                      <Text style={styles.stationName} numberOfLines={1}>
                        {stationName(item.from) || '—'}
                      </Text>
                    </View>
                    <Text style={styles.trainIcon}>🚂</Text>
                    <View style={[styles.station, styles.toStation]}>
                      <Text style={[styles.code, styles.toCode]}>
                        {item.to}
                      </Text>
                      <Text style={styles.stationName} numberOfLines={1}>
                        {stationName(item.to) || '—'}
                      </Text>
                    </View>
                  </View>
                  <View style={styles.meta}>
                    <View style={styles.metaCell}>
                      <Text style={styles.metaLabel}>DATE</Text>
                      <Text style={styles.metaValue}>
                        {fmtDate(item.journeyDate)}
                      </Text>
                    </View>
                    <View style={styles.metaCell}>
                      <Text style={styles.metaLabel}>CLASS</Text>
                      <Text style={styles.metaValue} numberOfLines={1}>
                        {classLabel(item.classCode)}
                      </Text>
                    </View>
                    <View style={styles.metaCell}>
                      <Text style={styles.metaLabel}>QUOTA</Text>
                      <Text style={[styles.metaValue, styles.quota]}>
                        {item.quota ?? 'TATKAL'}
                      </Text>
                    </View>
                  </View>
                  <Text style={styles.opens}>
                    {opensAt(item)} · {item.passengerIds.length} traveller
                    {item.passengerIds.length === 1 ? '' : 's'}
                  </Text>
                  <TouchableOpacity
                    style={styles.launch}
                    onPress={() =>
                      nav.go({ name: 'countdown', tripId: item.id })
                    }
                  >
                    <Text style={styles.launchText}>Launch Attempt</Text>
                  </TouchableOpacity>
                </View>
              </View>
            );
          })}
        </ScrollView>
      )}

      {trips.length > 0 && (
        <TouchableOpacity
          style={styles.newTrip}
          onPress={() => nav.go({ name: 'tripSetup' })}
        >
          <Text style={styles.newTripText}>+ New trip</Text>
        </TouchableOpacity>
      )}

      {/* Quick controls */}
      <Text style={styles.section}>Quick Control</Text>
      <View style={styles.grid}>
        <TouchableOpacity
          style={styles.tile}
          onPress={() => goTile('irctcAccount')}
        >
          <View style={[styles.tileIcon, { backgroundColor: '#1D2B4D' }]}>
            <Text style={styles.tileEmoji}>👤</Text>
          </View>
          <Text style={styles.tileTitle}>Account</Text>
          <Text style={styles.tileSub}>IRCTC Credentials</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.tile}
          onPress={() => goTile('passengers')}
        >
          <View style={[styles.tileIcon, { backgroundColor: '#3A2E1B' }]}>
            <Text style={styles.tileEmoji}>👥</Text>
          </View>
          <Text style={styles.tileTitle}>Master List</Text>
          <Text style={styles.tileSub}>
            {travellerCount} Saved Profile{travellerCount === 1 ? '' : 's'}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.tile} onPress={() => goTile('pnr')}>
          <View style={[styles.tileIcon, { backgroundColor: '#3A1D22' }]}>
            <Text style={styles.tileEmoji}>🎫</Text>
          </View>
          <Text style={styles.tileTitle}>PNR Status</Text>
          <Text style={styles.tileSub}>Check live status</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.tile}
          onPress={() => goTile('trainLookup')}
        >
          <View style={[styles.tileIcon, { backgroundColor: '#1D3A33' }]}>
            <Text style={styles.tileEmoji}>🚂</Text>
          </View>
          <Text style={styles.tileTitle}>Train Lookup</Text>
          <Text style={styles.tileSub}>Find train numbers</Text>
        </TouchableOpacity>
      </View>

      <TouchableOpacity
        style={styles.login}
        onPress={() => nav.go({ name: 'irctcLogin' })}
      >
        <Text style={styles.loginText}>
          🔑 Log in to IRCTC (before the window opens)
        </Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.navy },
  inner: { padding: 16, paddingBottom: 32 },
  header: { flexDirection: 'row', alignItems: 'center', marginBottom: 18 },
  logo: {
    width: 46,
    height: 46,
    borderRadius: 14,
    backgroundColor: C.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  logoBolt: { fontSize: 24, color: '#fff' },
  brand: { color: '#F2F5FA', fontSize: 22, fontWeight: '800' },
  brandAccent: { color: C.violet },
  tagline: {
    color: C.teal,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 2,
    marginTop: 2,
  },
  stats: { flexDirection: 'row', gap: 12, marginBottom: 20 },
  stat: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: C.surface,
    borderRadius: 16,
    padding: 14,
    gap: 12,
  },
  statIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statEmoji: { fontSize: 18, color: C.teal, fontWeight: '800' },
  statLabel: {
    color: C.faint,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1,
  },
  statValue: { color: '#F2F5FA', fontSize: 20, fontWeight: '800', marginTop: 2 },
  section: {
    color: '#F2F5FA',
    fontSize: 19,
    fontWeight: '800',
    marginBottom: 12,
    marginTop: 4,
  },
  cards: { gap: 12, paddingRight: 16 },
  tripCard: {
    width: CARD_W,
    borderRadius: 20,
    overflow: 'hidden',
    backgroundColor: C.surface,
  },
  tripTop: { backgroundColor: C.primary, padding: 16, paddingBottom: 14 },
  liveDot: {
    color: '#EDE9FE',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.5,
    marginBottom: 6,
  },
  dot: { color: C.teal },
  trainLine: { color: '#fff', fontSize: 21, fontWeight: '800' },
  cardTools: {
    flexDirection: 'row',
    gap: 14,
    marginTop: 8,
  },
  tool: { color: '#EDE9FE', fontSize: 13, fontWeight: '700' },
  toolDanger: { color: '#FFD7D7' },
  tripBody: { padding: 16 },
  route: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 14,
  },
  station: { flex: 1 },
  toStation: { alignItems: 'flex-end' },
  code: { color: '#F2F5FA', fontSize: 26, fontWeight: '800' },
  toCode: { color: C.violet },
  stationName: {
    color: C.faint,
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 1,
    marginTop: 2,
  },
  trainIcon: { fontSize: 22, marginHorizontal: 8 },
  meta: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  metaCell: { flex: 1 },
  metaLabel: {
    color: C.faint,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1,
    marginBottom: 4,
  },
  metaValue: { color: '#F2F5FA', fontSize: 14, fontWeight: '700' },
  quota: { color: C.teal },
  opens: { color: C.teal, fontSize: 12, fontWeight: '700', marginBottom: 12 },
  launch: {
    backgroundColor: C.primary,
    borderRadius: 14,
    padding: 15,
    alignItems: 'center',
  },
  launchText: { color: '#fff', fontSize: 16, fontWeight: '800' },
  newTrip: {
    borderColor: C.primary,
    borderWidth: 1.5,
    borderRadius: 14,
    padding: 14,
    alignItems: 'center',
    marginTop: 12,
  },
  newTripText: { color: C.violet, fontSize: 15, fontWeight: '800' },
  emptyCard: {
    backgroundColor: C.surface,
    borderRadius: 20,
    padding: 22,
    alignItems: 'center',
  },
  emptyTitle: { color: '#F2F5FA', fontSize: 17, fontWeight: '800' },
  emptySub: {
    color: C.faint,
    fontSize: 13,
    textAlign: 'center',
    marginTop: 6,
    marginBottom: 16,
    lineHeight: 19,
  },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  tile: {
    width: '48%',
    flexGrow: 1,
    backgroundColor: C.surface,
    borderRadius: 18,
    padding: 16,
  },
  tileIcon: {
    width: 44,
    height: 44,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  tileEmoji: { fontSize: 21 },
  tileTitle: { color: '#F2F5FA', fontSize: 16, fontWeight: '800' },
  tileSub: { color: C.faint, fontSize: 12, marginTop: 3 },
  login: {
    borderColor: C.surface2,
    borderWidth: 1,
    borderRadius: 14,
    padding: 14,
    alignItems: 'center',
    marginTop: 12,
  },
  loginText: { color: C.faint, fontSize: 14, fontWeight: '600' },
});
