/**
 * Passengers — "Passenger vault". CRUD over the encrypted vault.
 * All writes go through vaultStore (AES-256-GCM); plaintext never persists.
 *
 * Validation rules and vault shapes are identical to the old screen — only
 * the presentation changed: SecureVaultCard header, saved-counter, card
 * list, BottomSheet form with inline validation, confirm dialog on delete
 * (with the trip-reference warning), skeleton loading and error retry.
 */
import React, { useCallback, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { BERTH_LABELS, GENDER_LABELS, useTheme } from '../theme';
import { MAX_PASSENGERS_PER_TATKAL_PNR } from '../core/tatkalConfig';
import { DEFAULT_MEAL, MEAL_OPTIONS } from '../core/fillEngine';
import {
  loadPassengers,
  loadTrips,
  newId,
  savePassengers,
  saveTrips,
  type Gender,
  type Passenger,
} from '../vaultStore';
import type { Nav } from '../App';
import { useFocusLoad } from './hooks';
import {
  AppHeader,
  AppDialog,
  BottomSheet,
  EmptyState,
  ErrorState,
  PassengerCard,
  PrimaryButton,
  Screen,
  LabeledInput,
  SecondaryButton,
  SecureVaultCard,
  SegmentedControl,
  Skeleton,
} from '../components/ui';

const BERTHS = Object.keys(BERTH_LABELS);
const GENDERS: Gender[] = ['M', 'F', 'O'];

function blank(): Passenger {
  return { id: newId('pax'), name: '', age: 30, gender: 'M', berthPref: 'LB', mealPref: DEFAULT_MEAL };
}

export default function PassengersScreen({ nav }: { nav: Nav }) {
  const { theme } = useTheme();
  const t = theme.typography;
  const [list, setList] = useState<Passenger[]>([]);
  const [loading, setLoading] = useState(true);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editing, setEditing] = useState<Passenger | null>(null);
  const [fieldErrors, setFieldErrors] = useState<{ name?: string; age?: string }>({});
  const [saveError, setSaveError] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<Passenger | null>(null);
  const [deleteUsedBy, setDeleteUsedBy] = useState(0);
  // Last persist attempt, so "Try again" can retry the exact failed write.
  const pendingRef = useRef<Passenger[] | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      setList(await loadPassengers());
    } finally {
      setLoading(false);
    }
  }, []);
  useFocusLoad(reload);

  const persist = async (next: Passenger[]) => {
    setSaveError('');
    pendingRef.current = next;
    try {
      await savePassengers(next);
      setList(next);
      pendingRef.current = null;
    } catch (e) {
      // Never fake a success: if the encrypted write fails, say so loudly.
      setSaveError(
        'Could not save — storage unavailable. Your passenger was NOT saved. ' +
          String(e instanceof Error ? e.message : e),
      );
    }
  };

  const openAdd = () => {
    setEditing(blank());
    setFieldErrors({});
    setSheetOpen(true);
  };

  const openEdit = (item: Passenger) => {
    setEditing({ ...item });
    setFieldErrors({});
    setSheetOpen(true);
  };

  const closeSheet = () => {
    setSheetOpen(false);
    setEditing(null);
    setFieldErrors({});
  };

  const saveEdit = async () => {
    if (!editing) return;
    const name = editing.name.trim();
    const age = Math.floor(Number(editing.age));
    // Inline validation — same rules as before (invalid data is never
    // persisted), now explained at the field instead of silently ignored.
    const errs: { name?: string; age?: string } = {};
    if (!name) errs.name = 'Type the passenger’s full name, as on ID.';
    if (!Number.isFinite(age) || age < 1 || age > 120)
      errs.age = 'Age must be between 1 and 120.';
    setFieldErrors(errs);
    if (Object.keys(errs).length > 0) return;
    const clean: Passenger = { ...editing, name, age };
    const next = list.some((p) => p.id === clean.id)
      ? list.map((p) => (p.id === clean.id ? clean : p))
      : [...list, clean];
    closeSheet();
    await persist(next);
  };

  const askDelete = async (item: Passenger) => {
    const trips = await loadTrips();
    setDeleteUsedBy(trips.filter((x) => x.passengerIds.includes(item.id)).length);
    setDeleteTarget(item);
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    const target = deleteTarget;
    setDeleteTarget(null);
    await persist(list.filter((p) => p.id !== target.id));
    // The dialog promises the passenger is removed from saved trips —
    // actually prune the reference so trips can't point at a ghost.
    const trips = await loadTrips();
    let changed = false;
    const pruned = trips.map((t) => {
      if (!t.passengerIds.includes(target.id)) return t;
      changed = true;
      return { ...t, passengerIds: t.passengerIds.filter((id) => id !== target.id) };
    });
    if (changed) await saveTrips(pruned);
  };

  return (
    <Screen>
      <AppHeader title="Passengers" subtitle="Encrypted on this phone" onBack={nav.back} />
      <SecureVaultCard />
      <View style={styles.counterRow}>
        <Text
          style={{
            fontSize: t.bodySm.size,
            fontWeight: '700',
            lineHeight: t.bodySm.lineHeight,
            color: theme.colors.ink,
          }}
          accessibilityLabel={`${list.length} of ${MAX_PASSENGERS_PER_TATKAL_PNR} passengers saved`}
        >
          {list.length} / {MAX_PASSENGERS_PER_TATKAL_PNR} passengers saved
        </Text>
        <Text
          style={{
            fontSize: t.caption.size,
            lineHeight: t.caption.lineHeight,
            color: theme.colors.muted,
            marginTop: 2,
          }}
        >
          Up to {MAX_PASSENGERS_PER_TATKAL_PNR} travel on one Tatkal booking.
        </Text>
      </View>

      {loading ? (
        <View accessibilityLabel="Loading passengers">
          {[0, 1, 2].map((i) => (
            <View key={i} style={{ marginBottom: theme.spacing.sm }}>
              <Skeleton height={76} radius={theme.radius.md} />
            </View>
          ))}
        </View>
      ) : saveError ? (
        <ErrorState
          title="Couldn’t save"
          message={saveError}
          onRetry={() => {
            if (pendingRef.current) void persist(pendingRef.current);
          }}
          retryLabel="Try again"
        />
      ) : list.length === 0 ? (
        <EmptyState
          icon="users"
          title="No passengers yet"
          message="Add your family here — their details stay encrypted on this phone, and you pick who’s travelling when you set up a trip."
          actionLabel="Add passenger"
          onAction={openAdd}
        />
      ) : (
        list.map((item) => (
          <View key={item.id} style={{ marginBottom: theme.spacing.sm }}>
            <PassengerCard
              name={item.name}
              age={item.age}
              genderLabel={GENDER_LABELS[item.gender]}
              berthLabel={BERTH_LABELS[item.berthPref] ?? item.berthPref}
              onEdit={() => openEdit(item)}
              onDelete={() => void askDelete(item)}
            />
          </View>
        ))
      )}

      {!loading && !saveError && list.length > 0 && (
        <View style={{ marginTop: theme.spacing.sm }}>
          <PrimaryButton title="+ Add passenger" onPress={openAdd} icon="plus" />
        </View>
      )}

      <BottomSheet
        visible={sheetOpen}
        onClose={closeSheet}
        title={editing && list.some((p) => p.id === editing.id) ? 'Edit passenger' : 'Add passenger'}
      >
        {editing && (
          <ScrollView
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <LabeledInput
              label="Full name"
              hint="As on ID"
              error={fieldErrors.name}
              placeholder="Full name (as on ID)"
              value={editing.name}
              onChangeText={(txt) => {
                setFieldErrors((e) => ({ ...e, name: undefined }));
                setEditing({ ...editing, name: txt });
              }}
              autoCapitalize="words"
              autoCorrect={false}
            />
            <View style={{ height: theme.spacing.md }} />
            <LabeledInput
              label="Age"
              error={fieldErrors.age}
              placeholder="Age"
              keyboardType="numeric"
              value={String(editing.age)}
              onChangeText={(txt) => {
                setFieldErrors((e) => ({ ...e, age: undefined }));
                setEditing({ ...editing, age: Number(txt) || 0 });
              }}
            />
            <View style={{ height: theme.spacing.md }} />
            <SegmentedControl<Gender>
              label="Gender"
              options={GENDERS.map((g) => ({ value: g, label: GENDER_LABELS[g] }))}
              value={editing.gender}
              onChange={(g) => setEditing({ ...editing, gender: g })}
            />
            <View style={{ height: theme.spacing.md }} />
            <SegmentedControl<string>
              label="Berth preference"
              options={BERTHS.map((b) => ({ value: b, label: BERTH_LABELS[b] }))}
              value={editing.berthPref}
              onChange={(b) => setEditing({ ...editing, berthPref: b })}
            />
            <View style={{ height: theme.spacing.md }} />
            <SegmentedControl<string>
              label="Meal (for trains with catering)"
              options={MEAL_OPTIONS.map((m) => ({ value: m as string, label: m as string }))}
              value={editing.mealPref ?? DEFAULT_MEAL}
              onChange={(m) => setEditing({ ...editing, mealPref: m })}
            />
            <View style={styles.formRow}>
              <View style={{ flex: 1 }}>
                <PrimaryButton title="Save" onPress={() => void saveEdit()} />
              </View>
              <View style={{ flex: 1 }}>
                <SecondaryButton title="Cancel" onPress={closeSheet} />
              </View>
            </View>
          </ScrollView>
        )}
      </BottomSheet>

      <AppDialog
        visible={deleteTarget !== null}
        title="Delete passenger?"
        message={
          deleteTarget
            ? deleteUsedBy > 0
              ? `"${deleteTarget.name}" is used in ${deleteUsedBy} saved trip${deleteUsedBy === 1 ? '' : 's'} — deleting removes them from those trips.`
              : `Delete "${deleteTarget.name}"? This can't be undone.`
            : ''
        }
        onDismiss={() => setDeleteTarget(null)}
        actions={[
          { label: 'Cancel', onPress: () => setDeleteTarget(null), variant: 'ghost' },
          { label: 'Delete', onPress: () => void confirmDelete(), variant: 'danger' },
        ]}
      />
      <View style={{ marginTop: theme.spacing.md }}>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  counterRow: { marginTop: 16, marginBottom: 12 },
  formRow: { flexDirection: 'row', gap: 8, marginTop: 20, paddingBottom: 8 },
});
