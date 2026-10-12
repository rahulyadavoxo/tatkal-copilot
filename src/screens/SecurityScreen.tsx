/**
 * SecurityScreen — Wave 2a (brief §33 + §34 combined).
 *
 * "Your data is protected" checklist + per-category data-location rows +
 * an expandable "Learn more" with slightly technical detail.
 *
 * Every claim here is TRUE of the actual architecture (verified against
 * src/core/vault.ts and src/vaultStore.ts):
 * - AES-256-GCM (noble) envelopes; 32-byte key from the native CSPRNG
 *   (expo-crypto), kept in expo-secure-store (the OS keystore).
 * - No cloud database, no analytics/tracking code anywhere in the app.
 * - The IRCTC password is NEVER stored. The user always types it by hand
 *   on IRCTC's own login page.
 * - Payment credentials are never touched: the user always pays by hand
 *   on IRCTC's gateway.
 */
import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { Nav } from '../App';
import { useTheme } from '../theme';
import {
  AppHeader,
  Card,
  Divider,
  Icon,
  Screen,
  SectionHeader,
  ICON_SIZE,
} from '../components/ui';

const CHECKLIST: { title: string; detail: string }[] = [
  {
    title: 'Encrypted storage (AES-256)',
    detail: 'Passengers, trips, PNRs and saved logins are encrypted on this phone.',
  },
  {
    title: 'The key stays on this device',
    detail: 'A 32-byte key from your phone\u2019s secure random generator, kept in the OS keystore. It is never uploaded or shared.',
  },
  {
    title: 'No cloud database',
    detail: 'There is no server, no account sync, no backup — your data simply has nowhere else to go.',
  },
  {
    title: 'No analytics, no tracking',
    detail: 'The app contains no analytics SDK and sends no usage data anywhere.',
  },
  {
    title: 'IRCTC password: never stored',
    detail: 'The app never saves it — you always type it yourself on IRCTC’s own login page.',
  },
  {
    title: 'No payment credentials, ever',
    detail: 'You always pay by hand on IRCTC\u2019s payment gateway. The app never sees or stores card, UPI or banking details.',
  },
  {
    title: 'Uninstall removes everything',
    detail: 'Deleting the app deletes the encrypted vault and its key. Nothing remains anywhere else.',
  },
];

const CATEGORIES: { name: string; where: string; encrypted: boolean }[] = [
  { name: 'Passengers', where: 'On this device, encrypted', encrypted: true },
  { name: 'Trips', where: 'On this device, encrypted', encrypted: true },
  { name: 'Tracked PNRs', where: 'On this device, encrypted', encrypted: true },
  { name: 'IRCTC username', where: 'On this device, encrypted', encrypted: true },
  { name: 'IRCTC password', where: 'Never stored — you type it by hand on IRCTC’s page', encrypted: false },
  { name: 'Analytics data', where: 'None — nothing is collected', encrypted: false },
  { name: 'Cloud backup', where: 'None — there is nothing to back up', encrypted: false },
];

export default function SecurityScreen({ nav }: { nav: Nav }) {
  void nav;
  const { theme } = useTheme();
  const t = theme.typography;
  const [learnMore, setLearnMore] = useState(false);

  return (
    <Screen>
      <AppHeader title="Privacy & security" subtitle="Plain-English promises" onBack={nav.back} />
      <Card>
        {CHECKLIST.map((c, i) => (
          <View key={c.title}>
            {i > 0 && <Divider />}
            <View style={styles.checkRow}>
              <View
                style={[styles.checkDot, { backgroundColor: theme.colors.success }]}
              >
                <Icon name="check" size={ICON_SIZE.xs} color={theme.colors.bg} />
              </View>
              <View style={styles.checkText}>
                <Text
                  style={{
                    fontSize: t.body.size,
                    fontWeight: '600',
                    lineHeight: t.body.lineHeight,
                    color: theme.colors.ink,
                  }}
                >
                  {c.title}
                </Text>
                <Text
                  style={{
                    fontSize: t.bodySm.size,
                    lineHeight: t.bodySm.lineHeight,
                    color: theme.colors.muted,
                    marginTop: 2,
                  }}
                >
                  {c.detail}
                </Text>
              </View>
            </View>
          </View>
        ))}
      </Card>

      <View style={styles.sectionGap} />
      <SectionHeader
        title="Your data stays with you"
        subtitle="Where each kind of data lives."
      />
      <Card padding="sm">
        {CATEGORIES.map((c, i) => (
          <View key={c.name}>
            {i > 0 && <Divider />}
            <View style={styles.catRow}>
              <Icon
                name={c.encrypted ? 'lock' : 'info'}
                size={20}
                color={c.encrypted ? theme.colors.successOnTint : theme.colors.muted}
              />
              <View style={styles.catText}>
                <Text
                  style={{
                    fontSize: t.body.size,
                    fontWeight: '600',
                    lineHeight: t.body.lineHeight,
                    color: theme.colors.ink,
                  }}
                >
                  {c.name}
                </Text>
                <Text
                  style={{
                    fontSize: t.bodySm.size,
                    lineHeight: t.bodySm.lineHeight,
                    color: theme.colors.muted,
                    marginTop: 2,
                  }}
                >
                  {c.where}
                </Text>
              </View>
            </View>
          </View>
        ))}
      </Card>

      <View style={styles.sectionGap} />
      <Card>
        <Pressable
          style={styles.learnHeader}
          accessibilityRole="button"
          accessibilityLabel={learnMore ? 'Hide technical details' : 'Learn more: technical details'}
          accessibilityState={{ expanded: learnMore }}
          onPress={() => setLearnMore((v) => !v)}
        >
          <Text
            style={{
              fontSize: t.h3.size,
              fontWeight: t.h3.weight,
              color: theme.colors.ink,
              flex: 1,
            }}
          >
            Learn more
          </Text>
          <Icon
            name="chevronDown"
            size={22}
            color={theme.colors.muted}
            style={learnMore ? { transform: [{ rotate: '180deg' }] } : undefined}
          />
        </Pressable>
        {learnMore && (
          <>
            <Divider />
            <Text
              style={{
                fontSize: t.bodySm.size,
                lineHeight: 22,
                color: theme.colors.muted,
              }}
            >
              Each collection (passengers, trips, PNRs, credentials, preferences)
              is encrypted separately with AES-256-GCM. The encryption key is a
              32-byte random value from your phone's secure hardware-backed
              random generator, stored in the operating system's keystore
              (Android Keystore via expo-secure-store). Tampered or moved data
              fails authentication and is rejected — the app never silently
              accepts corrupted data.{'\n\n'}
              The real security boundary is your device lock screen: anyone
              holding your unlocked phone can open the app, just like any app
              without an app-lock. There is deliberately no PIN or biometric
              gate inside the app today.
            </Text>
          </>
        )}
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  checkRow: { flexDirection: 'row', paddingVertical: 4 },
  checkDot: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
    marginTop: 2,
  },
  checkText: { flex: 1 },
  sectionGap: { height: 20 },
  catRow: { flexDirection: 'row', alignItems: 'flex-start', paddingVertical: 6 },
  catText: { flex: 1, marginLeft: 12 },
  learnHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 44,
  },
});
