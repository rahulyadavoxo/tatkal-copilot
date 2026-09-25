/**
 * Passengers — CRUD over the encrypted vault.
 * All writes go through vaultStore (AES-256-GCM); plaintext never persists.
 */
import React, { useCallback, useState } from 'react';
import {
  FlatList,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { BERTH_LABELS, C, GENDER_LABELS } from '../theme';
import {
  loadPassengers,
  newId,
  savePassengers,
  type Gender,
  type Passenger,
} from '../vaultStore';
import type { Nav } from '../App';
import { useFocusLoad } from './hooks';

const BERTHS = Object.keys(BERTH_LABELS);
const GENDERS: Gender[] = ['M', 'F', 'O'];

function blank(): Passenger {
  return { id: newId('pax'), name: '', age: 30, gender: 'M', berthPref: 'LB' };
}

export default function PassengersScreen({ nav }: { nav: Nav }) {
  const [list, setList] = useState<Passenger[]>([]);
  const [editing, setEditing] = useState<Passenger | null>(null);

  const reload = useCallback(async () => setList(await loadPassengers()), []);
  useFocusLoad(reload);

  const persist = async (next: Passenger[]) => {
    setList(next);
    await savePassengers(next);
  };

  const saveEdit = async () => {
    if (!editing) return;
    const name = editing.name.trim();
    const age = Math.floor(Number(editing.age));
    if (!name) return;
    if (!Number.isFinite(age) || age < 1 || age > 120) return;
    const clean: Passenger = { ...editing, name, age };
    const next = list.some((p) => p.id === clean.id)
      ? list.map((p) => (p.id === clean.id ? clean : p))
      : [...list, clean];
    setEditing(null);
    await persist(next);
  };

  const remove = async (id: string) => {
    await persist(list.filter((p) => p.id !== id));
  };

  return (
    <View style={styles.root}>
      <Text style={styles.title}>Passengers</Text>
      <Text style={styles.sub}>Stored encrypted on this phone only.</Text>

      <FlatList
        data={list}
        keyExtractor={(p) => p.id}
        ListEmptyComponent={
          <Text style={styles.empty}>No passengers yet — add your family below.</Text>
        }
        renderItem={({ item }) => (
          <View style={styles.card}>
            <View style={styles.cardRow}>
              <Text style={styles.cardTitle}>
                {item.name}, {item.age} · {GENDER_LABELS[item.gender]} ·{' '}
                {BERTH_LABELS[item.berthPref] ?? item.berthPref}
              </Text>
            </View>
            <View style={styles.cardActions}>
              <TouchableOpacity onPress={() => setEditing({ ...item })}>
                <Text style={styles.link}>Edit</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => remove(item.id)}>
                <Text style={[styles.link, styles.dangerLink]}>Delete</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
      />

      {editing ? (
        <View style={styles.form}>
          <Text style={styles.formTitle}>
            {list.some((p) => p.id === editing.id) ? 'Edit passenger' : 'Add passenger'}
          </Text>
          <TextInput
            style={styles.input}
            placeholder="Full name (as on ID)"
            placeholderTextColor={C.muted}
            value={editing.name}
            onChangeText={(t) => setEditing({ ...editing, name: t })}
          />
          <TextInput
            style={styles.input}
            placeholder="Age"
            placeholderTextColor={C.muted}
            keyboardType="numeric"
            value={String(editing.age)}
            onChangeText={(t) => setEditing({ ...editing, age: Number(t) || 0 })}
          />
          <Text style={styles.label}>Gender</Text>
          <View style={styles.chips}>
            {GENDERS.map((g) => (
              <TouchableOpacity
                key={g}
                style={[styles.chip, editing.gender === g && styles.chipOn]}
                onPress={() => setEditing({ ...editing, gender: g })}
              >
                <Text style={[styles.chipText, editing.gender === g && styles.chipTextOn]}>
                  {GENDER_LABELS[g]}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
          <Text style={styles.label}>Berth preference</Text>
          <View style={styles.chips}>
            {BERTHS.map((b) => (
              <TouchableOpacity
                key={b}
                style={[styles.chip, editing.berthPref === b && styles.chipOn]}
                onPress={() => setEditing({ ...editing, berthPref: b })}
              >
                <Text style={[styles.chipText, editing.berthPref === b && styles.chipTextOn]}>
                  {BERTH_LABELS[b]}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
          <View style={styles.formRow}>
            <TouchableOpacity style={styles.primary} onPress={saveEdit}>
              <Text style={styles.primaryText}>Save</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.secondary} onPress={() => setEditing(null)}>
              <Text style={styles.secondaryText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : (
        <TouchableOpacity style={styles.primary} onPress={() => setEditing(blank())}>
          <Text style={styles.primaryText}>+ Add passenger</Text>
        </TouchableOpacity>
      )}

      <TouchableOpacity style={styles.back} onPress={nav.back}>
        <Text style={styles.secondaryText}>← Back</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, padding: 16, backgroundColor: C.bg },
  title: { color: C.lime, fontSize: 22, fontWeight: '800' },
  sub: { color: C.muted, fontSize: 12, marginTop: 2, marginBottom: 12 },
  empty: { color: C.muted, textAlign: 'center', marginTop: 30 },
  card: {
    backgroundColor: C.card, borderColor: C.line, borderWidth: 1,
    borderRadius: 10, padding: 12, marginBottom: 8,
  },
  cardRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  cardTitle: { color: C.ink, fontSize: 14, fontWeight: '600', flex: 1 },
  cardActions: { flexDirection: 'row', gap: 16, marginTop: 8 },
  link: { color: C.lime, fontSize: 13, fontWeight: '700' },
  dangerLink: { color: C.danger },
  form: {
    backgroundColor: C.card, borderColor: C.line, borderWidth: 1,
    borderRadius: 10, padding: 12, marginTop: 8,
  },
  formTitle: { color: C.ink, fontSize: 15, fontWeight: '700', marginBottom: 8 },
  input: {
    backgroundColor: C.bg, color: C.ink, borderColor: C.line, borderWidth: 1,
    borderRadius: 8, padding: 10, marginBottom: 8, fontSize: 15,
  },
  label: { color: C.muted, fontSize: 12, marginTop: 4, marginBottom: 6 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 8 },
  chip: {
    borderColor: C.line, borderWidth: 1, borderRadius: 16,
    paddingHorizontal: 12, paddingVertical: 7,
  },
  chipOn: { backgroundColor: C.lime, borderColor: C.lime },
  chipText: { color: C.ink, fontSize: 13 },
  chipTextOn: { color: C.bg, fontWeight: '700' },
  formRow: { flexDirection: 'row', gap: 8, marginTop: 4 },
  primary: {
    backgroundColor: C.lime, borderRadius: 10, padding: 13,
    alignItems: 'center', marginTop: 8, flex: 1,
  },
  primaryText: { color: C.bg, fontSize: 15, fontWeight: '800' },
  secondary: {
    borderColor: C.line, borderWidth: 1, borderRadius: 10,
    padding: 13, alignItems: 'center', marginTop: 8, flex: 1,
  },
  secondaryText: { color: C.ink, fontSize: 14, fontWeight: '600' },
  back: { alignItems: 'center', padding: 12 },
});
