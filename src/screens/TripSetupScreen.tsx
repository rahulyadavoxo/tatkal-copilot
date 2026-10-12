/**
 * TripSetup — 7-step wizard for journey details + class + passengers.
 * "Save trip" persists (encrypted) and moves to the Countdown screen.
 * With a tripId it edits that trip in place (prefilled once on entry).
 *
 * Validation rules and the vault save shape are identical to the old
 * single-screen form — only the presentation is a wizard now:
 *   1 Route → 2 Date → 3 Train → 4 Class → 5 Quota → 6 Passengers → 7 Review & save
 *
 * Tatkal PNR cap (MAX_PASSENGERS_PER_TATKAL_PNR = 4) is enforced in the UI:
 * once 4 are selected, the rest disable.
 */
import React, { useCallback, useRef, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { BERTH_LABELS, GENDER_LABELS, useTheme } from '../theme';
import { TATKAL_TIMING } from '../timingConfig';
import { tatkalBookingOpen } from '../core/timing';
import {
  IRCTC_CLASSES,
  IRCTC_QUOTAS,
  MAX_PASSENGERS_PER_TATKAL_PNR,
  isAcClass,
} from '../core/tatkalConfig';
import {
  PAYMENT_METHOD_LABELS,
  PAYMENT_MODE_LABELS,
  PAYMENT_PROVIDER_LABELS,
  loadPassengers,
  loadTrips,
  newId,
  saveTrips,
  type Passenger,
  type PaymentMethod,
  type PaymentMode,
  type PaymentProvider,
  type Trip,
} from '../vaultStore';
import type { Nav } from '../App';
import { useFocusLoad } from './hooks';
import StationField from './StationField';
import TrainField from './TrainField';
import DatePickerField from './DatePickerField';
import {
  AppHeader,
  Card,
  EmptyState,
  GhostButton,
  PrimaryButton,
  ProgressStepper,
  Screen,
  LabeledInput,
  SectionHeader,
  SegmentedControl,
  type SegmentOption,
} from '../components/ui';
import { Icon, ICON_SIZE } from '../components/icons';

const STEPS = ['Route', 'Date', 'Train', 'Class', 'Quota', 'Passengers', 'Review'] as const;

const AC_CLASSES: string[] = [
  'All Classes',
  ...IRCTC_CLASSES.filter((c) => c !== 'All Classes' && isAcClass(c)),
];
const NON_AC_CLASSES: string[] = IRCTC_CLASSES.filter((c) => !isAcClass(c));

function toOptions(values: readonly string[]): SegmentOption<string>[] {
  return values.map((v) => ({ value: v, label: v }));
}

export default function TripSetupScreen({
  nav,
  tripId,
}: {
  nav: Nav;
  tripId?: string;
}) {
  const { theme } = useTheme();
  const t = theme.typography;
  const [step, setStep] = useState(0);
  const [passengers, setPassengers] = useState<Passenger[]>([]);
  const [trainNo, setTrainNo] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [journeyDate, setJourneyDate] = useState('');
  const [classCode, setClassCode] = useState<string>('3A');
  const [quota, setQuota] = useState<string>('TATKAL');
  const [selected, setSelected] = useState<string[]>([]);
  const [contactMobile, setContactMobile] = useState('');
  const [travelInsurance, setTravelInsurance] = useState(true);
  const [autoUpgradation, setAutoUpgradation] = useState(false);
  const [paymentMode, setPaymentMode] = useState<PaymentMode>('default');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('default');
  const [paymentProvider, setPaymentProvider] = useState<PaymentProvider>('default');
  const [error, setError] = useState('');
  const prefilled = useRef(false);

  const editing = !!tripId;

  const reload = useCallback(async () => {
    setPassengers(await loadPassengers());
    // Prefill once when editing an existing trip (never clobber typing on
    // later focuses — useFocusLoad fires every time the screen gains focus).
    if (editing && tripId && !prefilled.current) {
      const trip = (await loadTrips()).find((x) => x.id === tripId);
      if (trip) {
        setTrainNo(trip.trainNo);
        setFrom(trip.from);
        setTo(trip.to);
        setJourneyDate(trip.journeyDate);
        setClassCode(trip.classCode);
        setQuota(trip.quota ?? 'TATKAL');
        setSelected(trip.passengerIds);
        setContactMobile(trip.contactMobile ?? '');
        setTravelInsurance(trip.travelInsurance ?? true);
        setAutoUpgradation(trip.autoUpgradation ?? false);
        setPaymentMode(trip.paymentMode ?? 'default');
        setPaymentMethod(trip.paymentMethod ?? 'default');
        setPaymentProvider(trip.paymentProvider ?? 'default');
        prefilled.current = true;
      }
    }
  }, [editing, tripId]);
  useFocusLoad(reload);

  const isAC = isAcClass(classCode);

  const togglePax = (id: string) => {
    setSelected((s) =>
      s.includes(id)
        ? s.filter((x) => x !== id)
        : s.length >= MAX_PASSENGERS_PER_TATKAL_PNR
          ? s // cap enforced: ignore taps beyond 4
          : [...s, id],
    );
  };

  const save = async () => {
    setError('');
    const tn = trainNo.trim();
    const f = from.trim().toUpperCase();
    const tt = to.trim().toUpperCase();
    const d = journeyDate.trim();
    if (!/^\d{5}$/.test(tn)) {
      setError('Train number must be exactly 5 digits — use “Find train number” below if you don’t know it.');
      return;
    }
    if (!f || !tt) {
      setError('Pick the from and to stations from the search list.');
      return;
    }
    if (f === tt) {
      setError('From and to stations can’t be the same.');
      return;
    }
    if (selected.length === 0) {
      setError('Select at least one passenger.');
      return;
    }
    if (!d) {
      setError('Pick the journey date from the calendar.');
      return;
    }
    const mob = contactMobile.replace(/\D/g, '');
    if (mob && !/^[6-9]\d{9}$/.test(mob)) {
      setError('Mobile number must be a 10-digit Indian number (or leave it empty — IRCTC usually fills it from your profile).');
      return;
    }
    // Validate the date by running the real window math (throws on bad input).
    try {
      tatkalBookingOpen(d, isAC, TATKAL_TIMING);
    } catch {
      setError('That journey date isn’t a valid calendar date — pick it from the calendar.');
      return;
    }
    // The calendar only offers today..+60 days, but typed or old saved data
    // can be anything — reject past dates and absurdly far-future ones.
    const nowLocal = new Date();
    const p2 = (n: number) => String(n).padStart(2, '0');
    const todayStr = `${nowLocal.getFullYear()}-${p2(nowLocal.getMonth() + 1)}-${p2(nowLocal.getDate())}`;
    const maxDate = new Date(nowLocal);
    maxDate.setDate(maxDate.getDate() + 365);
    const maxStr = `${maxDate.getFullYear()}-${p2(maxDate.getMonth() + 1)}-${p2(maxDate.getDate())}`;
    if (d < todayStr) {
      setError('Journey date can’t be in the past — pick today or a future date.');
      return;
    }
    if (d > maxStr) {
      setError('Journey date is more than a year away — the Tatkal window only opens 1 day before travel.');
      return;
    }
    const trip: Trip = {
      id: editing && tripId ? tripId : newId('trip'),
      trainNo: tn,
      from: f,
      to: tt,
      journeyDate: d,
      classCode,
      quota,
      isAC,
      passengerIds: selected,
      contactMobile: mob,
      travelInsurance,
      autoUpgradation,
      paymentMode,
      paymentMethod,
      paymentProvider,
      createdAt: Date.now(),
    };
    const trips = await loadTrips();
    try {
      // Edit mode replaces the existing trip in place (keeping its id so the
      // countdown screen keeps working); new mode appends.
      await saveTrips(
        editing ? trips.map((x) => (x.id === trip.id ? { ...trip, createdAt: x.createdAt } : x)) : [...trips, trip],
      );
    } catch (e) {
      setError(
        'Could not save the trip — storage unavailable. ' +
          String(e instanceof Error ? e.message : e),
      );
      return;
    }
    nav.go({ name: 'countdown', tripId: trip.id });
  };

  // Per-step gate for Continue — the same checks save() runs, surfaced early.
  const stepError = (): string | null => {
    const f = from.trim().toUpperCase();
    const tt = to.trim().toUpperCase();
    if (step === 0) {
      if (!f || !tt) return 'Pick the from and to stations from the search list.';
      if (f === tt) return 'From and to stations can’t be the same.';
      return null;
    }
    if (step === 1) {
      if (!journeyDate.trim()) return 'Pick the journey date from the calendar.';
      return null;
    }
    if (step === 2) {
      if (!/^\d{5}$/.test(trainNo.trim()))
        return 'Train number must be exactly 5 digits — use “Find train number” below if you don’t know it.';
      return null;
    }
    if (step === 5) {
      if (selected.length === 0) return 'Select at least one passenger.';
      return null;
    }
    return null;
  };

  const goContinue = () => {
    const err = stepError();
    if (err) {
      setError(err);
      return;
    }
    setError('');
    setStep((s) => Math.min(s + 1, STEPS.length - 1));
  };

  const goBack = () => {
    setError('');
    if (step > 0) setStep((s) => s - 1);
    else nav.back();
  };

  const capHit = selected.length >= MAX_PASSENGERS_PER_TATKAL_PNR;
  const lastStep = step === STEPS.length - 1;

  const renderStep = () => {
    switch (step) {
      case 0:
        return (
          <>
            <SectionHeader
              title="Where are you going?"
              subtitle="Pick the from and to stations."
            />
            <StationField label="From" value={from} onSelect={setFrom} placeholder="Type station name or code…" />
            <StationField label="To" value={to} onSelect={setTo} placeholder="Type station name or code…" />
          </>
        );
      case 1:
        return (
          <>
            <SectionHeader
              title="When do you travel?"
              subtitle="Tatkal opens 1 day before the journey date."
            />
            <DatePickerField label="Journey date" value={journeyDate} onSelect={setJourneyDate} />
          </>
        );
      case 2:
        return (
          <>
            <SectionHeader
              title="Which train?"
              subtitle="Type the name or the 5-digit number."
            />
            <TrainField
              label="Train"
              value={trainNo}
              onSelect={setTrainNo}
              placeholder="Type train name or number…"
            />
            <TouchableOpacity
              style={styles.linkBtn}
              accessibilityRole="button"
              accessibilityLabel="Find train number on IRCTC"
              onPress={() => nav.go({ name: 'trainLookup' })}
            >
              <Icon name="search" size={ICON_SIZE.xs} color={theme.colors.primary} accessibilityLabel="Search" />
              <Text style={[styles.link, { color: theme.colors.primary }]}>
                Train not in the list? Find it on IRCTC →
              </Text>
            </TouchableOpacity>
          </>
        );
      case 3:
        return (
          <>
            <SectionHeader
              title="Which class?"
              subtitle="AC opens 10:00, Non-AC opens 11:00 IST."
            />
            <SegmentedControl<string>
              label="AC classes"
              options={toOptions(AC_CLASSES)}
              value={classCode}
              onChange={setClassCode}
            />
            <View style={styles.gap} />
            <SegmentedControl<string>
              label="Non-AC classes"
              options={toOptions(NON_AC_CLASSES)}
              value={classCode}
              onChange={setClassCode}
            />
          </>
        );
      case 4:
        return (
          <>
            <SectionHeader
              title="Which quota?"
              subtitle="Tatkal and Premium Tatkal open in the timed window — the rest book anytime."
            />
            <SegmentedControl<string>
              label="Quota (as shown on IRCTC’s search page)"
              options={toOptions(IRCTC_QUOTAS)}
              value={quota}
              onChange={setQuota}
            />
          </>
        );
      case 5:
        return (
          <>
            <SectionHeader
              title="Who’s travelling?"
              subtitle={`${selected.length} of ${MAX_PASSENGERS_PER_TATKAL_PNR} selected`}
            />
            {passengers.length === 0 ? (
              <EmptyState
                icon="users"
                title="No passengers yet"
                message="Add your family on the Passengers screen first — then come back and pick who’s travelling."
                actionLabel="Go to Passengers"
                onAction={() => nav.go({ name: 'passengers' })}
              />
            ) : (
              passengers.map((p) => {
                const on = selected.includes(p.id);
                const disabled = !on && capHit;
                return (
                  <TouchableOpacity
                    key={p.id}
                    disabled={disabled}
                    style={[
                      styles.pax,
                      {
                        borderColor: on ? theme.colors.primary : theme.colors.line,
                        backgroundColor: on ? theme.colors.primaryTint : theme.colors.surface,
                        opacity: disabled ? 0.45 : 1,
                      },
                    ]}
                    accessibilityRole="checkbox"
                    accessibilityLabel={`${p.name}, age ${p.age}, ${GENDER_LABELS[p.gender]}, ${BERTH_LABELS[p.berthPref] ?? p.berthPref}${on ? ', selected' : ''}${disabled ? ', unavailable — passenger limit reached' : ''}`}
                    accessibilityState={{ selected: on, disabled }}
                    onPress={() => togglePax(p.id)}
                  >
                    <View
                      style={[
                        styles.checkbox,
                        {
                          borderColor: on ? theme.colors.primary : theme.colors.line,
                          backgroundColor: on ? theme.colors.primary : 'transparent',
                        },
                      ]}
                    >
                      {on ? <Icon name="check" size={ICON_SIZE.xs} color={theme.colors.onPrimary} accessibilityLabel="Selected" /> : null}
                    </View>
                    <View style={styles.paxTextWrap}>
                      <Text style={[styles.paxName, { color: theme.colors.ink }]}>
                        {p.name}, {p.age}
                      </Text>
                      <Text style={[styles.paxSub, { color: theme.colors.muted }]}>
                        {GENDER_LABELS[p.gender]} · {BERTH_LABELS[p.berthPref] ?? p.berthPref}
                      </Text>
                    </View>
                  </TouchableOpacity>
                );
              })
            )}
          </>
        );
      default:
        return (
          <>
            <SectionHeader
              title="Review & save"
              subtitle="A few last details — then you’re ready."
            />
            <LabeledInput
              label="Contact mobile"
              hint="IRCTC’s form field — leave empty and IRCTC fills it from your profile"
              keyboardType="phone-pad"
              placeholder="10-digit mobile number"
              value={contactMobile}
              onChangeText={(txt) => {
                // Digits only, live: pasting "+91 98765 43210" keeps the
                // 10-digit number instead of truncating the formatting
                // characters first.
                let d = txt.replace(/\D/g, '');
                if (d.length > 10 && d.startsWith('91')) d = d.slice(2);
                setContactMobile(d.slice(0, 10));
              }}
            />
            <View style={styles.gap} />
            <SegmentedControl<string>
              label="Travel insurance (₹0.45/person on IRCTC)"
              options={[
                { value: 'yes', label: 'Yes, take it' },
                { value: 'no', label: 'No, skip it' },
              ]}
              value={travelInsurance ? 'yes' : 'no'}
              onChange={(v) => setTravelInsurance(v === 'yes')}
            />
            <View style={styles.gap} />
            <SegmentedControl<string>
              label="Auto upgradation (IRCTC’s “Consider for auto upgradation”)"
              options={[
                { value: 'yes', label: 'Yes, tick it' },
                { value: 'no', label: 'Leave IRCTC’s default' },
              ]}
              value={autoUpgradation ? 'yes' : 'no'}
              onChange={(v) => setAutoUpgradation(v === 'yes')}
            />
            <View style={styles.gap} />
            <SegmentedControl<PaymentMode>
              label="Payment mode (booking page, before you pay by hand)"
              options={(Object.keys(PAYMENT_MODE_LABELS) as PaymentMode[]).map((m) => ({
                value: m,
                label: PAYMENT_MODE_LABELS[m],
              }))}
              value={paymentMode}
              onChange={setPaymentMode}
            />
            <View style={styles.gap} />
            <SegmentedControl<PaymentMethod>
              label="Payment method (IRCTC’s Payment Methods page)"
              options={(Object.keys(PAYMENT_METHOD_LABELS) as PaymentMethod[]).map((m) => ({
                value: m,
                label: PAYMENT_METHOD_LABELS[m],
              }))}
              value={paymentMethod}
              onChange={setPaymentMethod}
            />
            <View style={styles.gap} />
            <SegmentedControl<PaymentProvider>
              label="Pay with (provider list, then you pay by hand)"
              options={(Object.keys(PAYMENT_PROVIDER_LABELS) as PaymentProvider[]).map((m) => ({
                value: m,
                label: PAYMENT_PROVIDER_LABELS[m],
              }))}
              value={paymentProvider}
              onChange={setPaymentProvider}
            />
            <View style={styles.gap} />
            <Card>
              <Text
                style={{
                  fontSize: t.bodySm.size,
                  lineHeight: t.bodySm.lineHeight,
                  color: theme.colors.muted,
                }}
              >
                Tatkal Copilot only prepares your booking — you stay in
                control: you type the password, solve the CAPTCHA and OTP, and
                pay by hand on IRCTC.
              </Text>
            </Card>
          </>
        );
    }
  };

  return (
    <Screen>
      <AppHeader title={editing ? 'Edit trip' : 'New trip'} onBack={nav.back} />
      <ProgressStepper steps={[...STEPS]} current={step} />
      <View style={{ marginTop: theme.spacing.lg }}>{renderStep()}</View>

      {error ? (
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'flex-start',
            marginTop: theme.spacing.md,
          }}
        >
          <Icon name="alertTriangle" size={ICON_SIZE.xs} color={theme.colors.danger} accessibilityLabel="Error" />
          <Text
            accessibilityRole="alert"
            style={{
              fontSize: t.bodySm.size,
              fontWeight: '600',
              lineHeight: t.bodySm.lineHeight,
              color: theme.colors.danger,
              marginLeft: theme.spacing.xs,
              flex: 1,
            }}
          >
            {error}
          </Text>
        </View>
      ) : null}

      <View style={styles.footer}>
        <GhostButton
          title="Back"
          accessibilityLabel={step > 0 ? 'Go to previous step' : 'Go back'}
          onPress={goBack}
        />
        {lastStep ? (
          <PrimaryButton
            title={editing ? 'Save changes' : 'Save trip'}
            accessibilityLabel={editing ? 'Save changes and go to countdown' : 'Save trip and go to countdown'}
            onPress={() => void save()}
            icon="check"
          />
        ) : (
          <PrimaryButton
            title="Continue"
            accessibilityLabel={`Continue to step ${step + 2}: ${STEPS[step + 1]}`}
            onPress={goContinue}
            icon="chevronRight"
          />
        )}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  gap: { height: 16 },
  linkBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: 44,
    alignSelf: 'flex-start',
    marginTop: 4,
  },
  link: { fontSize: 13, fontWeight: '700' },
  pax: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1.5,
    borderRadius: 12,
    padding: 12,
    marginBottom: 8,
    minHeight: 64,
  },
  checkbox: {
    width: 26,
    height: 26,
    borderRadius: 8,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  paxTextWrap: { flex: 1 },
  paxName: { fontSize: 15, fontWeight: '700' },
  paxSub: { fontSize: 13, marginTop: 2 },
  footer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 24,
    paddingBottom: 8,
  },
});
