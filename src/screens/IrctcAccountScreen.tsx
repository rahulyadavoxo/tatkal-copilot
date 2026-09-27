/**
 * IrctcAccountScreen — optional, on-device IRCTC login storage.
 *
 * The user types their IRCTC user name + password into THIS screen (their own
 * phone, their own app). The pair is encrypted with the AES-256-GCM vault and
 * never leaves the device, is never logged, and is only ever typed into
 * IRCTC's official login page by the booking automation. The assistant never
 * sees, stores, or handles these credentials.
 *
 * Also holds the site-language preference (English / हिंदी) the automation
 * uses on IRCTC's welcome screen.
 */
import { useState } from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import type { Nav } from '../App';
import {
  clearIrctcCredentials,
  loadIrctcCredentials,
  loadPrefs,
  saveIrctcCredentials,
  savePrefs,
  type AppLanguage,
} from '../vaultStore';
import { useFocusLoad } from './hooks';

export default function IrctcAccountScreen({ nav }: { nav: Nav }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [language, setLanguage] = useState<AppLanguage>('en');
  const [hasSaved, setHasSaved] = useState(false);
  const [message, setMessage] = useState('');

  useFocusLoad(async () => {
    const creds = await loadIrctcCredentials();
    setHasSaved(!!creds);
    // Never show the saved password back — only whether one is stored.
    setUsername(creds ? creds.username : '');
    setPassword('');
    const prefs = await loadPrefs();
    setLanguage(prefs.language);
  });

  const save = async () => {
    setMessage('');
    const u = username.trim();
    if (!u) {
      setMessage('Type your IRCTC user name first.');
      return;
    }
    if (!password) {
      setMessage('Type your IRCTC password first.');
      return;
    }
    try {
      await saveIrctcCredentials({ username: u, password });
      await savePrefs({ language });
      setPassword('');
      setHasSaved(true);
      setMessage('Saved — encrypted on this phone. The app will fill it on IRCTC’s login page only.');
    } catch (e) {
      setMessage('Could not save — storage unavailable. ' + String(e instanceof Error ? e.message : e));
    }
  };

  const remove = async () => {
    try {
      await clearIrctcCredentials();
      setUsername('');
      setPassword('');
      setHasSaved(false);
      setMessage('Saved login removed from this phone.');
    } catch (e) {
      setMessage('Could not remove — storage unavailable. ' + String(e instanceof Error ? e.message : e));
    }
  };

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={styles.inner}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={styles.title}>IRCTC account</Text>
      <Text style={styles.hint}>
        Optional. Save your IRCTC login here and the app can fill it on IRCTC’s
        login page for you. It stays encrypted on this phone — never sent
        anywhere, never shown to anyone. If IRCTC shows a CAPTCHA at login, you
        still solve that by hand.
      </Text>

      <Text style={styles.label}>IRCTC user name</Text>
      <TextInput
        style={styles.input}
        value={username}
        onChangeText={setUsername}
        autoCapitalize="none"
        autoCorrect={false}
        placeholder="Your IRCTC user name"
        placeholderTextColor="#8a8a8a"
      />

      <Text style={styles.label}>IRCTC password</Text>
      <TextInput
        style={styles.input}
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        autoCapitalize="none"
        autoCorrect={false}
        placeholder={hasSaved ? 'Saved — type a new one to replace it' : 'Your IRCTC password'}
        placeholderTextColor="#8a8a8a"
      />

      <Text style={styles.label}>IRCTC site language (auto-selected on the welcome screen)</Text>
      <View style={styles.chips}>
        {(['en', 'hi'] as const).map((l) => (
          <TouchableOpacity
            key={l}
            style={[styles.chip, language === l && styles.chipOn]}
            onPress={() => setLanguage(l)}
          >
            <Text style={[styles.chipText, language === l && styles.chipTextOn]}>
              {l === 'en' ? 'English' : 'हिंदी'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {message !== '' && <Text style={styles.message}>{message}</Text>}

      <TouchableOpacity style={styles.primary} onPress={save}>
        <Text style={styles.primaryText}>💾 Save login + language</Text>
      </TouchableOpacity>
      {hasSaved && (
        <TouchableOpacity style={styles.danger} onPress={remove}>
          <Text style={styles.dangerText}>Remove saved login</Text>
        </TouchableOpacity>
      )}
      <TouchableOpacity style={styles.secondary} onPress={nav.back}>
        <Text style={styles.secondaryText}>← Back</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0b0f14' },
  inner: { padding: 20, gap: 12 },
  title: { color: '#fff', fontSize: 22, fontWeight: '700' },
  hint: { color: '#9aa4b2', fontSize: 13, lineHeight: 19 },
  label: { color: '#c7d0db', fontSize: 14, fontWeight: '600', marginTop: 6 },
  input: {
    backgroundColor: '#141b24',
    color: '#fff',
    borderRadius: 10,
    padding: 12,
    fontSize: 16,
    borderWidth: 1,
    borderColor: '#2a3442',
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#2a3442',
    backgroundColor: '#141b24',
  },
  chipOn: { backgroundColor: '#ffb300', borderColor: '#ffb300' },
  chipText: { color: '#c7d0db', fontWeight: '600' },
  chipTextOn: { color: '#0b0f14' },
  message: { color: '#7CFFB2', fontSize: 13, lineHeight: 18 },
  primary: {
    backgroundColor: '#ffb300',
    borderRadius: 12,
    padding: 14,
    alignItems: 'center',
    marginTop: 8,
  },
  primaryText: { color: '#0b0f14', fontWeight: '700', fontSize: 16 },
  danger: {
    borderRadius: 12,
    padding: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#7a2e2e',
  },
  dangerText: { color: '#ff9d9d', fontWeight: '600' },
  secondary: { padding: 12, alignItems: 'center' },
  secondaryText: { color: '#9aa4b2', fontWeight: '600' },
});
