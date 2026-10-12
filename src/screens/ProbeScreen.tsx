/**
 * Phase 0/1 automation probe screen (developer-facing).
 *
 * Walks the user through enabling the two probe services, then shows what
 * the services observe in Chrome: the autofill field structure and the
 * clickable nodes. Also offers one explicit test-tap.
 *
 * This screen is temporary scaffolding for the Phase 0 spike — it is not
 * part of the final booking flow.
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import type { Nav } from '../App';
import { useTheme } from '../theme';
import {
  clearProbeData,
  getBrowserInfo,
  getProbeReport,
  isAutofillServiceEnabled,
  isProbeAvailable,
  isTapServiceEnabled,
  openAccessibilitySettings,
  openAutofillSettings,
  requestTap,
  type ProbeReport,
} from '../native/tatkalProbe';

function summarizeDump(raw: string, kind: 'fields' | 'nodes'): string {
  if (!raw) return 'No data yet.';
  try {
    const d = JSON.parse(raw) as {
      host?: string;
      fieldCount?: number;
      clickableCount?: number;
      fields?: Array<{ hints?: string[]; idEntry?: string; hint?: string; className?: string }>;
      nodes?: Array<{ text?: string; contentDesc?: string; viewId?: string; className?: string }>;
    };
    const lines: string[] = [];
    if (d.host) lines.push(`Host: ${d.host}`);
    if (kind === 'fields') {
      lines.push(`Fields seen: ${d.fieldCount ?? 0}`);
      for (const f of (d.fields ?? []).slice(0, 12)) {
        const hints = (f.hints ?? []).join(',');
        lines.push(`- hints=[${hints}] id=${f.idEntry} hint="${f.hint}" class=${f.className}`);
      }
    } else {
      lines.push(`Clickable nodes seen: ${d.clickableCount ?? 0}`);
      for (const n of (d.nodes ?? []).slice(0, 12)) {
        const label = n.text || n.contentDesc || '(no label)';
        lines.push(`- "${label}" id=${n.viewId} class=${n.className}`);
      }
    }
    return lines.join('\n');
  } catch {
    return 'Could not parse report.';
  }
}

function formatBrowserInfo(raw: string | null): string {
  if (!raw) return 'No data yet.';
  try {
    const d = JSON.parse(raw) as { handlers?: string[]; picked?: string | null };
    const lines = [`Would open: ${d.picked ?? '(none found)'}`];
    for (const h of d.handlers ?? []) lines.push(`- ${h}`);
    return lines.join('\n');
  } catch {
    return 'Could not parse.';
  }
}

export default function ProbeScreen({ nav }: { nav: Nav }) {
  const { theme } = useTheme();
  const [autofillOn, setAutofillOn] = useState(false);
  const [tapOn, setTapOn] = useState(false);
  const [report, setReport] = useState<ProbeReport | null>(null);
  const [tapTarget, setTapTarget] = useState('Search Trains');
  const [busy, setBusy] = useState(false);
  const [browserInfo, setBrowserInfo] = useState<string | null>(null);
  const available = isProbeAvailable();

  const refresh = useCallback(async () => {
    setBusy(true);
    try {
      const [a, t, r, b] = await Promise.all([
        isAutofillServiceEnabled(),
        isTapServiceEnabled(),
        getProbeReport(),
        getBrowserInfo(),
      ]);
      setAutofillOn(a);
      setTapOn(t);
      setReport(r);
      setBrowserInfo(b);
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const styles = {
    wrap: { flex: 1, backgroundColor: theme.colors.surface, padding: 16 },
    h1: { fontSize: 20, fontWeight: '700' as const, color: theme.colors.ink, marginBottom: 8 },
    p: { fontSize: 14, color: theme.colors.muted, marginBottom: 12, lineHeight: 20 },
    row: {
      flexDirection: 'row' as const,
      alignItems: 'center' as const,
      justifyContent: 'space-between' as const,
      paddingVertical: 10,
      borderBottomWidth: 1,
      borderBottomColor: theme.colors.line,
    },
    label: { fontSize: 15, color: theme.colors.ink, fontWeight: '600' as const },
    status: (on: boolean) => ({ fontSize: 14, color: on ? theme.colors.success : theme.colors.danger }),
    btn: {
      backgroundColor: theme.colors.primary,
      borderRadius: 10,
      paddingVertical: 12,
      paddingHorizontal: 16,
      alignItems: 'center' as const,
      marginVertical: 6,
    },
    btnText: { color: '#fff', fontSize: 15, fontWeight: '700' as const },
    ghost: {
      borderWidth: 1,
      borderColor: theme.colors.line,
      borderRadius: 10,
      paddingVertical: 10,
      paddingHorizontal: 14,
      alignItems: 'center' as const,
      marginVertical: 6,
    },
    ghostText: { color: theme.colors.ink, fontSize: 14, fontWeight: '600' as const },
    mono: {
      fontFamily: 'monospace',
      fontSize: 12,
      color: theme.colors.ink,
      backgroundColor: theme.colors.surface,
      borderRadius: 8,
      padding: 10,
      marginVertical: 6,
    },
    input: {
      borderWidth: 1,
      borderColor: theme.colors.line,
      borderRadius: 10,
      padding: 12,
      fontSize: 15,
      color: theme.colors.ink,
      marginVertical: 6,
    },
  };

  if (!available) {
    return (
      <View style={styles.wrap}>
        <Text style={styles.h1}>Automation probe</Text>
        <Text style={styles.p}>
          This probe only runs on Android. Nothing to do here on this device.
        </Text>
        <TouchableOpacity style={styles.ghost} onPress={nav.back}>
          <Text style={styles.ghostText}>Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <ScrollView style={styles.wrap} contentContainerStyle={{ paddingBottom: 40 }}>
      <Text style={styles.h1}>Automation probe (Phase 0)</Text>
      <Text style={styles.p}>
        1. Turn on both services below (Android will show a warning — that's normal).
        2. Open IRCTC in Chrome and tap any field on the search page.
        3. Come back here and tap Refresh — you'll see what the phone observed.
        4. Use "Send test tap" to tap a button in Chrome by its label.
      </Text>

      <View style={styles.row}>
        <Text style={styles.label}>Autofill service</Text>
        <Text style={styles.status(autofillOn)}>{autofillOn ? 'ON' : 'OFF'}</Text>
      </View>
      <TouchableOpacity style={styles.ghost} onPress={openAutofillSettings}>
        <Text style={styles.ghostText}>Open autofill settings</Text>
      </TouchableOpacity>

      <View style={styles.row}>
        <Text style={styles.label}>Tap service</Text>
        <Text style={styles.status(tapOn)}>{tapOn ? 'ON' : 'OFF'}</Text>
      </View>
      <TouchableOpacity style={styles.ghost} onPress={openAccessibilitySettings}>
        <Text style={styles.ghostText}>Open accessibility settings</Text>
      </TouchableOpacity>

      <TouchableOpacity style={styles.btn} onPress={() => void refresh()} disabled={busy}>
        {busy ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.btnText}>Refresh report</Text>
        )}
      </TouchableOpacity>

      <Text style={[styles.label, { marginTop: 12 }]}>Browser detection</Text>
      <Text style={styles.mono}>{formatBrowserInfo(browserInfo)}</Text>

      <Text style={[styles.label, { marginTop: 12 }]}>Autofill: fields seen in Chrome</Text>
      {report?.fillStatus ? (
        <Text style={styles.p}>Status: {report.fillStatus}</Text>
      ) : null}
      <Text style={styles.mono}>
        {summarizeDump(report?.autofillDump ?? '', 'fields')}
      </Text>

      <Text style={[styles.label, { marginTop: 12 }]}>Tap service: clickable nodes seen</Text>
      <Text style={styles.mono}>
        {summarizeDump(report?.tapDump ?? '', 'nodes')}
      </Text>

      {report?.engineStatus ? (
        <Text style={styles.p}>Engine: {report.engineStatus}</Text>
      ) : null}

      {report?.tapResult ? (
        <Text style={styles.p}>Last test tap: {report.tapResult}</Text>
      ) : null}

      <Text style={[styles.label, { marginTop: 12 }]}>Send test tap</Text>
      <TextInput
        style={styles.input}
        value={tapTarget}
        onChangeText={setTapTarget}
        placeholder="Button label, e.g. Search Trains"
        placeholderTextColor={theme.colors.muted}
      />
      <TouchableOpacity
        style={styles.btn}
        onPress={() => void requestTap(tapTarget).then(() => refresh())}
      >
        <Text style={styles.btnText}>Send test tap to Chrome</Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.ghost}
        onPress={() => void clearProbeData().then(() => refresh())}
      >
        <Text style={styles.ghostText}>Clear probe data</Text>
      </TouchableOpacity>

      <TouchableOpacity style={styles.ghost} onPress={nav.back}>
        <Text style={styles.ghostText}>Back</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}
