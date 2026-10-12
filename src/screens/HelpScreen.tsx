/**
 * HelpScreen — Wave 2a (brief §51). The Booking Guide.
 *
 * Friendly, plain-language walkthrough of a Tatkal attempt: what to do,
 * what the app does for you, and — just as important — what it never does.
 * Covers the control boundaries, what to do when the automation pauses for
 * you, and the "Access Denied → Continue in Chrome" escape hatch (verified
 * present in BookingScreen).
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { Nav } from '../App';
import { useTheme } from '../theme';
import {
  AppHeader,
  Card,
  Divider,
  GhostButton,
  Icon,
  Screen,
  SectionHeader,
  ICON_SIZE,
} from '../components/ui';

const STEPS: { title: string; body: string }[] = [
  {
    title: '1. Prepare (do this once, calmly)',
    body: 'Add your passengers, create your trip (train, date, class, quota) and save your IRCTC username. Do this the evening before — not at 9:59 AM.',
  },
  {
    title: '2. Beat the clock',
    body: 'Tatkal opens at 10:00 for AC classes and 11:00 for non-AC, one day before the journey. Open your trip\u2019s countdown a few minutes early so you\u2019re ready, not rushed.',
  },
  {
    title: '3. Log in to IRCTC first',
    body: 'Log in on IRCTC\u2019s own page BEFORE the window opens. Heads-up: IRCTC sometimes asks you to log in again at booking time anyway — that\u2019s their rule, not the app\u2019s.',
  },
  {
    title: '4. The app runs the search, you watch',
    body: 'When the window opens, the app performs the train search and fills your saved passengers into IRCTC\u2019s form for you. Stay with it — it may need you at any moment.',
  },
  {
    title: '5. Check the filled details',
    body: 'Glance at names, ages and berth preferences on IRCTC\u2019s page. The app fills; you verify. Your eyes are the last checkpoint.',
  },
  {
    title: '6. CAPTCHA and OTP are yours',
    body: 'When IRCTC shows a CAPTCHA or sends an OTP, the app stops and hands you the keyboard. Solve them yourself, by hand — always.',
  },
  {
    title: '7. Review, then YOU pay',
    body: 'Read IRCTC\u2019s review page carefully, then pay by hand on IRCTC\u2019s own payment gateway. The app never touches your payment details.',
  },
];

const NEVER: string[] = [
  'Book a ticket by itself — the final tap is always yours.',
  'Store your IRCTC password — you always type it by hand on IRCTC’s page.',
  'Solve a CAPTCHA or auto-submit an OTP for you.',
  'See, touch or store your card, UPI or banking details.',
  'Promise you a confirmed seat — nobody can promise that, and you should distrust any app that does.',
];

const PAUSES: { title: string; body: string }[] = [
  {
    title: 'A CAPTCHA appears',
    body: 'The app pauses and shows it to you. Solve it yourself, then the attempt continues where it left off.',
  },
  {
    title: 'An OTP is needed',
    body: 'Type the OTP from your SMS yourself. The app will never read your messages or fill it in.',
  },
  {
    title: 'Payment time',
    body: 'The app stops at IRCTC\u2019s payment page on purpose. Pick your method and pay by hand — that part is entirely yours.',
  },
];

export default function HelpScreen({ nav }: { nav: Nav }) {
  const { theme } = useTheme();
  const t = theme.typography;

  const body = {
    fontSize: t.bodySm.size,
    lineHeight: 22,
    color: theme.colors.muted,
  };

  return (
    <Screen>
      <AppHeader title="Booking guide" subtitle="How a Tatkal attempt works" onBack={nav.back} />
      <Card>
        {STEPS.map((s, i) => (
          <View key={s.title}>
            {i > 0 && <Divider />}
            <View style={styles.row}>
              <View style={styles.text}>
                <Text
                  style={{
                    fontSize: t.body.size,
                    fontWeight: '700',
                    lineHeight: t.body.lineHeight,
                    color: theme.colors.ink,
                  }}
                >
                  {s.title}
                </Text>
                <Text style={[body, { marginTop: 4 }]}>{s.body}</Text>
              </View>
            </View>
          </View>
        ))}
      </Card>
      <View style={styles.actions}>
        <GhostButton title="Add passengers" onPress={() => nav.go({ name: 'passengers' })} />
        <GhostButton title="Create a trip" onPress={() => nav.go({ name: 'tripSetup' })} />
      </View>

      <View style={styles.sectionGap} />
      <SectionHeader title="The app never…" />
      <Card>
        {NEVER.map((line, i) => (
          <View key={line}>
            {i > 0 && <Divider />}
            <View style={styles.row}>
              <View style={[styles.xDot, { backgroundColor: theme.colors.dangerTint }]}>
                <Icon name="x" size={ICON_SIZE.xs} color={theme.colors.dangerOnTint} />
              </View>
              <Text style={[body, styles.text, { color: theme.colors.ink }]}>{line}</Text>
            </View>
          </View>
        ))}
      </Card>

      <View style={styles.sectionGap} />
      <SectionHeader
        title="When the app pauses for you"
        subtitle="Pauses are by design — the app is handing control back, not failing."
      />
      <Card>
        {PAUSES.map((p, i) => (
          <View key={p.title}>
            {i > 0 && <Divider />}
            <View style={styles.row}>
              <View style={[styles.xDot, { backgroundColor: theme.colors.warnTint }]}>
                <Icon name="clock" size={ICON_SIZE.xs} color={theme.colors.warnOnTint} />
              </View>
              <View style={styles.text}>
                <Text
                  style={{
                    fontSize: t.body.size,
                    fontWeight: '600',
                    lineHeight: t.body.lineHeight,
                    color: theme.colors.ink,
                  }}
                >
                  {p.title}
                </Text>
                <Text style={[body, { marginTop: 2 }]}>{p.body}</Text>
              </View>
            </View>
          </View>
        ))}
      </Card>

      <View style={styles.sectionGap} />
      <SectionHeader title="Seeing \u201CAccess Denied\u201D?" />
      <Card>
        <View style={styles.row}>
          <View style={[styles.xDot, { backgroundColor: theme.colors.infoTint }]}>
            <Icon name="info" size={ICON_SIZE.xs} color={theme.colors.infoOnTint} />
          </View>
          <Text style={[body, styles.text]}>
            IRCTC sometimes blocks the in-app browser ("Access Denied"). When
            that happens, use the <Text style={{ fontWeight: '700', color: theme.colors.ink }}>Continue in Chrome</Text> button —
            it opens the same IRCTC page in your real Chrome browser, where
            you can finish booking manually. The app steps aside; you stay in
            control.
          </Text>
        </View>
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', paddingVertical: 4 },
  text: { flex: 1 },
  xDot: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
    marginTop: 2,
  },
  sectionGap: { height: 20 },
  actions: { flexDirection: 'row', gap: 8, marginTop: 12 },
});
