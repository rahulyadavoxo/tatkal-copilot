# Tatkal Copilot — Wave 1 component library

**For Wave 2 workers.** Everything here is theme-aware. Do not hard-code colors.

## Theming (`src/theme.ts`)

```tsx
import { useTheme } from '../theme';

function MyScreen() {
  const { theme, mode, setMode, toggle, isDark } = useTheme();
  return <View style={{ backgroundColor: theme.colors.bg, padding: theme.spacing.lg }} />;
}
```

- Wrap the app root once: `<ThemeProvider>` (defaults to the OS scheme via
  `Appearance.getColorScheme()`; follows OS changes until the user picks a mode).
- Optional: `<ThemeProvider initialMode="dark">` to force a mode.
- `theme.colors`: `bg, surface, surface2, card, ink, muted, faint, line,`
  `primary, primaryDeep, onPrimary, accent, danger, dangerDeep, onDanger,`
  `warn, success, info, lime, overlay,` plus `*Tint` / `*OnTint` pairs for badges.
- `theme.typography`: `display, h1, h2, h3, body, bodySm, caption, mono`
  (each `{ size, weight, lineHeight, fontFamily? }`).
- `theme.spacing`: `xs 4, sm 8, md 12, lg 16, xl 24, xxl 32, xxxl 48`.
- `theme.radius`: `xs 4, sm 8, md 12, lg 16, xl 24, full 9999`.
- `theme.elevation`: `none, sm, md, lg` (spread into style).
- `theme.motion`: `instant 0, fast 150, normal 250, slow 400` (ms).
- Legacy `C`, `BERTH_LABELS`, `GENDER_LABELS` still exported for old screens.

**Contrast is verified by computation** (33 pairs, body ≥ 4.5:1, disabled ≥ 3:1).
Never put `lime` as text on a light background — use `primary`/`primaryDeep`.

## Icons (`src/components/icons.tsx`)

```tsx
import { Icon } from './components/icons';   // from src: '../components/icons'
<Icon name="train" size={24} color={theme.colors.ink} accessibilityLabel="Train" />
```

Pure-View icons (no react-native-svg). `color` defaults to theme ink.
Names: `home, ticket, train, users, bell, shield, settings, search, plus, x,
check, chevronRight, chevronLeft, chevronDown, clock, calendar, mapPin, eye,
eyeOff, trash, edit, alertTriangle, info, wifiOff, arrowLeft, history, card,
logout, helpCircle, moon, sun, lock, externalLink, refresh, minus`.
Text glyphs are used for `check/x/chevrons/plus/minus/arrows` — never emoji.

## Components (`src/components/ui.tsx`)

All importable from one place:

```tsx
import {
  Screen, SectionHeader, Divider, ListRow,
  PrimaryButton, SecondaryButton, GhostButton, IconButton,
  Card, Badge, StatusBadge, ProgressStepper,
  BottomSheet, AppDialog, SnackbarProvider, useSnackbar,
  Skeleton, EmptyState, ErrorState,
  Countdown, ReadinessCard,
  TripCard, PassengerCard, TrainCard, PNRCard, BookingCard,
  AutomationStatus, InterventionCard, SecureVaultCard,
  LabeledInput, SegmentedControl,
  Icon, useTheme,
} from './components/ui';
```

### Layout
- `<Screen scroll padded>` — SafeAreaView + optional ScrollView + standard padding.
- `<SectionHeader title subtitle action>` — h3 title row with optional right action.
- `<Divider />`, `<ListRow title subtitle icon onPress right showChevron destructive />`
  (chevron rows for settings menus; min height 56).

### Buttons (min 44–48dp targets, `accessibilityRole="button"`, disabled + loading)
- `<PrimaryButton title onPress disabled loading icon fullWidth size="md"|"lg" />`
- `<SecondaryButton … />` (outline), `<GhostButton … />` (text-only).
- `<IconButton icon onPress label variant="plain"|"filled"|"outlined"|"danger" size />`
  — always 44×44; **`label` is required** (announced to screen readers).

### Surfaces & feedback
- `<Card variant="default"|"elevated"|"outlined" padding="none"|"sm"|"md"|"lg">`.
- `<Badge label variant="success"|"info"|"warn"|"danger"|"neutral"|"primary" icon />`
  — pill with icon + text, never color-alone. `<StatusBadge status label />` alias.
- `<ProgressStepper steps={["Trip","Passengers","Ready"]} current={1} />`.
- `<BottomSheet visible onClose title>` — backdrop-tap dismisses.
- `<AppDialog visible title message actions={[{label,onPress,variant:"primary"|"danger"|"ghost",disabled}]} onDismiss />`.
- Snackbar: wrap root in `<SnackbarProvider>`, then
  `const show = useSnackbar(); show("Saved", { actionLabel: "Undo", onAction, duration })`.

### States
- `<Skeleton width height radius />`, `<EmptyState icon title message actionLabel onAction />`,
  `<ErrorState message title onRetry retryLabel />`.

### Booking-specific
- `<Countdown seconds size="sm"|"md"|"lg" caption stateText stateVariant />` — HH:MM:SS.
- `<ReadinessCard title items={[{label, done}]} />` — checklist + progress bar.
- `<TripCard fromLabel toLabel dateLabel trainLabel onEdit onDelete />`
- `<PassengerCard name age genderLabel berthLabel onEdit onDelete />`
- `<TrainCard trainName trainNo fromCode toCode departure arrival duration selected onSelect />`
- `<PNRCard pnr statusText status trainLabel onRefresh />`
- `<BookingCard title subtitle status statusLabel icon onPress />`
- `<AutomationStatus steps={[{label, detail, state}]} />` — state:
  `done | active | pending | waiting` ("Waiting on you" is shown for `waiting`).
- `<InterventionCard kind="captcha"|"otp"|"payment"|"unknown" onPrimary
  secondaryLabel onSecondary />` — friendly copy built in; override `title/message/primaryLabel`.
- `<SecureVaultCard />` — lock row: "Stored encrypted on this device".

### Fields
- `<LabeledInput label error hint …TextInputProps />` — 48dp, error row with icon.
- `<SegmentedControl label options={[{value,label}]} value onChange />` — chips,
  `accessibilityRole="radio"`.

## Copy rules (hard)
Never use: "guaranteed", "100% success", "auto booking", "bot", "instant confirmed
ticket". Use: "prepared", "ready", "assisted", "your final action", "stay in control".
No fake data — no fabricated availability, stats, or reviews. No emojis as icons.
