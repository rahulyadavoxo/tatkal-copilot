/**
 * Setup wizard for booking automation (autofill + tap services).
 *
 * Plain-words explanations for both system permissions, deep-links to the
 * right settings screens, and live verification that each switch is on.
 * Nothing here is technical: the user just follows the steps.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, Text, TouchableOpacity, View } from 'react-native';
import type { Nav } from '../App';
import { useTheme } from '../theme';
import {
  isAutofillServiceEnabled,
  isProbeAvailable,
  isTapServiceEnabled,
  openAccessibilitySettings,
  openAutofillSettings,
} from '../native/tatkalProbe';

export default function SetupAutomationScreen({ nav }: { nav: Nav }) {
  const { theme } = useTheme();
  const [autofillOn, setAutofillOn] = useState(false);
  const [tapOn, setTapOn] = useState(false);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    setBusy(true);
    try {
      const [a, t] = await Promise.all([isAutofillServiceEnabled(), isTapServiceEnabled()]);
      setAutofillOn(a);
      setTapOn(t);
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const s = {
    wrap: { flex: 1, backgroundColor: theme.colors.surface, padding: 16 },
    h1: { fontSize: 22, fontWeight: '700' as const, color: theme.colors.ink, marginBottom: 8 },
    p: { fontSize: 14, color: theme.colors.muted, marginBottom: 12, lineHeight: 20 },
    card: {
      backgroundColor: theme.colors.surface2,
      borderRadius: 12,
      padding: 14,
      marginVertical: 8,
      borderWidth: 1,
      borderColor: theme.colors.line,
    },
    title: { fontSize: 16, fontWeight: '700' as const, color: theme.colors.ink, marginBottom: 6 },
    body: { fontSize: 14, color: theme.colors.muted, lineHeight: 20, marginBottom: 10 },
    btn: {
      backgroundColor: theme.colors.primary,
      borderRadius: 10,
      paddingVertical: 12,
      alignItems: 'center' as const,
      marginTop: 4,
    },
    btnText: { color: '#fff', fontSize: 15, fontWeight: '700' as const },
    done: {
      borderRadius: 10,
      paddingVertical: 12,
      alignItems: 'center' as const,
      marginTop: 4,
      backgroundColor: theme.colors.surface2,
      borderWidth: 1,
      borderColor: theme.colors.success,
    },
    doneText: { color: theme.colors.success, fontSize: 15, fontWeight: '700' as const },
    ghost: {
      borderWidth: 1,
      borderColor: theme.colors.line,
      borderRadius: 10,
      paddingVertical: 12,
      alignItems: 'center' as const,
      marginTop: 12,
    },
    ghostText: { color: theme.colors.ink, fontSize: 15, fontWeight: '600' as const },
  };

  if (!isProbeAvailable()) {
    return (
      <View style={s.wrap}>
        <Text style={s.h1}>Booking automation</Text>
        <Text style={s.p}>This setup only runs on Android.</Text>
        <TouchableOpacity style={s.ghost} onPress={nav.back}>
          <Text style={s.ghostText}>Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const bothOn = autofillOn && tapOn;

  return (
    <ScrollView style={s.wrap} contentContainerStyle={{ paddingBottom: 40 }}>
      <Text style={s.h1}>Booking automation</Text>
      <Text style={s.p}>
        Two one-time switches let the app fill your booking details and tap the
        booking buttons inside real Chrome — so there's no typing and no
        tapping until the payment page. Payment stays entirely yours: the app
        goes completely silent there.
      </Text>

      <View style={s.card}>
        <Text style={s.title}>Step 1: Fill service</Text>
        <Text style={s.body}>
          Fills stations, dates, and passenger details into IRCTC's forms.
          Android will show a warning — that's normal, every password manager
          shows it. Your IRCTC password is never touched.
        </Text>
        {autofillOn ? (
          <View style={s.done}><Text style={s.doneText}>✓ Turned on</Text></View>
        ) : (
          <TouchableOpacity style={s.btn} onPress={openAutofillSettings}>
            <Text style={s.btnText}>Turn on fill service</Text>
          </TouchableOpacity>
        )}
      </View>

      <View style={s.card}>
        <Text style={s.title}>Step 2: Tap service</Text>
        <Text style={s.body}>
          Taps Search Trains, Book Now, and Continue for you — only on IRCTC's
          booking pages. It never taps anything on payment pages, and you can
          turn it off here any time.
        </Text>
        {tapOn ? (
          <View style={s.done}><Text style={s.doneText}>✓ Turned on</Text></View>
        ) : (
          <TouchableOpacity style={s.btn} onPress={openAccessibilitySettings}>
            <Text style={s.btnText}>Turn on tap service</Text>
          </TouchableOpacity>
        )}
      </View>

      <TouchableOpacity style={s.ghost} onPress={() => void refresh()} disabled={busy}>
        {busy ? <ActivityIndicator color={theme.colors.primary} /> : <Text style={s.ghostText}>Check again</Text>}
      </TouchableOpacity>

      {bothOn && (
        <Text style={[s.p, { marginTop: 16, color: theme.colors.success }]}>
          Both switches are on — booking automation is active. Open a trip and
          tap "Book in Chrome".
        </Text>
      )}

      <TouchableOpacity style={s.ghost} onPress={nav.back}>
        <Text style={s.ghostText}>Back</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}
