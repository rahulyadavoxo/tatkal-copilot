/**
 * Find a Train (§36–37) + the legacy IrctcBrowserScreen.
 *
 * - `TrainLookupScreen` (named export, the §36–37 screen): the user enters
 *   From / To / Date / Class (or a train number) with the existing field
 *   components, then taps through to IRCTC's own site in the G9-allowlisted
 *   WebView. Train numbers, timings and availability are NEVER invented:
 *   the offline popular-trains directory only supplies train numbers/names,
 *   and everything live loads from IRCTC's own page.
 * - `IrctcBrowserScreen` (default export, UNCHANGED contract) keeps the
 *   pre-existing generic browser used by the 'irctcLogin' route; it is
 *   restyled but behaviour-identical. Wire the 'trainLookup' route to the
 *   named `TrainLookupScreen` export; 'irctcLogin' keeps the default.
 *
 * FIELD REPORT 2026-09-26: IRCTC's Akamai bot protection 403s the embedded
 * WebView even with the stock UA. No evasion attempted — on denial the
 * screen offers a genuine Chrome tab (expo-web-browser) instead.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  BackHandler,
  Linking,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import WebView, { type WebViewInstance } from '../webview';
import type {
  ShouldStartLoadRequest,
  WebViewErrorEvent,
  WebViewHttpErrorEvent,
} from 'react-native-webview/lib/WebViewTypes';
import { useTheme } from '../theme';
import type { Theme } from '../theme';
import { isAllowedUrl } from '../core/privacy';
import { IRCTC_CLASSES } from '../core/tatkalConfig';
import { TRAINS } from '../data/trains';
import type { Nav } from '../App';
import StationField from './StationField';
import TrainField from './TrainField';
import DatePickerField, { formatLong } from './DatePickerField';
import {
  AppHeader,
  Card,
  ErrorState,
  GhostButton,
  IconButton,
  PrimaryButton,
  Screen,
  SecondaryButton,
  SectionHeader,
  SegmentedControl,
  Skeleton,
} from '../components/ui';
import { Icon, ICON_SIZE } from '../components/icons';

export const IRCTC_HOME_URL = 'https://www.irctc.co.in/nget/';

const STOCK_CHROME_MOBILE_UA =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36';

/* ------------------------------------------------------------------ */
/* Shared IRCTC WebView chrome (allowlist, UA, denial + error states)  */
/* ------------------------------------------------------------------ */

function IrctcWebView({ url }: { url: string }) {
  const { theme } = useTheme();
  const s = styles(theme);
  const [blockedUrl, setBlockedUrl] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [accessDenied, setAccessDenied] = useState(false);
  const [canGoBack, setCanGoBack] = useState(false);
  const webRef = useRef<WebViewInstance | null>(null);

  const onShouldStartLoadWithRequest = useCallback((req: ShouldStartLoadRequest) => {
    const ok = isAllowedUrl(req.url);
    if (!ok) setBlockedUrl(req.url);
    return ok;
  }, []);

  const onError = useCallback((e: WebViewErrorEvent) => {
    setLoadError(e.nativeEvent.description || 'Page failed to load.');
  }, []);

  const onHttpError = useCallback((e: WebViewHttpErrorEvent) => {
    if (e.nativeEvent.statusCode === 403) setAccessDenied(true);
  }, []);

  const onNavigationStateChange = useCallback((navState: { canGoBack: boolean; title?: string }) => {
    setCanGoBack(navState.canGoBack);
    if (navState.title && /access denied/i.test(navState.title)) {
      setAccessDenied(true);
    } else if (navState.title) {
      setAccessDenied(false);
    }
  }, []);

  const openInChrome = useCallback(() => {
    void WebBrowser.openBrowserAsync(url).catch(() => Linking.openURL(url));
  }, [url]);

  const retry = useCallback(() => {
    setLoadError(null);
    setAccessDenied(false);
    webRef.current?.reload();
  }, []);

  // Hardware back: step back inside the page first, else let the app pop.
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (canGoBack) {
        webRef.current?.goBack();
        return true;
      }
      return false;
    });
    return () => sub.remove();
  }, [canGoBack]);

  return (
    <View style={s.webWrap}>
      {blockedUrl && (
        <Text style={s.warn}>Blocked non-IRCTC navigation: {blockedUrl}</Text>
      )}
      {loadError && (
        <View style={s.statePad}>
          <ErrorState
            title="Live availability isn't available right now."
            message={loadError}
            onRetry={retry}
            retryLabel="Reload page"
          />
          <SecondaryButton
            title="Continue in Chrome"
            icon="externalLink"
            onPress={openInChrome}
            accessibilityLabel="Continue in Chrome browser"
            fullWidth
          />
        </View>
      )}
      {!loadError && accessDenied && (
        <View style={s.statePad}>
          <Card>
            <Text style={s.deniedTitle}>IRCTC blocked the in-app browser</Text>
            <Text style={s.deniedSub}>
              IRCTC's protection treats the in-app browser as a bot. Continue
              in a real Chrome tab instead — it shares your Chrome login.
            </Text>
            <PrimaryButton
              title="Continue in Chrome"
              icon="externalLink"
              onPress={openInChrome}
              accessibilityLabel="Continue in Chrome browser"
              fullWidth
            />
          </Card>
        </View>
      )}
      {!loadError && !accessDenied && (
        <WebView
          ref={webRef}
          style={s.web}
          source={{ uri: url }}
          userAgent={STOCK_CHROME_MOBILE_UA}
          onShouldStartLoadWithRequest={onShouldStartLoadWithRequest}
          onNavigationStateChange={onNavigationStateChange}
          onHttpError={onHttpError}
          onError={onError}
          javaScriptEnabled
          domStorageEnabled
          startInLoadingState
          renderLoading={() => (
            <View style={s.loadingPad} accessibilityLabel="Loading IRCTC">
              <Skeleton height={22} width="55%" />
              <Skeleton height={110} style={s.loadingGap} />
              <Skeleton height={110} style={s.loadingGap} />
              <Skeleton height={110} style={s.loadingGap} />
            </View>
          )}
        />
      )}
    </View>
  );
}

/* ------------------------------------------------------------------ */
/* Legacy generic browser — UNCHANGED props contract (irctcLogin route) */
/* ------------------------------------------------------------------ */

interface BrowserProps {
  nav: Nav;
  title: string;
  hint: string;
  url?: string;
  backLabel?: string;
}

export default function IrctcBrowserScreen({
  nav,
  title,
  hint,
  url = IRCTC_HOME_URL,
  backLabel = 'Back',
}: BrowserProps) {
  const { theme } = useTheme();
  const s = styles(theme);
  return (
    <View style={s.root}>
      <View style={s.headerPad}>
        <SectionHeader title={title} subtitle={hint} />
      </View>
      <IrctcWebView url={url} />
      <View style={s.backBar}>
        <GhostButton title={backLabel} icon="arrowLeft" onPress={nav.back} accessibilityLabel={backLabel} />
      </View>
    </View>
  );
}

/* ------------------------------------------------------------------ */
/* Find a Train (§36–37)                                               */
/* ------------------------------------------------------------------ */

type SearchMode = 'route' | 'train';

interface RouteQuery {
  kind: 'route';
  from: string;
  to: string;
  date: string;
  classCode: string;
}

interface TrainQuery {
  kind: 'train';
  trainNo: string;
  trainName: string | null;
}

type Query = RouteQuery | TrainQuery;

function querySummary(q: Query): string {
  if (q.kind === 'route') {
    return `${q.from} → ${q.to} · ${formatLong(q.date)} · ${q.classCode}`;
  }
  return q.trainName ? `Train ${q.trainNo} — ${q.trainName}` : `Train ${q.trainNo}`;
}

export function TrainLookupScreen({ nav }: { nav: Nav }) {
  const { theme } = useTheme();
  const s = styles(theme);
  const [mode, setMode] = useState<SearchMode>('route');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [date, setDate] = useState('');
  const [classCode, setClassCode] = useState<string>('All Classes');
  const [trainNo, setTrainNo] = useState('');
  const [query, setQuery] = useState<Query | null>(null);

  const trainName = trainNo ? TRAINS.find((t) => t.no === trainNo)?.name ?? null : null;

  const canSearch =
    mode === 'route'
      ? from !== '' && to !== '' && date !== ''
      : trainNo !== '';

  const doSearch = () => {
    if (!canSearch) return;
    if (mode === 'route') {
      setQuery({ kind: 'route', from, to, date, classCode });
    } else {
      setQuery({ kind: 'train', trainNo, trainName });
    }
  };

  // --- Results mode: IRCTC's own results page in the WebView ---------------
  if (query) {
    return (
      <View style={s.root}>
        <View style={s.headerPad}>
          <Card variant="outlined">
            <View style={s.summaryRow}>
              <View style={s.summaryTextWrap}>
                <Text style={s.summaryLabel}>Showing live results for</Text>
                <Text style={s.summaryText}>{querySummary(query)}</Text>
                <Text style={s.summaryNote}>
                  Complete the search on IRCTC's page below — the app never
                  guesses train times or availability.
                </Text>
              </View>
              <IconButton
                icon="edit"
                variant="outlined"
                onPress={() => setQuery(null)}
                label="Change search"
                size={20}
              />
            </View>
          </Card>
        </View>
        <IrctcWebView url={IRCTC_HOME_URL} />
        <View style={s.backBar}>
        </View>
      </View>
    );
  }

  // --- Search form ---------------------------------------------------------
  return (
    <Screen>
      <AppHeader title="Find a train" subtitle="Live from IRCTC's official site" onBack={nav.back} />

      <SegmentedControl<SearchMode>
        label="Search by"
        value={mode}
        onChange={setMode}
        options={[
          { value: 'route', label: 'Route' },
          { value: 'train', label: 'Train number' },
        ]}
      />

      {mode === 'route' ? (
        <View>
          <StationField label="From" value={from} onSelect={setFrom} />
          <StationField label="To" value={to} onSelect={setTo} />
          <DatePickerField label="Journey date" value={date} onSelect={setDate} />
          <Text style={s.fieldLabel}>Class</Text>
          <View style={s.chips} accessibilityRole="radiogroup" accessibilityLabel="Travel class">
            {IRCTC_CLASSES.map((c) => {
              const selected = c === classCode;
              return (
                <Pressable
                  key={c}
                  onPress={() => setClassCode(c)}
                  accessibilityRole="radio"
                  accessibilityState={{ selected }}
                  accessibilityLabel={`Class ${c}`}
                  style={[s.chip, selected && s.chipSel]}
                >
                  <Text style={[s.chipText, selected && s.chipTextSel]}>{c}</Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      ) : (
        <View>
          <TrainField label="Train" value={trainNo} onSelect={setTrainNo} />
          {trainNo !== '' && (
            <Card variant="outlined" style={s.trainCard}>
              <Text style={s.trainNo}>{trainNo}</Text>
              <Text style={s.trainNameText}>
                {trainName ?? 'Not in the offline popular-trains list — verify this number on IRCTC.'}
              </Text>
              <View style={s.hintRow}>
                <Icon name="info" size={ICON_SIZE.xs} color={theme.colors.muted} accessibilityLabel="Note" />
                <Text style={s.hintText}>
                  Timings and live availability are only on IRCTC's site — this
                  list only knows train numbers and names.
                </Text>
              </View>
            </Card>
          )}
        </View>
      )}

      <PrimaryButton
        title="Search trains on IRCTC"
        icon="search"
        onPress={doSearch}
        disabled={!canSearch}
        accessibilityLabel="Search trains on IRCTC's official site"
        fullWidth
        style={s.searchBtn}
      />
      <Text style={s.underNote}>
        Live results open on IRCTC's own page inside the app. If IRCTC blocks
        the in-app browser, you'll get a one-tap way to continue in Chrome.
      </Text>

    </Screen>
  );
}

const styles = (theme: Theme) => StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.colors.bg },
  headerPad: { padding: theme.spacing.md, paddingBottom: theme.spacing.sm },
  backBar: {
    borderTopColor: theme.colors.line,
    borderTopWidth: 1,
    paddingVertical: theme.spacing.sm,
    alignItems: 'center',
  },
  webWrap: { flex: 1 },
  web: { flex: 1 },
  warn: {
    color: theme.colors.danger,
    fontSize: theme.typography.caption.size,
    paddingHorizontal: theme.spacing.md,
    marginBottom: theme.spacing.sm,
  },
  statePad: { padding: theme.spacing.md, gap: theme.spacing.md },
  deniedTitle: {
    color: theme.colors.danger,
    fontSize: theme.typography.body.size,
    fontWeight: '800',
    marginBottom: theme.spacing.sm,
  },
  deniedSub: {
    color: theme.colors.muted,
    fontSize: theme.typography.bodySm.size,
    lineHeight: theme.typography.bodySm.lineHeight,
    marginBottom: theme.spacing.md,
  },
  loadingPad: { flex: 1, padding: theme.spacing.md, backgroundColor: theme.colors.bg },
  loadingGap: { marginTop: theme.spacing.md },
  fieldLabel: {
    color: theme.colors.muted,
    fontSize: 13,
    marginTop: 10,
    marginBottom: 6,
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm },
  chip: {
    borderColor: theme.colors.line,
    borderWidth: 1,
    borderRadius: theme.radius.full,
    paddingVertical: theme.spacing.sm,
    paddingHorizontal: theme.spacing.md,
    minHeight: 44,
    justifyContent: 'center',
    backgroundColor: theme.colors.surface,
  },
  chipSel: { backgroundColor: theme.colors.primary, borderColor: theme.colors.primary },
  chipText: { color: theme.colors.ink, fontSize: theme.typography.bodySm.size, fontWeight: '600' },
  chipTextSel: { color: theme.colors.onPrimary },
  trainCard: { marginTop: theme.spacing.md },
  trainNo: {
    color: theme.colors.ink,
    fontSize: theme.typography.h2.size,
    fontWeight: theme.typography.mono.weight,
    fontFamily: theme.typography.mono.fontFamily,
    letterSpacing: 2,
  },
  trainNameText: {
    color: theme.colors.muted,
    fontSize: theme.typography.bodySm.size,
    marginTop: 4,
    lineHeight: theme.typography.bodySm.lineHeight,
  },
  hintRow: { flexDirection: 'row', gap: theme.spacing.sm, marginTop: theme.spacing.sm },
  hintText: {
    flex: 1,
    color: theme.colors.muted,
    fontSize: theme.typography.bodySm.size,
    lineHeight: theme.typography.bodySm.lineHeight,
  },
  searchBtn: { marginTop: theme.spacing.lg },
  underNote: {
    color: theme.colors.muted,
    fontSize: theme.typography.bodySm.size,
    lineHeight: theme.typography.bodySm.lineHeight,
    marginTop: theme.spacing.sm,
    marginBottom: theme.spacing.md,
  },
  summaryRow: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm },
  summaryTextWrap: { flex: 1 },
  summaryLabel: {
    color: theme.colors.muted,
    fontSize: theme.typography.caption.size,
    fontWeight: '700',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  summaryText: {
    color: theme.colors.ink,
    fontSize: theme.typography.body.size,
    fontWeight: '700',
    marginTop: 2,
  },
  summaryNote: {
    color: theme.colors.muted,
    fontSize: theme.typography.bodySm.size,
    marginTop: 4,
    lineHeight: theme.typography.bodySm.lineHeight,
  },
});
