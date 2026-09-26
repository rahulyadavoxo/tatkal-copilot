/**
 * StationField — searchable station picker over the offline directory
 * (src/data/stations.ts, 11k+ Indian Railways stations).
 *
 * Type a name or code → suggestions appear → tap to select. If the exact
 * code is typed, it auto-selects on blur. The parent owns the selected
 * station CODE; this component only handles search + display.
 */
import React, { useState } from 'react';
import {
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { C } from '../theme';
import { STATIONS, searchStations, type Station } from '../data/stations';

interface Props {
  label: string;
  value: string; // selected station code ('' = none)
  onSelect: (code: string) => void;
  placeholder?: string;
}

export default function StationField({ label, value, onSelect, placeholder }: Props) {
  const [query, setQuery] = useState('');
  const [focused, setFocused] = useState(false);

  const selected = value ? STATIONS.find((s) => s.code === value) : undefined;
  const suggestions = focused ? searchStations(query, 6) : [];

  const choose = (s: Station) => {
    setQuery('');
    setFocused(false);
    onSelect(s.code);
  };

  const handleBlur = () => {
    // Exact code typed without tapping? Select it.
    const q = query.trim().toUpperCase();
    if (q) {
      const exact = STATIONS.find((s) => s.code === q);
      if (exact) {
        setQuery('');
        setFocused(false);
        onSelect(exact.code);
        return;
      }
    }
    // Delay hiding so a suggestion tap registers before the list unmounts.
    setTimeout(() => setFocused(false), 150);
  };

  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        style={styles.input}
        placeholder={placeholder ?? 'Type station name or code'}
        placeholderTextColor={C.muted}
        value={focused ? query : selected ? `${selected.code} — ${selected.name}` : ''}
        onChangeText={setQuery}
        onFocus={() => {
          setQuery('');
          setFocused(true);
        }}
        onBlur={handleBlur}
        autoCapitalize="characters"
        autoCorrect={false}
      />
      {focused && query.trim().length > 0 && suggestions.length === 0 && (
        <Text style={styles.noMatch}>No station matches “{query.trim()}”.</Text>
      )}
      {suggestions.length > 0 && (
        <View style={styles.drop}>
          {suggestions.map((s) => (
            <TouchableOpacity key={s.code} style={styles.row} onPress={() => choose(s)}>
              <Text style={styles.code}>{s.code}</Text>
              <Text style={styles.name} numberOfLines={1}>
                {s.name}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginBottom: 2 },
  label: { color: C.muted, fontSize: 13, marginTop: 10, marginBottom: 6 },
  input: {
    backgroundColor: C.card,
    color: C.ink,
    borderColor: C.line,
    borderWidth: 1,
    borderRadius: 8,
    padding: 11,
    fontSize: 15,
  },
  noMatch: { color: C.muted, fontSize: 12, marginTop: 6 },
  drop: {
    backgroundColor: C.card,
    borderColor: C.line,
    borderWidth: 1,
    borderRadius: 8,
    marginTop: 4,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderBottomColor: C.line,
    borderBottomWidth: 1,
  },
  code: { color: C.lime, fontSize: 14, fontWeight: '800', width: 64 },
  name: { color: C.ink, fontSize: 14, flex: 1 },
});
