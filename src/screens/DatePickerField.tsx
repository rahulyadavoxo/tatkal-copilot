/**
 * DatePickerField — a self-contained month calendar (no native date-picker
 * dependency, so no new native modules). Constrained to IRCTC's world:
 * no past dates, max 60 days out (advance reservation period).
 */
import React, { useState } from 'react';
import {
  Modal,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { C } from '../theme';

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
}

export default function DatePickerField({ label, value, onSelect }: Props) {
  const [open, setOpen] = useState(false);
  const minISO = todayISO();
  const maxISO = addDaysISO(minISO, MAX_DAYS_OUT);

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
    setOpen(false);
  };

  return (
    <View>
      <Text style={styles.label}>{label}</Text>
      <TouchableOpacity
        style={styles.input}
        onPress={() => {
          setCursor((value || minISO).slice(0, 7));
          setOpen(true);
        }}
      >
        <Text style={[styles.inputText, !value && styles.placeholder]}>
          {value ? formatLong(value) : 'Select journey date'}
        </Text>
        <Text style={styles.calIcon}>📅</Text>
      </TouchableOpacity>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <View style={styles.overlay}>
          <View style={styles.sheet}>
            <View style={styles.header}>
              <TouchableOpacity onPress={prevMonth} disabled={!canPrev} style={styles.navBtn}>
                <Text style={[styles.navText, !canPrev && styles.navDisabled]}>‹</Text>
              </TouchableOpacity>
              <Text style={styles.monthTitle}>
                {MONTHS[cm - 1]} {cy}
              </Text>
              <TouchableOpacity onPress={nextMonth} disabled={!canNext} style={styles.navBtn}>
                <Text style={[styles.navText, !canNext && styles.navDisabled]}>›</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.grid}>
              {DOW.map((d) => (
                <Text key={d} style={styles.dow}>
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
                        style={[styles.cell, isSel && styles.cellSel]}
                        disabled={disabled}
                        onPress={() => pick(c.iso)}
                      >
                        <Text
                          style={[
                            styles.day,
                            disabled && styles.dayDisabled,
                            isSel && styles.daySel,
                            isToday && !isSel && styles.dayToday,
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

            <Text style={styles.note}>
              Tatkal opens 1 day before the journey date · booking up to 60 days ahead
            </Text>
            <TouchableOpacity style={styles.cancel} onPress={() => setOpen(false)}>
              <Text style={styles.cancelText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  label: { color: C.muted, fontSize: 13, marginTop: 10, marginBottom: 6 },
  input: {
    backgroundColor: C.card,
    borderColor: C.line,
    borderWidth: 1,
    borderRadius: 8,
    padding: 11,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  inputText: { color: C.ink, fontSize: 15 },
  placeholder: { color: C.muted },
  calIcon: { fontSize: 18 },
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    padding: 24,
  },
  sheet: {
    backgroundColor: C.card,
    borderColor: C.line,
    borderWidth: 1,
    borderRadius: 14,
    padding: 16,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  navBtn: { padding: 8, minWidth: 40, alignItems: 'center' },
  navText: { color: C.lime, fontSize: 26, fontWeight: '800' },
  navDisabled: { color: C.line },
  monthTitle: { color: C.ink, fontSize: 16, fontWeight: '800' },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  dow: {
    width: '14.28%',
    textAlign: 'center',
    color: C.muted,
    fontSize: 11,
    fontWeight: '700',
    marginBottom: 6,
  },
  cell: {
    width: '14.28%',
    aspectRatio: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  cellSel: { backgroundColor: C.lime, borderRadius: 20 },
  day: { color: C.ink, fontSize: 14 },
  dayDisabled: { color: '#3a3f35' },
  daySel: { color: C.bg, fontWeight: '800' },
  dayToday: { color: C.lime, fontWeight: '800' },
  note: { color: C.muted, fontSize: 11, textAlign: 'center', marginTop: 10 },
  cancel: { alignItems: 'center', padding: 12, marginTop: 4 },
  cancelText: { color: C.ink, fontSize: 14, fontWeight: '600' },
});
