/**
 * PNR Status — tracked PNRs + chart reminders + IRCTC enquiry WebView.
 *
 * - PNRs persist encrypted via vaultStore (loadPnrs/savePnrs, AES-256-GCM).
 * - "Check status" opens IRCTC's PNR enquiry page in the G9-allowlisted
 *   WebView (irctc.co.in only, stock mobile-Chrome UA — same wrapper pattern
 *   as BookingScreen). The user enters/submits the PNR themselves on the
 *   page; nothing is auto-submitted. Statuses are never invented: the app
 *   shows reminders derived from the departure date you enter, and the live
 *   status only on IRCTC's own page.
 *
 * DEVICE-TEST ITEM: IRCTC_PNR_URL is the documented enquiry route — confirm
 * it still resolves on the live site before release.
 */
import React, { useCallback, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import WebView from '../webview';
// Type-only deep import: erased at compile time (same trick as BookingScreen).
import type { ShouldStartLoadRequest } from 'react-native-webview/lib/WebViewTypes';
import { useTheme } from '../theme';
import type { Theme } from '../theme';
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
import DatePickerField from './DatePickerField';
import {
  AppHeader,
  AppDialog,
  Card,
  EmptyState,
  IconButton,
  LabeledInput,
  PNRCard,
  PrimaryButton,
  Screen,
  SecondaryButton,
  Skeleton,
} from '../components/ui';
import { Icon, ICON_SIZE } from '../components/icons';

// IRCTC's PNR enquiry route (nget SPA). Grounded 2026-09-26 via web search;
// IRCTC may move SPA routes — verify on device before release.
const IRCTC_PNR_URL = 'https://www.irctc.co.in/nget/pnr-enquiry';

// Stock mobile-Chrome UA — same fingerprint reasoning as BookingScreen.
const STOCK_CHROME_MOBILE_UA =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36';

interface Draft {
  pnr: string;
  departureDate: string; // YYYY-MM-DD, device-local, optional
  departureTime: string; // HH:mm, device-local, optional (defaults 00:00)
  label: string;
}

const blankDraft = (): Draft => ({ pnr: '', departureDate: '', departureTime: '', label: '' });

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

type PnrTone = 'success' | 'info' | 'warn' | 'danger' | 'neutral';

/** Status line + tone for a tracked PNR. Reminders only — never a live status. */
function pnrReminder(item: TrackedPnr): { text: string; tone: PnrTone } {
  if (!item.departureISO) {
    return {
      text: 'No departure date saved — add one when you track it for chart reminders.',
      tone: 'neutral',
    };
  }
  try {
    const { firstChart, secondChart } = chartReminderTimes(item.departureISO);
    const msLeft = new Date(item.departureISO).getTime() - Date.now();
    const text =
      `${formatPnrStatusReminder(msLeft)}\n` +
      `~1st chart ${fmtDate(firstChart.toISOString())} · ` +
      `~2nd chart ${fmtDate(secondChart.toISOString())}`;
    const tone: PnrTone =
      msLeft <= 0 ? 'neutral' : msLeft <= 4 * 3_600_000 ? 'warn' : 'info';
    return { text, tone };
  } catch {
    // Corrupted stored date: show the PNR without reminders.
    return { text: 'Saved departure date is unreadable — reminders unavailable.', tone: 'neutral' };
  }
}

export default function PnrScreen({ nav }: { nav: Nav }) {
  const { theme } = useTheme();
  const s = styles(theme);
  const [list, setList] = useState<TrackedPnr[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [viewing, setViewing] = useState<TrackedPnr | null>(null);
  const [blockedUrl, setBlockedUrl] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<TrackedPnr | null>(null);

  const reload = useCallback(async () => setList(await loadPnrs()), []);
  useFocusLoad(reload);

  const persist = async (next: TrackedPnr[]) => {
    try {
      await savePnrs(next);
      setList(next);
    } catch (e) {
      setError(
        'Could not save — storage unavailable. The PNR was NOT saved. ' +
          String(e instanceof Error ? e.message : e),
      );
    }
  };

  const saveDraft = async () => {
    if (!draft) return;
    const pnr = draft.pnr.replace(/[\s-]/g, '');
    if (!isValidPnr(pnr)) {
      setError('PNR must be exactly 10 digits.');
      return;
    }
    let departureISO: string | undefined;
    if (draft.departureDate) {
      const time = draft.departureTime.trim() === '' ? '00:00' : draft.departureTime.trim();
      if (!/^\d{2}:\d{2}$/.test(time)) {
        setError('Departure time: use HH:mm, e.g. 14:30.');
        return;
      }
      try {
        departureISO = parseDepartureLocal(`${draft.departureDate} ${time}`);
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

  const confirmDelete = (item: TrackedPnr) => setPendingDelete(item);
  const doDelete = () => {
    if (!pendingDelete) return;
    if (viewing?.id === pendingDelete.id) setViewing(null);
    setPendingDelete(null);
    void persist(list.filter((t) => t.id !== pendingDelete.id));
  };

  const onShouldStartLoadWithRequest = useCallback((req: ShouldStartLoadRequest) => {
    const ok = isAllowedUrl(req.url);
    if (!ok) setBlockedUrl(req.url);
    return ok; // G9: only irctc.co.in loads
  }, []);

  // --- WebView "check status" mode -----------------------------------------
  if (viewing) {
    return (
      <View style={s.webRoot}>
        <View style={s.bannerPad}>
          <Card>
            <View style={s.bannerRow}>
              <View style={s.bannerTextWrap}>
                <Text style={s.bannerText}>
                  Enter this PNR on IRCTC's page yourself — the app never submits it for you.
                </Text>
                <Text style={s.bannerPnr}>{viewing.pnr}</Text>
              </View>
              <IconButton
                icon="arrowLeft"
                variant="outlined"
                onPress={() => setViewing(null)}
                label="Back to all PNRs"
                size={20}
              />
            </View>
          </Card>
        </View>
        {blockedUrl && (
          <Text style={s.blocked}>Blocked non-IRCTC navigation: {blockedUrl}</Text>
        )}
        <WebView
          source={{ uri: IRCTC_PNR_URL }}
          userAgent={STOCK_CHROME_MOBILE_UA}
          javaScriptEnabled
          domStorageEnabled
          onShouldStartLoadWithRequest={onShouldStartLoadWithRequest}
          startInLoadingState
          renderLoading={() => (
            <View style={s.loadingPad}>
              <Skeleton height={22} width="55%" />
              <Skeleton height={110} style={s.loadingGap} />
              <Skeleton height={110} style={s.loadingGap} />
              <Skeleton height={110} style={s.loadingGap} />
            </View>
          )}
          style={s.webview}
        />
      </View>
    );
  }

  // --- List mode -------------------------------------------------------------
  return (
    <Screen>
      <AppHeader title="My PNRs" subtitle="Live status straight from IRCTC" />

      {list.length === 0 && !draft ? (
        <EmptyState
          icon="ticket"
          title="No saved PNRs"
          message="Track a PNR to get chart-preparation reminders before it departs."
          actionLabel="Track a PNR"
          onAction={() => setDraft(blankDraft())}
        />
      ) : (
        list.map((item) => {
          const { text, tone } = pnrReminder(item);
          return (
            <View key={item.id} style={s.cardWrap}>
              <PNRCard
                pnr={item.pnr}
                statusText={text}
                status={tone}
                trainLabel={item.label}
              />
              <View style={s.cardActions}>
                <SecondaryButton
                  title="Check status"
                  icon="search"
                  onPress={() => setViewing(item)}
                  accessibilityLabel={`Check live status for PNR ${item.pnr} on IRCTC`}
                  style={s.checkBtn}
                />
                <IconButton
                  icon="trash"
                  variant="danger"
                  onPress={() => confirmDelete(item)}
                  label={`Delete PNR ${item.pnr}`}
                  size={20}
                />
              </View>
            </View>
          );
        })
      )}

      {draft ? (
        <Card style={s.formCard}>
          <Text style={s.formTitle}>Track a PNR</Text>
          <LabeledInput
            label="PNR number"
            placeholder="10-digit PNR"
            keyboardType="numeric"
            maxLength={10}
            value={draft.pnr}
            onChangeText={(t) => setDraft({ ...draft, pnr: t })}
          />
          <DatePickerField
            label="Departure date (optional)"
            value={draft.departureDate}
            onSelect={(iso) => setDraft({ ...draft, departureDate: iso })}
            placeholder="Select date (optional)"
            note="Used for chart-time reminders."
          />
          <LabeledInput
            label="Departure time (optional)"
            placeholder="HH:mm, e.g. 14:30"
            keyboardType="numbers-and-punctuation"
            maxLength={5}
            value={draft.departureTime}
            onChangeText={(t) => setDraft({ ...draft, departureTime: t })}
          />
          <LabeledInput
            label="Label (optional)"
            placeholder="NDLS → LKO"
            value={draft.label}
            onChangeText={(t) => setDraft({ ...draft, label: t })}
          />
          {error && <Text style={s.error}>{error}</Text>}
          <View style={s.formRow}>
            <PrimaryButton
              title="Save"
              onPress={saveDraft}
              accessibilityLabel="Save PNR"
              style={s.formBtn}
            />
            <SecondaryButton
              title="Cancel"
              onPress={() => { setDraft(null); setError(null); }}
              accessibilityLabel="Cancel, discard draft"
              style={s.formBtn}
            />
          </View>
        </Card>
      ) : (
        list.length > 0 && (
          <PrimaryButton
            title="Track a PNR"
            icon="plus"
            onPress={() => setDraft(blankDraft())}
            accessibilityLabel="Track a new PNR"
            fullWidth
            style={s.trackBtn}
          />
        )
      )}

      <Card variant="outlined" style={s.hintCard}>
        <View style={s.hintRow}>
          <Icon name="info" size={ICON_SIZE.sm} color={theme.colors.muted} accessibilityLabel="Chart timing note" />
          <Text style={s.hintText}>
            Charts are usually prepared about 4 hours before departure, with the
            final chart about 30 minutes before. Timings vary by train and
            station — treat these as a guide, not a guarantee.
          </Text>
        </View>
      </Card>


      <AppDialog
        visible={pendingDelete !== null}
        title="Delete PNR?"
        message={
          pendingDelete
            ? `Stop tracking PNR ${pendingDelete.pnr}? This can't be undone.`
            : ''
        }
        onDismiss={() => setPendingDelete(null)}
        actions={[
          { label: 'Cancel', onPress: () => setPendingDelete(null), variant: 'ghost' },
          { label: 'Delete', onPress: doDelete, variant: 'danger' },
        ]}
      />
    </Screen>
  );
}

const styles = (theme: Theme) => StyleSheet.create({
  cardWrap: { marginBottom: theme.spacing.md },
  cardActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
    marginTop: theme.spacing.sm,
  },
  checkBtn: { flex: 1 },
  formCard: { marginTop: theme.spacing.sm },
  formTitle: {
    fontSize: theme.typography.h3.size,
    fontWeight: theme.typography.h3.weight,
    color: theme.colors.ink,
    marginBottom: theme.spacing.sm,
  },
  error: {
    color: theme.colors.danger,
    fontSize: theme.typography.bodySm.size,
    marginTop: theme.spacing.sm,
  },
  formRow: { flexDirection: 'row', gap: theme.spacing.sm, marginTop: theme.spacing.md },
  formBtn: { flex: 1 },
  trackBtn: { marginTop: theme.spacing.sm },
  hintCard: { marginTop: theme.spacing.lg, marginBottom: theme.spacing.md },
  hintRow: { flexDirection: 'row', gap: theme.spacing.sm },
  hintText: {
    flex: 1,
    color: theme.colors.muted,
    fontSize: theme.typography.bodySm.size,
    lineHeight: theme.typography.bodySm.lineHeight,
  },
  webRoot: { flex: 1, backgroundColor: theme.colors.bg },
  bannerPad: { padding: theme.spacing.md, paddingBottom: 0 },
  bannerRow: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm },
  bannerTextWrap: { flex: 1 },
  bannerText: {
    color: theme.colors.muted,
    fontSize: theme.typography.bodySm.size,
    lineHeight: theme.typography.bodySm.lineHeight,
  },
  bannerPnr: {
    color: theme.colors.ink,
    fontSize: theme.typography.h3.size,
    fontWeight: theme.typography.mono.weight,
    fontFamily: theme.typography.mono.fontFamily,
    letterSpacing: 2,
    marginTop: 4,
  },
  blocked: {
    color: theme.colors.danger,
    fontSize: theme.typography.caption.size,
    paddingHorizontal: theme.spacing.md,
    marginTop: theme.spacing.sm,
  },
  webview: { flex: 1 },
  loadingPad: { flex: 1, padding: theme.spacing.md, backgroundColor: theme.colors.bg },
  loadingGap: { marginTop: theme.spacing.md },
});
