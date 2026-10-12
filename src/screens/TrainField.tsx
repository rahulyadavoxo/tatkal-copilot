/**
 * TrainField — searchable train picker over the offline popular-trains
 * directory (src/data/trains.ts, ~600 named trains with numbers).
 *
 * Type a train name or number → suggestions appear → tap to select.
 * If a 5-digit number is typed directly, it is accepted on blur.
 * The parent owns the selected train NUMBER; this component only
 * handles search + display.
 *
 * Props API is unchanged (label / value / onSelect / placeholder).
 */
import React, { useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useTheme } from '../theme';
import { searchTrains, type Train } from '../data/trains';
import { LabeledInput } from '../components/ui';

interface Props {
  label: string;
  value: string; // selected 5-digit train number ('' = none)
  onSelect: (no: string) => void;
  placeholder?: string;
}

export default function TrainField({ label, value, onSelect, placeholder }: Props) {
  const { theme } = useTheme();
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
      <LabeledInput
        label={label}
        placeholder={placeholder ?? 'Type train name or number'}
        value={focused ? query : value}
        onChangeText={setQuery}
        onFocus={() => {
          setQuery('');
          setFocused(true);
        }}
        onBlur={handleBlur}
        autoCapitalize="none"
        autoCorrect={false}
        accessibilityLabel={`Train search, ${label}`}
        keyboardType="default"
        hint="Popular trains (offline list) — verify the number on IRCTC."
      />
      {focused && query.trim().length > 0 && suggestions.length === 0 && (
        <Text
          style={[styles.noMatch, { color: theme.colors.muted }]}
          accessibilityRole="text"
        >
          Not in the offline list — type the 5-digit number directly, or use
          “Find it on IRCTC” below.
        </Text>
      )}
      {suggestions.length > 0 && (
        <View
          style={[
            styles.drop,
            { backgroundColor: theme.colors.surface, borderColor: theme.colors.line },
          ]}
        >
          {suggestions.map((t) => (
            <TouchableOpacity
              key={t.no}
              style={[styles.row, { borderBottomColor: theme.colors.line }]}
              accessibilityRole="button"
              accessibilityLabel={`Train ${t.no}, ${t.name}`}
              onPress={() => choose(t)}
            >
              <Text style={[styles.no, { color: theme.colors.primary }]}>{t.no}</Text>
              <Text style={[styles.name, { color: theme.colors.ink }]} numberOfLines={2}>
                {t.name}
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
  no: { fontSize: 14, fontWeight: '800', width: 62 },
  name: { fontSize: 13, flex: 1, lineHeight: 17 },
});
