/**
 * TrainField — searchable train picker over the offline popular-trains
 * directory (src/data/trains.ts, ~600 named trains with numbers).
 *
 * Type a train name or number → suggestions appear → tap to select.
 * If a 5-digit number is typed directly, it is accepted on blur.
 * The parent owns the selected train NUMBER; this component only
 * handles search + display.
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
import { searchTrains, type Train } from '../data/trains';

interface Props {
  label: string;
  value: string; // selected 5-digit train number ('' = none)
  onSelect: (no: string) => void;
  placeholder?: string;
}

export default function TrainField({ label, value, onSelect, placeholder }: Props) {
  const [query, setQuery] = useState('');
  const [focused, setFocused] = useState(false);

  const suggestions = focused ? searchTrains(query, 6) : [];

  const choose = (t: Train) => {
    setQuery('');
    setFocused(false);
    onSelect(t.no);
  };

  const handleBlur = () => {
    // Exact 5-digit number typed without tapping? Accept it.
    const q = query.trim();
    if (/^\d{5}$/.test(q)) {
      setQuery('');
      setFocused(false);
      onSelect(q);
      return;
    }
    // Delay hiding so a suggestion tap registers before the list unmounts.
    setTimeout(() => setFocused(false), 150);
  };

  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        style={styles.input}
        placeholder={placeholder ?? 'Type train name or number'}
        placeholderTextColor={C.muted}
        value={focused ? query : value}
        onChangeText={setQuery}
        onFocus={() => {
          setQuery('');
          setFocused(true);
        }}
        onBlur={handleBlur}
        autoCapitalize="none"
        autoCorrect={false}
      />
      {focused && query.trim().length > 0 && suggestions.length === 0 && (
        <Text style={styles.noMatch}>
          Not in the offline list — type the 5-digit number directly, or use
          “Find it on IRCTC” below.
        </Text>
      )}
      {suggestions.length > 0 && (
        <View style={styles.drop}>
          {suggestions.map((t) => (
            <TouchableOpacity key={t.no} style={styles.row} onPress={() => choose(t)}>
              <Text style={styles.no}>{t.no}</Text>
              <Text style={styles.name} numberOfLines={2}>
                {t.name}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      )}
      <Text style={styles.note}>Popular trains (offline list) — verify the number on IRCTC.</Text>
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
  noMatch: { color: C.muted, fontSize: 12, marginTop: 6, lineHeight: 17 },
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
  no: { color: C.lime, fontSize: 14, fontWeight: '800', width: 62 },
  name: { color: C.ink, fontSize: 13, flex: 1, lineHeight: 17 },
  note: { color: C.muted, fontSize: 11, marginTop: 6 },
});
