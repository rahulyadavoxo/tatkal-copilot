/**
 * DatePickerField — a self-contained month calendar (no native date-picker
 * dependency, so no new native modules). Constrained to IRCTC's world:
 * no past dates, max 60 days out (advance reservation period).
 *
 * Props API is unchanged (label / value / onSelect / placeholder? / note?).
 */
import React, { useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  findNodeHandle,
} from 'react-native';
import { useTheme } from '../theme';
import { Icon } from '../components/icons';

const DOW = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const MONTHS_SHORT = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];
const MAX_DAYS_OUT = 60; // IRCTC advance reservation period

function isoLocal(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function parseISO(iso: string): Date {
  const [y, m, dd] = iso.split('-').map(Number);
  return new Date(y, m - 1, dd);
}

export function formatLong(iso: string): string {
  const d = parseISO(iso);
  return `${DOW[d.getDay()]}, ${d.getDate()} ${MONTHS_SHORT[d.getMonth()]} ${d.getFullYear()}`;
}

function todayISO(): string {
  return isoLocal(new Date());
}

function addDaysISO(iso: string, n: number): string {
  const d = parseISO(iso);
  d.setDate(d.getDate() + n);
  return isoLocal(d);
}

interface Props {
  label: string;
  value: string; // YYYY-MM-DD or ''
  onSelect: (iso: string) => void;
  placeholder?: string;
  note?: string;
}

const DEFAULT_PLACEHOLDER = 'Select journey date';
const DEFAULT_NOTE =
  'Tatkal opens 1 day before the journey date · booking up to 60 days ahead';

export default function DatePickerField({
  label,
  value,
  onSelect,
  placeholder = DEFAULT_PLACEHOLDER,
  note = DEFAULT_NOTE,
}: Props) {
  const { theme } = useTheme();
  const t = theme.typography;
  const [open, setOpen] = useState(false);
  const minISO = todayISO();
  const maxISO = addDaysISO(minISO, MAX_DAYS_OUT);
  const titleRef = useRef<Text>(null);

  // Move screen-reader focus into the sheet when it opens, so the picker
  // is announced instead of leaving focus behind the modal.
  useEffect(() => {
    if (!open) return;
    const timer = setTimeout(() => {
      const tag = findNodeHandle(titleRef.current);
      if (typeof tag === 'number') AccessibilityInfo.setAccessibilityFocus(tag);
    }, 400);
    return () => clearTimeout(timer);
  }, [open ]);

  const close = () => setOpen(false);

  // month cursor: first of the month containing `value`, else this month
  const initial = value || minISO;
  const [cursor, setCursor] = useState(() => initial.slice(0, 7));

  const [cy, cm] = cursor.split('-').map(Number);
  const firstDow = new Date(cy, cm - 1, 1).getDay();
  const daysInMonth = new Date(cy, cm, 0).getDate();

  const prevMonth = () => {
    const d = new Date(cy, cm - 2, 1);
    setCursor(isoLocal(d).slice(0, 7));
  };
  const nextMonth = () => {
    const d = new Date(cy, cm, 1);
    setCursor(isoLocal(d).slice(0, 7));
  };

  const minCursor = minISO.slice(0, 7);
  const maxCursor = maxISO.slice(0, 7);
  const canPrev = cursor > minCursor;
  const canNext = cursor < maxCursor;

  const cells: Array<{ iso: string; day: number } | null> = [];
  for (let i = 0; i < firstDow; i++) cells.push(null);
  for (let day = 1; day <= daysInMonth; day++) {
    cells.push({ iso: `${cursor}-${String(day).padStart(2, '0')}`, day });
  }

  const pick = (iso: string) => {
    onSelect(iso);
    close();
  };

  return (
    <View>
      <Text
        style={{
          fontSize: t.bodySm.size,
          fontWeight: '600',
          lineHeight: t.bodySm.lineHeight,
          color: theme.colors.ink,
          marginBottom: theme.spacing.xs,
        }}
      >
        {label}
      </Text>
      <TouchableOpacity
        style={{
          minHeight: 48,
          backgroundColor: theme.colors.surface,
          borderWidth: 1.5,
          borderColor: theme.colors.line,
          borderRadius: theme.radius.md,
          paddingHorizontal: theme.spacing.md,
          flexDirection: 'row',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
        accessibilityRole="button"
        accessibilityLabel={
          value ? `Pick journey date, currently ${formatLong(value)}` : 'Pick journey date'
        }
        onPress={() => {
          setCursor((value || minISO).slice(0, 7));
          setOpen(true);
        }}
      >
        <Text
          style={{
            fontSize: t.body.size,
            lineHeight: t.body.lineHeight,
            color: value ? theme.colors.ink : theme.colors.faint,
          }}
        >
          {value ? formatLong(value) : placeholder}
        </Text>
        <Icon
          name="calendar"
          size={20}
          color={theme.colors.muted}
          accessibilityLabel="Open calendar"
        />
      </TouchableOpacity>

      <Modal visible={open} transparent animationType="fade" onRequestClose={close}>
        <Pressable
          style={[
            styles.overlay,
            { backgroundColor: theme.colors.overlay, padding: theme.spacing.xl },
          ]}
          accessibilityRole="button"
          accessibilityLabel="Dismiss date picker"
          onPress={close}
        >
          {/* Inner pressable swallows touches so taps inside the sheet don't
              dismiss it; accessible={false} keeps it out of the a11y tree. */}
          <Pressable
            style={[
              styles.sheet,
              {
                backgroundColor: theme.colors.surface,
                borderColor: theme.colors.line,
                borderRadius: theme.radius.lg,
                padding: theme.spacing.lg,
                ...theme.elevation.lg,
              },
            ]}
            accessible={false}
            onPress={() => undefined}
          >
            <View style={styles.header}>
              <TouchableOpacity
                onPress={prevMonth}
                disabled={!canPrev}
                style={styles.navBtn}
                accessibilityRole="button"
                accessibilityLabel="Previous month"
                accessibilityState={{ disabled: !canPrev }}
              >
                <Text
                  style={[
                    styles.navText,
                    { color: canPrev ? theme.colors.primary : theme.colors.faint },
                  ]}
                >
                  ‹
                </Text>
              </TouchableOpacity>
              <Text
                ref={titleRef}
                style={{
                  fontSize: t.h3.size,
                  fontWeight: t.h3.weight,
                  lineHeight: t.h3.lineHeight,
                  color: theme.colors.ink,
                }}
                accessibilityLabel={`Journey date picker, ${MONTHS[cm - 1]} ${cy}`}
              >
                {MONTHS[cm - 1]} {cy}
              </Text>
              <TouchableOpacity
                onPress={nextMonth}
                disabled={!canNext}
                style={styles.navBtn}
                accessibilityRole="button"
                accessibilityLabel="Next month"
                accessibilityState={{ disabled: !canNext }}
              >
                <Text
                  style={[
                    styles.navText,
                    { color: canNext ? theme.colors.primary : theme.colors.faint },
                  ]}
                >
                  ›
                </Text>
              </TouchableOpacity>
            </View>

            <View style={styles.grid}>
              {DOW.map((d) => (
                <Text
                  key={d}
                  style={[
                    styles.dow,
                    { color: theme.colors.muted, fontSize: t.caption.size },
                  ]}
                >
                  {d}
                </Text>
              ))}
              {cells.map((c, i) =>
                c === null ? (
                  <View key={`e${i}`} style={styles.cell} />
                ) : (
                  (() => {
                    const disabled = c.iso < minISO || c.iso > maxISO;
                    const isSel = c.iso === value;
                    const isToday = c.iso === minISO;
                    return (
                      <TouchableOpacity
                        key={c.iso}
                        style={[
                          styles.cell,
                          isSel && {
                            backgroundColor: theme.colors.primary,
                            borderRadius: 20,
                          },
                        ]}
                        disabled={disabled}
                        accessibilityRole="button"
                        accessibilityLabel={formatLong(c.iso)}
                        accessibilityState={{ selected: isSel, disabled }}
                        onPress={() => pick(c.iso)}
                      >
                        <Text
                          style={[
                            styles.day,
                            { color: theme.colors.ink },
                            disabled && { color: theme.colors.faint },
                            isSel && { color: theme.colors.onPrimary, fontWeight: '800' },
                            isToday && !isSel && { color: theme.colors.primary, fontWeight: '800' },
                          ]}
                        >
                          {c.day}
                        </Text>
                      </TouchableOpacity>
                    );
                  })()
                ),
              )}
            </View>

            <Text
              style={{
                fontSize: t.caption.size,
                lineHeight: t.caption.lineHeight,
                color: theme.colors.muted,
                textAlign: 'center',
                marginTop: theme.spacing.sm,
              }}
            >
              {note}
            </Text>
            <TouchableOpacity
              style={styles.cancel}
              accessibilityRole="button"
              accessibilityLabel="Cancel, close date picker"
              onPress={close}
            >
              <Text
                style={{
                  fontSize: t.bodySm.size,
                  fontWeight: '600',
                  color: theme.colors.ink,
                }}
              >
                Cancel
              </Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'center',
  },
  sheet: {
    borderWidth: 1,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  navBtn: {
    padding: 8,
    minWidth: 44,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  navText: { fontSize: 26, fontWeight: '800' },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  dow: {
    width: '14.28%',
    textAlign: 'center',
    fontWeight: '700',
    marginBottom: 6,
  },
  cell: {
    width: '14.28%',
    aspectRatio: 1,
    minHeight: 44,
    justifyContent: 'center',
    alignItems: 'center',
  },
  day: { fontSize: 14 },
  cancel: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 12,
    minHeight: 44,
    marginTop: 4,
  },
});
