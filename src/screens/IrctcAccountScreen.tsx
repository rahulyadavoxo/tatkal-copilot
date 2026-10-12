/**
 * IrctcAccountScreen — optional, on-device IRCTC user name storage.
 *
 * The app NEVER stores an IRCTC password — the user always types it by hand
 * on IRCTC's own login page. Only the user name is kept, encrypted in the
 * AES-256-GCM vault; it never leaves the device.
 *
 * Also holds the site-language preference (English / हिंदी) the automation
 * uses on IRCTC's welcome screen.
 */
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { Nav } from '../App';
import { useTheme } from '../theme';
import {
  clearIrctcCredentials,
  loadIrctcCredentials,
  loadPrefs,
  saveIrctcCredentials,
  savePrefs,
  type AppLanguage,
} from '../vaultStore';
import { useFocusLoad } from './hooks';
import {
  AppHeader,
  Badge,
  ListRow,
  PrimaryButton,
  Screen,
  LabeledInput,
  SecondaryButton,
  SecureVaultCard,
  SegmentedControl,
} from '../components/ui';

export default function IrctcAccountScreen({ nav }: { nav: Nav }) {
  const { theme } = useTheme();
  const t = theme.typography;
  const [username, setUsername] = useState('');
  const [language, setLanguage] = useState<AppLanguage>('en');
  const [hasSaved, setHasSaved] = useState(false);
  const [message, setMessage] = useState('');
  const [tone, setTone] = useState<'info' | 'error'>('info');

  useFocusLoad(async () => {
    const creds = await loadIrctcCredentials();
    setHasSaved(!!creds);
    setUsername(creds ? creds.username : '');
    const prefs = await loadPrefs();
    setLanguage(prefs.language);
  });

  const say = (msg: string, kind: 'info' | 'error') => {
    setMessage(msg);
    setTone(kind);
  };

  const save = async () => {
    const u = username.trim();
    if (!u) {
      say('Type your IRCTC user name first.', 'error');
      return;
    }
    try {
      // Username only — the vault shape keeps the password slot empty;
      // Tatkal Copilot never stores an IRCTC password.
      await saveIrctcCredentials({ username: u, password: '' });
      await savePrefs({ language });
      setHasSaved(true);
      say(
        'Saved — encrypted on this phone. The app will fill it on IRCTC’s login page only.',
        'info',
      );
    } catch (e) {
      say(
        'Could not save — storage unavailable. ' + String(e instanceof Error ? e.message : e),
        'error',
      );
    }
  };

  const remove = async () => {
    try {
      await clearIrctcCredentials();
      setUsername('');
      setHasSaved(false);
      say('Saved login removed from this phone.', 'info');
    } catch (e) {
      say(
        'Could not remove — storage unavailable. ' + String(e instanceof Error ? e.message : e),
        'error',
      );
    }
  };

  return (
    <Screen>
      <AppHeader title="IRCTC account" subtitle="Optional — we fill your user ID for you" onBack={nav.back} />
      <SecureVaultCard />

      {hasSaved ? (
        <View style={{ marginTop: theme.spacing.md }}>
          <Badge variant="success" icon="check" label="Username saved securely" />
        </View>
      ) : null}

      <View style={{ marginTop: theme.spacing.md }}>
        <LabeledInput
          label="IRCTC user name"
          placeholder="Your IRCTC user name"
          value={username}
          onChangeText={setUsername}
          autoCapitalize="none"
          autoCorrect={false}
        />
      </View>

      <View style={{ marginTop: theme.spacing.md }}>
        <ListRow
          icon="lock"
          title="Password"
          subtitle="Never stored by Tatkal Copilot — you type it by hand on IRCTC’s page"
          showChevron={false}
          accessibilityLabel="Password: never stored by Tatkal Copilot"
        />
      </View>

      <Text
        style={{
          fontSize: t.bodySm.size,
          lineHeight: t.bodySm.lineHeight,
          color: theme.colors.muted,
          marginTop: theme.spacing.md,
        }}
      >
        If IRCTC shows a CAPTCHA at login, you still solve that by hand.
      </Text>

      <View style={{ marginTop: theme.spacing.md }}>
        <SegmentedControl<AppLanguage>
          label="IRCTC site language (auto-selected on the welcome screen)"
          options={[
            { value: 'en', label: 'English' },
            { value: 'hi', label: 'हिंदी' },
          ]}
          value={language}
          onChange={setLanguage}
        />
      </View>

      {message !== '' && (
        <Text
          accessibilityRole="alert"
          style={[
            styles.message,
            { color: tone === 'error' ? theme.colors.danger : theme.colors.info },
          ]}
        >
          {message}
        </Text>
      )}

      <View style={{ marginTop: theme.spacing.md }}>
        <PrimaryButton
          title="Save user name"
          accessibilityLabel="Save IRCTC user name"
          onPress={() => void save()}
          icon="check"
        />
      </View>
      {hasSaved && (
        <View style={{ marginTop: theme.spacing.sm }}>
          <SecondaryButton
            title="Remove saved login"
            accessibilityLabel="Remove saved login"
            onPress={() => void remove()}
          />
        </View>
      )}
      <View style={{ marginTop: theme.spacing.sm }}>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  message: { fontSize: 13, lineHeight: 18, marginTop: 12 },
});
