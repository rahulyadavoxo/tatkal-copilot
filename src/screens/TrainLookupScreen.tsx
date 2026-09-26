/**
 * TrainLookup — user-driven train search on IRCTC's own site.
 *
 * There is no reliable offline train-number directory (numbers change with
 * new trains), so instead of shipping a stale fake list, this screen opens
 * IRCTC's real train search in the app's WebView. The user searches
 * themselves, notes the 5-digit train number, goes back, and types it in.
 *
 * Same safety as BookingScreen: HTTPS + irctc.co.in allowlist enforced,
 * stock mobile-Chrome UA. No fill script, no automation — pure browsing.
 */
import React, { useCallback, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import WebView from '../webview';
import type {
  ShouldStartLoadRequest,
  WebViewErrorEvent,
} from 'react-native-webview/lib/WebViewTypes';
import { C } from '../theme';
import { isAllowedUrl } from '../core/privacy';
import type { Nav } from '../App';

const IRCTC_SEARCH_URL = 'https://www.irctc.co.in/nget/';

const STOCK_CHROME_MOBILE_UA =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36';

export default function TrainLookupScreen({ nav }: { nav: Nav }) {
  const [blockedUrl, setBlockedUrl] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const onShouldStartLoadWithRequest = useCallback((req: ShouldStartLoadRequest) => {
    const ok = isAllowedUrl(req.url);
    if (!ok) setBlockedUrl(req.url);
    return ok;
  }, []);

  const onError = useCallback((e: WebViewErrorEvent) => {
    setLoadError(e.nativeEvent.description || 'Page failed to load.');
  }, []);

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <Text style={styles.title}>Find your train</Text>
        <Text style={styles.sub}>
          Search trains on IRCTC below, note the 5-digit train number, then go
          back and enter it. (The official RailOne app works too — same IRCTC
          backend, same Tatkal quota.)
        </Text>
      </View>

      {blockedUrl && (
        <Text style={styles.warn}>Blocked non-IRCTC navigation: {blockedUrl}</Text>
      )}
      {loadError && <Text style={styles.warn}>{loadError}</Text>}

      <WebView
        style={styles.web}
        source={{ uri: IRCTC_SEARCH_URL }}
        userAgent={STOCK_CHROME_MOBILE_UA}
        onShouldStartLoadWithRequest={onShouldStartLoadWithRequest}
        onError={onError}
        javaScriptEnabled
        domStorageEnabled
      />

      <TouchableOpacity style={styles.back} onPress={nav.back}>
        <Text style={styles.backText}>← Back to trip setup</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  header: { padding: 16, paddingBottom: 8 },
  title: { color: C.lime, fontSize: 20, fontWeight: '800' },
  sub: { color: C.muted, fontSize: 12, marginTop: 4, lineHeight: 17 },
  warn: { color: C.danger, fontSize: 12, paddingHorizontal: 16, marginBottom: 4 },
  web: { flex: 1 },
  back: {
    borderTopColor: C.line,
    borderTopWidth: 1,
    alignItems: 'center',
    padding: 14,
  },
  backText: { color: C.ink, fontSize: 15, fontWeight: '700' },
});
