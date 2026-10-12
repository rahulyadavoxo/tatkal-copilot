/**
 * OnboardingScreen — Wave 2a (brief §68–69). Privacy-first first-launch flow.
 *
 * Phase 1: a short 3-page pager —
 *   1. "Your data stays on your phone" (encrypted vault, no cloud/tracking)
 *   2. "Prepare once" (passengers + trip saved ahead of time)
 *   3. "You stay in control" (final tap yours; CAPTCHA/OTP/payment manual)
 * Phase 2: guided setup checklist driven by REAL vault state — add passenger
 * → create trip → save IRCTC username → check readiness → home.
 *
 * The screen re-reads the vault on every mount (useFocusLoad), so returning
 * from the passengers / trip-setup / IRCTC screens automatically ticks steps
 * off. Completion is persisted with a tiny expo-secure-store key
 * (tatkal_onboarding_done) — see src/onboarding.ts. The flag is set only
 * when the user finishes, so backing out mid-flow re-shows onboarding on
 * the next launch.
 */
import React, { useCallback, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { Nav } from '../App';
import { useTheme } from '../theme';
import {
  Card,
  Divider,
  GhostButton,
  Icon,
  PrimaryButton,
  Screen,
  SecondaryButton,
  SectionHeader,
  ICON_SIZE,
} from '../components/ui';
import type { IconName } from '../components/icons';
import {
  loadIrctcCredentials,
  loadPassengers,
  loadTrips,
} from '../vaultStore';
import { setOnboardingDone } from '../onboarding';
import { useFocusLoad } from './hooks';

const PAGES: { icon: IconName; title: string; body: string }[] = [
  {
    icon: 'shield',
    title: 'Your data stays on your phone',
    body: 'Passengers, trips and PNRs are stored encrypted (AES-256) on this device only. There is no cloud account, no analytics and no tracking — uninstalling the app wipes everything.',
  },
  {
    icon: 'train',
    title: 'Prepare once, before the rush',
    body: 'Save your passengers and your trip ahead of time — train, date, class and quota. When the Tatkal window opens, everything is already filled in and ready to go.',
  },
  {
    icon: 'check',
    title: 'You stay in control',
    body: 'This app prepares your booking attempt — it never books by itself. The final tap is always yours. CAPTCHA and OTP are always solved by you, by hand, and you always pay yourself on IRCTC\u2019s own gateway.',
  },
];

interface SetupState {
  loaded: boolean;
  hasPassenger: boolean;
  hasTrip: boolean;
  firstTripId: string | null;
  hasIrctcUsername: boolean;
}

const blank: SetupState = {
  loaded: false,
  hasPassenger: false,
  hasTrip: false,
  firstTripId: null,
  hasIrctcUsername: false,
};

export default function OnboardingScreen({ nav }: { nav: Nav }) {
  const { theme } = useTheme();
  const t = theme.typography;
  const [phase, setPhase] = useState<'pager' | 'setup'>('pager');
  const [page, setPage] = useState(0);
  const [setup, setSetup] = useState<SetupState>(blank);

  const reload = useCallback(async () => {
    try {
      const [pax, trips, creds] = await Promise.all([
        loadPassengers(),
        loadTrips(),
        loadIrctcCredentials(),
      ]);
      setSetup({
        loaded: true,
        hasPassenger: pax.length > 0,
        hasTrip: trips.length > 0,
        firstTripId: trips.length > 0 ? trips[0].id : null,
        hasIrctcUsername: !!creds?.username?.trim(),
      });
    } catch {
      setSetup({ ...blank, loaded: true });
    }
  }, []);
  useFocusLoad(reload);

  const finish = useCallback(async () => {
    await setOnboardingDone();
    nav.reset({ name: 'home' });
  }, [nav]);

  /* ------------------------------ pager ------------------------------ */
  if (phase === 'pager') {
    const p = PAGES[page];
    const last = page === PAGES.length - 1;
    return (
      <Screen>
        <View style={styles.pagerWrap}>
          <View
            style={[styles.iconRing, { backgroundColor: theme.colors.primaryTint }]}
          >
            <Icon name={p.icon} size={ICON_SIZE.hero} color={theme.colors.primaryOnTint} />
          </View>
          <Text
            style={{
              fontSize: t.h1.size,
              fontWeight: t.h1.weight,
              lineHeight: t.h1.lineHeight,
              color: theme.colors.ink,
              textAlign: 'center',
              marginTop: theme.spacing.xl,
            }}
          >
            {p.title}
          </Text>
          <Text
            style={{
              fontSize: t.body.size,
              lineHeight: t.body.lineHeight,
              color: theme.colors.muted,
              textAlign: 'center',
              marginTop: theme.spacing.md,
            }}
          >
            {p.body}
          </Text>
          <View style={styles.dots} accessibilityRole="tablist" accessibilityLabel="Intro pages">
            {PAGES.map((_, i) => (
              <View
                key={i}
                style={[
                  styles.dot,
                  {
                    backgroundColor:
                      i === page ? theme.colors.primary : theme.colors.line,
                    width: i === page ? 24 : 8,
                  },
                ]}
              />
            ))}
          </View>
          <View style={styles.pagerActions}>
            {page > 0 ? (
              <SecondaryButton title="Back" onPress={() => setPage(page - 1)} />
            ) : (
              <GhostButton title="Skip intro" onPress={() => setPhase('setup')} />
            )}
            <PrimaryButton
              title={last ? 'Continue' : 'Next'}
              onPress={() => (last ? setPhase('setup') : setPage(page + 1))}
            />
          </View>
        </View>
      </Screen>
    );
  }

  /* --------------------------- guided setup --------------------------- */
  const steps: {
    label: string;
    done: boolean;
    hint: string;
    action: string;
    onPress: () => void;
    disabled?: boolean;
  }[] = [
    {
      label: 'Add a passenger',
      done: setup.hasPassenger,
      hint: setup.hasPassenger ? 'Done — you can add more later.' : 'The travellers IRCTC\u2019s form will be filled with.',
      action: setup.hasPassenger ? 'Manage passengers' : 'Add passenger',
      onPress: () => nav.go({ name: 'passengers' }),
    },
    {
      label: 'Create your trip',
      done: setup.hasTrip,
      hint: setup.hasTrip ? 'Done — you can create more trips later.' : 'Train, date, class, quota and travellers for one journey.',
      action: setup.hasTrip ? 'Manage trips' : 'Create trip',
      onPress: () => nav.go({ name: 'tripSetup' }),
    },
    {
      label: 'Save your IRCTC username',
      done: setup.hasIrctcUsername,
      hint: setup.hasIrctcUsername
        ? 'Done — saved encrypted on this phone.'
        : 'So the app can fill it on IRCTC\u2019s login page. Log in yourself before the window opens.',
      action: setup.hasIrctcUsername ? 'Review IRCTC account' : 'Save username',
      onPress: () => nav.go({ name: 'irctcAccount' }),
    },
    {
      label: 'Check booking readiness',
      done: false,
      hint: setup.hasTrip
        ? 'See your trip\u2019s countdown and readiness checklist.'
        : 'Create a trip first — then its readiness checklist unlocks.',
      action: 'View readiness',
      onPress: () =>
        setup.firstTripId && nav.go({ name: 'countdown', tripId: setup.firstTripId }),
      disabled: !setup.hasTrip,
    },
  ];
  const allDone =
    setup.loaded && setup.hasPassenger && setup.hasTrip && setup.hasIrctcUsername;

  return (
    <Screen>
      <SectionHeader
        title={allDone ? 'You\u2019re all set!' : 'Let\u2019s get you ready'}
        subtitle={
          allDone
            ? 'Everything is prepared. The Tatkal window is yours to take.'
            : 'Four quick steps — each takes under a minute. You can finish later from Home.'
        }
      />
      <Card>
        {steps.map((s, i) => (
          <View key={s.label}>
            {i > 0 && <Divider />}
            <View style={styles.stepRow}>
              <View
                style={[
                  styles.stepDot,
                  {
                    backgroundColor: s.done ? theme.colors.success : theme.colors.surface2,
                  },
                ]}
              >
                {s.done && <Icon name="check" size={ICON_SIZE.xs} color={theme.colors.bg} />}
              </View>
              <View style={styles.stepText}>
                <Text
                  style={{
                    fontSize: t.body.size,
                    fontWeight: '600',
                    lineHeight: t.body.lineHeight,
                    color: theme.colors.ink,
                  }}
                >
                  {s.label}
                </Text>
                <Text
                  style={{
                    fontSize: t.bodySm.size,
                    lineHeight: t.bodySm.lineHeight,
                    color: theme.colors.muted,
                    marginTop: 2,
                  }}
                >
                  {s.hint}
                </Text>
                {!s.done && (
                  <View style={styles.stepAction}>
                    <SecondaryButton
                      title={s.action}
                      onPress={s.onPress}
                      disabled={s.disabled}
                    />
                  </View>
                )}
              </View>
            </View>
          </View>
        ))}
      </Card>
      <View style={styles.finishRow}>
        <PrimaryButton
          title={allDone ? 'Go to Home' : 'Finish — I\u2019ll do the rest later'}
          onPress={finish}
          fullWidth
          size="lg"
        />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  pagerWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 32,
  },
  iconRing: {
    width: 96,
    height: 96,
    borderRadius: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dots: {
    flexDirection: 'row',
    gap: 6,
    marginTop: 28,
    alignItems: 'center',
  },
  dot: { height: 8, borderRadius: 4 },
  pagerActions: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 32,
    alignItems: 'center',
  },
  stepRow: { flexDirection: 'row', paddingVertical: 4 },
  stepDot: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
    marginTop: 2,
  },
  stepText: { flex: 1 },
  stepAction: { marginTop: 10, alignSelf: 'flex-start' },
  finishRow: { marginTop: 20 },
});
