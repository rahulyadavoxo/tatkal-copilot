/**
 * SettingsScreen — Wave 2a (brief §40). Grouped settings, all theme-aware.
 *
 * Every row reflects REAL app state (vault reads only): the saved IRCTC
 * username, the IRCTC site language, the current appearance mode. The Data
 * group explains that uninstall wipes everything — there is deliberately NO
 * delete-vault button (§74: cancelling a session must never delete data, and
 * a destructive wipe is not trivially safe to offer here).
 */
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import type { Nav } from '../App';
import { useTheme } from '../theme';
import {
  AppHeader,
  Card,
  Divider,
  ListRow,
  Screen,
  SecureVaultCard,
  SegmentedControl,
} from '../components/ui';
import {
  checkForAppUpdate,
  formatLastChecked,
  getCurrentUpdateShortId,
  getLastCheckedAt,
  getUpdateStatus,
  subscribeUpdateStatus,
  type UpdateStatus,
} from '../updates';
import {
  loadIrctcCredentials,
  loadPrefs,
  type AppLanguage,
} from '../vaultStore';
import { useFocusLoad } from './hooks';

const UPDATE_BUSY: readonly UpdateStatus[] = ['checking', 'downloading', 'ready', 'restarting'];

function updateSubtitle(status: UpdateStatus, lastChecked: number | null, shortId: string | null): string {
  const base = updateSubtitleBase(status, lastChecked);
  // Verifiable version marker: the running update's short id, so the exact
  // bundle on the phone can be confirmed at a glance.
  return shortId ? `${base} · update ${shortId}` : base;
}

function updateSubtitleBase(status: UpdateStatus, lastChecked: number | null): string {
  switch (status) {
    case 'checking':
      return 'Checking for updates…';
    case 'downloading':
      return 'Downloading update…';
    case 'ready':
      return 'Update downloaded';
    case 'restarting':
      return 'Restarting into the update…';
    case 'upToDate':
      return lastChecked ? `Up to date · checked ${formatLastChecked(lastChecked)}` : 'Up to date';
    case 'error':
      return 'Couldn\u2019t reach the update server — tap to retry';
    case 'unsupported':
      return 'Updates aren\u2019t available in this build';
    case 'idle':
    default:
      return lastChecked
        ? `Last checked ${formatLastChecked(lastChecked)} — tap to check again`
        : 'Tap to check for updates';
  }
}

export default function SettingsScreen({ nav }: { nav: Nav }) {
  const { theme, mode, setMode } = useTheme();
  const t = theme.typography;
  const [username, setUsername] = useState<string | null>(null);
  const [language, setLanguage] = useState<AppLanguage>('en');
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus>(getUpdateStatus());
  const [lastChecked, setLastChecked] = useState<number | null>(getLastCheckedAt());
  // The running update's short id — static for the session, read once.
  const [updateShortId] = useState<string | null>(() => getCurrentUpdateShortId());

  useEffect(
    () =>
      subscribeUpdateStatus((s) => {
        setUpdateStatus(s);
        setLastChecked(getLastCheckedAt());
      }),
    [],
  );

  const updateBusy = UPDATE_BUSY.includes(updateStatus);

  const reload = useCallback(async () => {
    try {
      const [creds, prefs] = await Promise.all([
        loadIrctcCredentials(),
        loadPrefs(),
      ]);
      setUsername(creds?.username?.trim() || null);
      setLanguage(prefs.language);
    } catch {
      // leave defaults; rows still render
    }
  }, []);
  useFocusLoad(reload);

  return (
    <Screen>
      <AppHeader title="Settings" onBack={nav.back} />

      {/* Account */}
      <Text style={[styles.group, { color: theme.colors.muted }]}>Account</Text>
      <Card padding="sm">
        <ListRow
          title="IRCTC account"
          subtitle={username ? `Saved as ${username}` : 'Username not saved'}
          icon="users"
          onPress={() => nav.go({ name: 'irctcAccount' })}
        />
      </Card>

      {/* Privacy & security */}
      <Text style={[styles.group, { color: theme.colors.muted }]}>Privacy & security</Text>
      <Card padding="sm">
        <ListRow
          title="Security & privacy"
          subtitle="How your data is protected"
          icon="shield"
          onPress={() => nav.go({ name: 'security' })}
        />
      </Card>

      {/* Notifications */}
      <Text style={[styles.group, { color: theme.colors.muted }]}>Notifications</Text>
      <Card padding="sm">
        <ListRow
          title="Notifications"
          subtitle="What the app can (and can't) remind you about"
          icon="bell"
          onPress={() => nav.go({ name: 'notifications' })}
        />
      </Card>

      {/* Appearance */}
      <Text style={[styles.group, { color: theme.colors.muted }]}>Appearance</Text>
      <Card>
        <SegmentedControl<'light' | 'dark'>
          label="Theme"
          options={[
            { value: 'light', label: 'Light' },
            { value: 'dark', label: 'Dark' },
          ]}
          value={mode}
          onChange={setMode}
        />
        <Text
          style={{
            fontSize: t.caption.size,
            lineHeight: t.caption.lineHeight,
            color: theme.colors.muted,
            marginTop: theme.spacing.sm,
          }}
        >
          Follows your phone's setting until you pick one here.
        </Text>
      </Card>

      {/* Booking preferences — real vault prefs only */}
      <Text style={[styles.group, { color: theme.colors.muted }]}>Booking preferences</Text>
      <Card padding="sm">
        <ListRow
          title="IRCTC site language"
          subtitle={language === 'hi' ? 'हिंदी (auto-selected on IRCTC)' : 'English (auto-selected on IRCTC)'}
          icon="card"
          onPress={() => nav.go({ name: 'irctcAccount' })}
        />
      </Card>

      {/* App updates — visible update flow, never silent */}
      <Text style={[styles.group, { color: theme.colors.muted }]}>App updates</Text>
      <Card padding="sm">
        <ListRow
          title="App updates"
          subtitle={updateSubtitle(updateStatus, lastChecked, updateShortId)}
          icon="refresh"
          showChevron={false}
          onPress={updateBusy ? undefined : () => void checkForAppUpdate()}
          right={
            updateBusy ? (
              <ActivityIndicator size="small" color={theme.colors.primary} />
            ) : undefined
          }
          accessibilityLabel={`App updates. ${updateSubtitle(updateStatus, lastChecked, updateShortId)}`}
        />
      </Card>

      {/* Help & support */}
      <Text style={[styles.group, { color: theme.colors.muted }]}>Help & support</Text>
      <Card padding="sm">
        <ListRow
          title="Booking automation"
          subtitle="Fill + tap IRCTC in real Chrome, automatic till payment"
          icon="ticket"
          onPress={() => nav.go({ name: 'setupAutomation' })}
        />
        <ListRow
          title="Automation probe"
          subtitle="Phase 0 test: what the phone sees in Chrome"
          icon="search"
          onPress={() => nav.go({ name: 'probe' })}
        />
        <ListRow
          title="Booking guide"
          subtitle="How a Tatkal attempt works, step by step"
          icon="helpCircle"
          onPress={() => nav.go({ name: 'help' })}
        />
      </Card>

      {/* About */}
      <Text style={[styles.group, { color: theme.colors.muted }]}>About</Text>
      <Card>
        <View style={styles.aboutRow}>
          <Text style={{ fontSize: t.h3.size, fontWeight: t.h3.weight, color: theme.colors.ink }}>
            Tatkal Copilot
          </Text>
          <Text style={{ fontSize: t.bodySm.size, color: theme.colors.muted, marginTop: 4 }}>
            Version 0.1.0
          </Text>
        </View>
        <Divider />
        <Text
          style={{
            fontSize: t.bodySm.size,
            lineHeight: t.bodySm.lineHeight,
            color: theme.colors.muted,
          }}
        >
          No analytics, no cloud, no tracking. Everything this app knows about
          you lives encrypted on this phone — and only here.
        </Text>
      </Card>

      {/* Data */}
      <Text style={[styles.group, { color: theme.colors.muted }]}>Your data</Text>
      <SecureVaultCard />
      <Text
        style={[
          styles.dataNote,
          { fontSize: t.bodySm.size, lineHeight: t.bodySm.lineHeight, color: theme.colors.muted },
        ]}
      >
        Uninstalling the app removes all of your data — passengers, trips,
        PNRs and saved logins. There is no cloud copy to delete, because there
        never was one.
      </Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  group: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1,
    textTransform: 'uppercase',
    marginTop: 20,
    marginBottom: 8,
  },
  aboutRow: { marginBottom: 4 },
  dataNote: { marginTop: 12, marginBottom: 8 },
});
