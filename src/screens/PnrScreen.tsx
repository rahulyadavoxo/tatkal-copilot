/**
 * PNR Status — tracked PNRs + chart reminders + IRCTC enquiry WebView.
 *
 * - PNRs persist encrypted via vaultStore (loadPnrs/savePnrs, AES-256-GCM).
 * - "Check status" opens IRCTC's PNR enquiry page in the G9-allowlisted
 *   WebView (irctc.co.in only, stock mobile-Chrome UA — same wrapper pattern
 *   as BookingScreen). The user enters/submits the PNR themselves on the
 *   page; nothing is auto-submitted.
 *
 * DEVICE-TEST ITEM: IRCTC_PNR_URL is the documented enquiry route — confirm
 * it still resolves on the live site before release.
 */
import React, { useCallback, useState } from 'react';
import {
  FlatList,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import WebView from '../webview';
// Type-only deep import: erased at compile time (same trick as BookingScreen).
import type { ShouldStartLoadRequest } from 'react-native-webview/lib/WebViewTypes';
import { C } from '../theme';
import { isAllowedUrl } from '../core/privacy';
import {
  chartReminderTimes,
  formatPnrStatusReminder,
  isValidPnr,
} from '../core/pnr';
import {
  loadPnrs,
  newId,
  savePnrs,
  type TrackedPnr,
} from '../vaultStore';
import type { Nav } from '../App';
import { useFocusLoad } from './hooks';

// IRCTC's PNR enquiry route (nget SPA). Grounded 2026-09-26 via web search;
// IRCTC may move SPA routes — verify on device before release.
const IRCTC_PNR_URL = 'https://www.irctc.co.in/nget/pnr-enquiry';

// Stock mobile-Chrome UA — same fingerprint reasoning as BookingScreen.
const STOCK_CHROME_MOBILE_UA =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36';

interface Draft {
  pnr: string;
  departure: string; // "YYYY-MM-DD HH:mm" device-local, optional
  label: string;
}

const blankDraft = (): Draft => ({ pnr: '', departure: '', label: '' });

/** Strict "YYYY-MM-DD HH:mm" (device-local) → ISO string. Throws on garbage. */
function parseDepartureLocal(input: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/.exec(input.trim());
  if (!m) throw new Error('use YYYY-MM-DD HH:mm');
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const hh = Number(m[4]);
  const mm = Number(m[5]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || hh > 23 || mm > 59) {
    throw new Error('not a real date/time');
  }
  const dt = new Date(y, mo - 1, d, hh, mm, 0);
  if (
    dt.getFullYear() !== y ||
    dt.getMonth() !== mo - 1 ||
    dt.getDate() !== d ||
    dt.getHours() !== hh ||
    dt.getMinutes() !== mm
  ) {
    throw new Error('not a real date/time');
  }
  return dt.toISOString();
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleString();
}

export default function PnrScreen({ nav }: { nav: Nav }) {
  const [list, setList] = useState<TrackedPnr[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [viewing, setViewing] = useState<TrackedPnr | null>(null);
  const [blockedUrl, setBlockedUrl] = useState<string | null>(null);

  const reload = useCallback(async () => setList(await loadPnrs()), []);
  useFocusLoad(reload);

  const persist = async (next: TrackedPnr[]) => {
    setList(next);
    await savePnrs(next);
  };

  const saveDraft = async () => {
    if (!draft) return;
    const pnr = draft.pnr.replace(/[\s-]/g, '');
    if (!isValidPnr(pnr)) {
      setError('PNR must be exactly 10 digits.');
      return;
    }
    let departureISO: string | undefined;
    if (draft.departure.trim()) {
      try {
        departureISO = parseDepartureLocal(draft.departure);
      } catch (e) {
        setError(e instanceof Error ? `Departure: ${e.message}.` : 'Bad departure.');
        return;
      }
    }
    if (list.some((t) => t.pnr === pnr)) {
      setError('This PNR is already tracked.');
      return;
    }
    const clean: TrackedPnr = {
      id: newId('pnr'),
      pnr,
      departureISO,
      label: draft.label.trim() || undefined,
      createdAt: Date.now(),
    };
    setError(null);
    setDraft(null);
    await persist([clean, ...list]);
  };

  const remove = async (id: string) => {
    if (viewing?.id === id) setViewing(null);
    await persist(list.filter((t) => t.id !== id));
  };

  const onShouldStartLoadWithRequest = useCallback((req: ShouldStartLoadRequest) => {
    const ok = isAllowedUrl(req.url);
    if (!ok) setBlockedUrl(req.url);
    return ok; // G9: only irctc.co.in loads
  }, []);

  // --- WebView "check status" mode -----------------------------------------
  if (viewing) {
    return (
      <View style={styles.root}>
        <View style={styles.banner}>
          <Text style={styles.bannerText}>
            Enter this PNR on the page: <Text style={styles.bannerPnr}>{viewing.pnr}</Text>
          </Text>
          <TouchableOpacity onPress={() => setViewing(null)}>
            <Text style={styles.link}>← All PNRs</Text>
          </TouchableOpacity>
        </View>
        {blockedUrl && (
          <Text style={styles.blocked}>Blocked non-IRCTC navigation: {blockedUrl}</Text>
        )}
        <WebView
          source={{ uri: IRCTC_PNR_URL }}
          userAgent={STOCK_CHROME_MOBILE_UA}
          javaScriptEnabled
          domStorageEnabled
          onShouldStartLoadWithRequest={onShouldStartLoadWithRequest}
          style={styles.webview}
        />
      </View>
    );
  }

  // --- List mode -------------------------------------------------------------
  return (
    <View style={styles.root}>
      <Text style={styles.title}>PNR Status</Text>
      <Text style={styles.sub}>Saved PNRs stay encrypted on this phone.</Text>

      <FlatList
        data={list}
        keyExtractor={(t) => t.id}
        ListEmptyComponent={
          <Text style={styles.empty}>No PNRs tracked yet — add one below.</Text>
        }
        renderItem={({ item }) => (
          <PnrCard item={item} onView={() => setViewing(item)} onDelete={() => remove(item.id)} />
        )}
      />

      {draft ? (
        <View style={styles.form}>
          <Text style={styles.formTitle}>Track a PNR</Text>
          <TextInput
            style={styles.input}
            placeholder="10-digit PNR"
            placeholderTextColor={C.muted}
            keyboardType="numeric"
            maxLength={10}
            value={draft.pnr}
            onChangeText={(t) => setDraft({ ...draft, pnr: t })}
          />
          <TextInput
            style={styles.input}
            placeholder="Departure (optional): YYYY-MM-DD HH:mm"
            placeholderTextColor={C.muted}
            value={draft.departure}
            onChangeText={(t) => setDraft({ ...draft, departure: t })}
          />
          <TextInput
            style={styles.input}
            placeholder="Label (optional): NDLS → LKO"
            placeholderTextColor={C.muted}
            value={draft.label}
            onChangeText={(t) => setDraft({ ...draft, label: t })}
          />
          {error && <Text style={styles.error}>{error}</Text>}
          <View style={styles.formRow}>
            <TouchableOpacity style={styles.primary} onPress={saveDraft}>
              <Text style={styles.primaryText}>Save</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.secondary}
              onPress={() => { setDraft(null); setError(null); }}
            >
              <Text style={styles.secondaryText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : (
        <TouchableOpacity style={styles.primary} onPress={() => setDraft(blankDraft())}>
          <Text style={styles.primaryText}>+ Track PNR</Text>
        </TouchableOpacity>
      )}

      <TouchableOpacity style={styles.back} onPress={nav.back}>
        <Text style={styles.secondaryText}>← Back</Text>
      </TouchableOpacity>
    </View>
  );
}

function PnrCard({
  item,
  onView,
  onDelete,
}: {
  item: TrackedPnr;
  onView: () => void;
  onDelete: () => void;
}) {
  let chartLine: string | null = null;
  if (item.departureISO) {
    try {
      const { firstChart, secondChart } = chartReminderTimes(item.departureISO);
      const msLeft = new Date(item.departureISO).getTime() - Date.now();
      chartLine =
        `${formatPnrStatusReminder(msLeft)}\n` +
        `~1st chart ${fmtDate(firstChart.toISOString())} · ` +
        `~2nd chart ${fmtDate(secondChart.toISOString())}`;
    } catch {
      chartLine = null; // corrupted stored date: show PNR without reminders
    }
  }
  return (
    <View style={styles.card}>
      <View style={styles.cardRow}>
        <Text style={styles.cardTitle}>
          {item.pnr}
          {item.label ? ` · ${item.label}` : ''}
        </Text>
      </View>
      {chartLine && <Text style={styles.cardSub}>{chartLine}</Text>}
      <View style={styles.cardActions}>
        <TouchableOpacity onPress={onView}>
          <Text style={styles.link}>Check status</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={onDelete}>
          <Text style={[styles.link, styles.dangerLink]}>Delete</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, padding: 16, backgroundColor: C.bg },
  title: { color: C.lime, fontSize: 22, fontWeight: '800' },
  sub: { color: C.muted, fontSize: 12, marginTop: 2, marginBottom: 12 },
  empty: { color: C.muted, textAlign: 'center', marginTop: 30 },
  card: {
    backgroundColor: C.card, borderColor: C.line, borderWidth: 1,
    borderRadius: 10, padding: 12, marginBottom: 8,
  },
  cardRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  cardTitle: { color: C.ink, fontSize: 16, fontWeight: '700', letterSpacing: 1 },
  cardSub: { color: C.muted, fontSize: 12, marginTop: 6, lineHeight: 17 },
  cardActions: { flexDirection: 'row', gap: 16, marginTop: 8 },
  link: { color: C.lime, fontSize: 13, fontWeight: '700' },
  dangerLink: { color: C.danger },
  form: {
    backgroundColor: C.card, borderColor: C.line, borderWidth: 1,
    borderRadius: 10, padding: 12, marginTop: 8,
  },
  formTitle: { color: C.ink, fontSize: 15, fontWeight: '700', marginBottom: 8 },
  input: {
    backgroundColor: C.bg, color: C.ink, borderColor: C.line, borderWidth: 1,
    borderRadius: 8, padding: 10, marginBottom: 8, fontSize: 15,
  },
  error: { color: C.danger, fontSize: 13, marginBottom: 8 },
  formRow: { flexDirection: 'row', gap: 8, marginTop: 4 },
  primary: {
    backgroundColor: C.lime, borderRadius: 10, padding: 13,
    alignItems: 'center', marginTop: 8, flex: 1,
  },
  primaryText: { color: C.bg, fontSize: 15, fontWeight: '800' },
  secondary: {
    borderColor: C.line, borderWidth: 1, borderRadius: 10,
    padding: 13, alignItems: 'center', marginTop: 8, flex: 1,
  },
  secondaryText: { color: C.ink, fontSize: 14, fontWeight: '600' },
  back: { alignItems: 'center', padding: 12 },
  banner: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    backgroundColor: C.card, borderColor: C.line, borderWidth: 1,
    borderRadius: 10, padding: 10, marginBottom: 8,
  },
  bannerText: { color: C.ink, fontSize: 13, flex: 1 },
  bannerPnr: { fontWeight: '800', letterSpacing: 1, color: C.lime },
  blocked: { color: C.danger, fontSize: 12, marginBottom: 8 },
  webview: { flex: 1, borderRadius: 10, overflow: 'hidden' },
});
