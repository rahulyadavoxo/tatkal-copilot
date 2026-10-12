/**
 * Profile hub (§44) — navigation, not an account.
 *
 * There is no account system in this app (nothing to sign into, no cloud),
 * so this screen is a hub of ListRows into the app's real screens plus an
 * About block. Rows that point at shell-worker routes ('activity',
 * 'security', 'settings', 'help') go through goShell: a typed bridge that
 * compiles before App.tsx's Route union gains the members and keeps
 * working after it does.
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../theme';
import type { Theme } from '../theme';
import type { Nav, Route } from '../App';
import {
  AppHeader,
  Card,
  Divider,
  ListRow,
  Screen,
  SectionHeader,
  SecureVaultCard,
} from '../components/ui';
import type { IconName } from '../components/icons';

/**
 * Routes owned by the shell worker (added to App.tsx alongside this wave).
 * The cast keeps this file compiling before the union gains the members;
 * once App.tsx includes them the cast is a harmless no-op.
 */
type ShellRoute = {
  name: 'activity' | 'notifications' | 'profile' | 'settings' | 'security' | 'help';
};

function goShell(nav: Nav, route: ShellRoute): void {
  (nav.go as (r: Route | ShellRoute) => void)(route);
}

interface Row {
  title: string;
  subtitle: string;
  icon: IconName;
  onPress: () => void;
  label: string;
}

export default function ProfileScreen({ nav }: { nav: Nav }) {
  const { theme } = useTheme();
  const s = styles(theme);

  const rows: Row[] = [
    {
      title: 'Passengers',
      subtitle: 'Traveller details for IRCTC forms',
      icon: 'users',
      onPress: () => nav.go({ name: 'passengers' }),
      label: 'Open Passengers',
    },
    {
      title: 'Saved trips',
      subtitle: 'Upcoming and past trip records',
      icon: 'ticket',
      onPress: () => goShell(nav, { name: 'activity' }),
      label: 'Open saved trips',
    },
    {
      title: 'IRCTC account',
      subtitle: 'Login saved encrypted on this phone',
      icon: 'lock',
      onPress: () => nav.go({ name: 'irctcAccount' }),
      label: 'Open IRCTC account',
    },
    {
      title: 'PNRs',
      subtitle: 'Tracked PNRs and chart reminders',
      icon: 'search',
      onPress: () => nav.go({ name: 'pnr' }),
      label: 'Open PNRs',
    },
    {
      title: 'Privacy & Security',
      subtitle: 'How your data is protected',
      icon: 'shield',
      onPress: () => goShell(nav, { name: 'security' }),
      label: 'Open Privacy and Security',
    },
    {
      title: 'Settings',
      subtitle: 'Appearance and preferences',
      icon: 'settings',
      onPress: () => goShell(nav, { name: 'settings' }),
      label: 'Open Settings',
    },
    {
      title: 'Help',
      subtitle: 'How assisted booking works',
      icon: 'helpCircle',
      onPress: () => goShell(nav, { name: 'help' }),
      label: 'Open Help',
    },
  ];

  return (
    <Screen>
      <AppHeader
        title="You"
        subtitle="No account, no cloud — all on this phone"
        actions={[{ icon: 'settings', label: 'Settings', onPress: () => nav.go({ name: 'settings' }) }]}
      />

      <Card padding="sm">
        {rows.map((r, i) => (
          <View key={r.title}>
            {i > 0 && <Divider />}
            <ListRow
              title={r.title}
              subtitle={r.subtitle}
              icon={r.icon}
              onPress={r.onPress}
              accessibilityLabel={r.label}
            />
          </View>
        ))}
      </Card>

      <View style={s.aboutGap}>
        <SectionHeader title="About" />
      </View>
      <Card>
        <Text style={s.version}>Tatkal Copilot · version 0.1.0</Text>
        <Text style={s.aboutLine}>
          No analytics. No cloud. Your data stays encrypted on this device.
        </Text>
        <View style={s.vaultGap}>
          <SecureVaultCard />
        </View>
      </Card>

    </Screen>
  );
}

const styles = (theme: Theme) => StyleSheet.create({
  aboutGap: { marginTop: theme.spacing.lg },
  version: {
    color: theme.colors.ink,
    fontSize: theme.typography.body.size,
    fontWeight: '700',
  },
  aboutLine: {
    color: theme.colors.muted,
    fontSize: theme.typography.bodySm.size,
    lineHeight: theme.typography.bodySm.lineHeight,
    marginTop: theme.spacing.sm,
  },
  vaultGap: { marginTop: theme.spacing.md },
});
