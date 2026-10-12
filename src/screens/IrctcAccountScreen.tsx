/**
 * IrctcAccountScreen — optional, on-device IRCTC login storage.
 *
 * The user types their IRCTC user name AND password here; both are kept
 * encrypted in the AES-256-GCM vault and never leave the device. They are
 * filled into IRCTC's official login page only, never logged, never sent
 * anywhere else, and the assistant never sees them.
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
  const [password, setPassword] = useState('');
  const [language, setLanguage] = useState<AppLanguage>('en');
  const [hasSaved, setHasSaved] = useState(false);
  const [message, setMessage] = useState('');
  const [tone, setTone] = useState<'info' | 'error'>('info');

  useFocusLoad(async () => {
    const creds = await loadIrctcCredentials();
    setHasSaved(!!creds);
    setUsername(creds ? creds.username : '');
    setPassword('');
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
    if (!password) {
      say('Type your IRCTC password too.', 'error');
      return;
    }
    try {
      await saveIrctcCredentials({ username: u, password });
      await savePrefs({ language });
      setPassword('');
      setHasSaved(true);
      say(
        'Saved — encrypted on this phone. The app will fill both on IRCTC’s login page only.',
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
      setPassword('');
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
      <AppHeader title="IRCTC account" subtitle="Optional — we fill your login for you" onBack={nav.back} />
      <SecureVaultCard />

      {hasSaved ? (
        <View style={{ marginTop: theme.spacing.md }}>
          <Badge variant="success" icon="check" label="Login saved securely" />
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
        <LabeledInput
          label="IRCTC password"
          placeholder="Your IRCTC password"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          autoCapitalize="none"
          autoCorrect={false}
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
        Saved encrypted on this phone only. The app fills both on IRCTC’s login
        page and nowhere else. If IRCTC shows a CAPTCHA, you still solve that by hand.
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
          title="Save login"
          accessibilityLabel="Save IRCTC login"
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
