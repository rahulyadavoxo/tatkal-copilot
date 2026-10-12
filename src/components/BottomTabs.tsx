/**
 * BottomTabs — 2026-10 redesign.
 *
 * Five tab roots: Home, PNR, Book, Activity, Profile. Modelled on the big
 * consumer apps: icon-first, short labels, the active tab gets a soft pill
 * behind its icon (Material 3 / YouTube), and the main action — Book — sits
 * in the middle as a raised round button (Instagram/YouTube "create").
 * Every target is ≥ 56dp tall with accessibilityRole="tab" + selected state.
 * App.tsx renders this ONLY on the five tab roots.
 */
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../theme';
import { Icon } from './icons';
import type { IconName } from './icons';

export type TabName = 'home' | 'book' | 'pnr' | 'activity' | 'profile';

const TABS: { name: TabName; label: string; icon: IconName; center?: boolean }[] = [
  { name: 'home', label: 'Home', icon: 'home' },
  { name: 'pnr', label: 'PNR', icon: 'search' },
  { name: 'book', label: 'Book', icon: 'plus', center: true },
  { name: 'activity', label: 'Activity', icon: 'history' },
  { name: 'profile', label: 'You', icon: 'users' },
];

export function BottomTabs({
  active,
  onSelect,
}: {
  active: TabName;
  onSelect: (tab: TabName) => void;
}) {
  const { theme } = useTheme();
  const c = theme.colors;
  return (
    <View
      style={[styles.bar, { backgroundColor: c.surface, borderTopColor: c.line }]}
      accessibilityRole="tablist"
      accessibilityLabel="Main navigation"
    >
      {TABS.map((tab) => {
        const selected = tab.name === active;
        if (tab.center) {
          return (
            <Pressable
              key={tab.name}
              style={styles.tab}
              accessibilityRole="tab"
              accessibilityLabel={`${tab.label} a Tatkal ticket`}
              accessibilityState={{ selected }}
              onPress={() => onSelect(tab.name)}
            >
              {({ pressed }) => (
                <View
                  style={[
                    styles.centerBtn,
                    {
                      backgroundColor: c.primary,
                      transform: [{ scale: pressed ? 0.94 : 1 }],
                      ...theme.elevation.md,
                      shadowColor: c.primary,
                    },
                  ]}
                >
                  <Icon name={tab.icon} size={26} color={c.onPrimary} />
                </View>
              )}
            </Pressable>
          );
        }
        const color = selected ? c.ink : c.muted;
        return (
          <Pressable
            key={tab.name}
            style={styles.tab}
            accessibilityRole="tab"
            accessibilityLabel={tab.label}
            accessibilityState={{ selected }}
            onPress={() => onSelect(tab.name)}
            android_ripple={{ color: c.neutralTint, borderless: true, radius: 36 }}
          >
            <View style={[styles.pill, { backgroundColor: selected ? c.primaryTint : 'transparent' }]}>
              <Icon name={tab.icon} size={24} color={selected ? c.primaryOnTint : color} />
            </View>
            <Text
              style={{
                fontSize: 11,
                lineHeight: 14,
                marginTop: 3,
                color,
                fontWeight: selected ? '800' : '600',
              }}
            >
              {tab.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 4,
  },
  tab: {
    flex: 1,
    minHeight: 64,
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 6,
    paddingBottom: 8,
  },
  pill: {
    width: 56,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  centerBtn: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: -14,
  },
});
