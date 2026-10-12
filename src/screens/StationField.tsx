/**
 * StationField — searchable station picker over the offline directory
 * (src/data/stations.ts, 11k+ Indian Railways stations).
 *
 * Type a name or code → suggestions appear → tap to select. If the exact
 * code is typed, it auto-selects on blur. The parent owns the selected
 * station CODE; this component only handles search + display.
 *
 * Props API is unchanged (label / value / onSelect / placeholder).
 */
import React, { useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useTheme } from '../theme';
import { STATIONS, searchStations, type Station } from '../data/stations';
import { LabeledInput } from '../components/ui';

interface Props {
  label: string;
  value: string; // selected station code ('' = none)
  onSelect: (code: string) => void;
  placeholder?: string;
}

export default function StationField({ label, value, onSelect, placeholder }: Props) {
  const { theme } = useTheme();
  const [query, setQuery] = useState('');
  const [focused, setFocused] = useState(false);
  // Kept visible after blur when the typed text matched nothing — so the
  // query isn't silently discarded without the user knowing why.
  const [stuckMsg, setStuckMsg] = useState('');

  const selected = value ? STATIONS.find((s) => s.code === value) : undefined;
  const suggestions = focused ? searchStations(query, 6) : [];

  const choose = (s: Station) => {
    setQuery('');
    setStuckMsg('');
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
        setStuckMsg('');
        setFocused(false);
        onSelect(exact.code);
        return;
      }
      // No match: leave feedback up after blur instead of dropping the text
      // silently. The field keeps the previous selection.
      setStuckMsg(`No station matches “${query.trim()}” — pick one from the list.`);
    } else {
      setStuckMsg('');
    }
    // Delay hiding so a suggestion tap registers before the list unmounts.
    setTimeout(() => setFocused(false), 150);
  };

  return (
    <View style={styles.wrap}>
      <LabeledInput
        label={label}
        placeholder={placeholder ?? 'Type station name or code'}
        value={focused ? query : selected ? `${selected.code} — ${selected.name}` : ''}
        onChangeText={setQuery}
        onFocus={() => {
          setQuery('');
          setStuckMsg('');
          setFocused(true);
        }}
        onBlur={handleBlur}
        autoCapitalize="characters"
        autoCorrect={false}
        accessibilityLabel={`Station search, ${label}`}
        error={focused ? undefined : stuckMsg || undefined}
      />
      {focused && query.trim().length > 0 && suggestions.length === 0 && (
        <Text
          style={[styles.noMatch, { color: theme.colors.muted }]}
          accessibilityRole="text"
        >
          No station matches “{query.trim()}”.
        </Text>
      )}
      {suggestions.length > 0 && (
        <View
          style={[
            styles.drop,
            { backgroundColor: theme.colors.surface, borderColor: theme.colors.line },
          ]}
        >
          {suggestions.map((s) => (
            <TouchableOpacity
              key={s.code}
              style={[styles.row, { borderBottomColor: theme.colors.line }]}
              accessibilityRole="button"
              accessibilityLabel={`${s.code}, ${s.name}`}
              onPress={() => choose(s)}
            >
              <Text style={[styles.code, { color: theme.colors.primary }]}>
                {s.code}
              </Text>
              <Text style={[styles.name, { color: theme.colors.ink }]} numberOfLines={1}>
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
  noMatch: { fontSize: 12, marginTop: 6, lineHeight: 17 },
  drop: {
    borderWidth: 1,
    borderRadius: 8,
    marginTop: 4,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 13,
    paddingHorizontal: 12,
    minHeight: 44,
    borderBottomWidth: 1,
  },
  code: { fontSize: 14, fontWeight: '800', width: 64 },
  name: { fontSize: 14, flex: 1 },
});
