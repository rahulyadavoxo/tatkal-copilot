# Tatkal Copilot — Logo / Icon Handoff (2026-10-08)

Redesign the app's logo and icon set. Everything else is context so you can
see where each mark appears in the real workflow.

## What to redesign

1. `src/components/icons.tsx` — THE icon set (800 lines, 36 icons). This is
   the "logo code": every icon in the app renders through the `Icon`
   component. There is no react-native-svg dependency, so each icon is a pure
   React Native `View` composition drawn in a 24x24 box (simple marks like
   check / x / chevrons / plus use text glyphs — never emoji). Keep the
   `Icon` component's props (`name`, `size`, `color`, `accessibilityLabel`)
   and the `IconName` union shape; you may redraw every glyph and add names.
2. `assets/icon.png` — the Android launcher icon (referenced in app.json).
   If you supply a new one, keep the filename and path.
3. Splash screen config lives in `app.json` (`expo.splash`) — update if your
   logo needs it.

## Icon usage across the workflow (so your redesign fits)

- `src/components/BottomTabs.tsx` — tab bar: home, search (PNR), plus
  (center Book button), history (Activity), users (You).
- `src/screens/HomeScreen.tsx` — app bar (bell, settings), story-row
  shortcuts, hero ticket card (train, clock, calendar, mapPin), readiness
  checklist (check / alertTriangle), CTA buttons.
- `src/screens/BookingScreen.tsx` — flow notices (info, alertTriangle,
  check), payment step icons (card, shield).
- `src/components/ui.tsx` — AppHeader (arrowLeft back, bell with unread
  dot), buttons, chips, list rows (chevronRight), inputs (eye/eyeOff).
- `src/screens/SettingsScreen.tsx` — rows: moon/sun (theme), bell,
  shield (privacy), helpCircle, logout, refresh (updates), lock (app lock).
- `src/screens/PassengersScreen.tsx` — edit, trash, plus, users.
- `src/screens/TripSetupScreen.tsx`, `PnrScreen.tsx`,
  `TrainLookupScreen.tsx`, `ActivityScreen.tsx`, `ProfileScreen.tsx`,
  `NotificationsScreen.tsx`, `OnboardingScreen.tsx` — same set.

## Constraints (do not break)

- No new native dependencies (no react-native-svg): icons must stay pure
  React Native Views, or text glyphs — never emoji.
- Keep the `Icon` API: `<Icon name size color accessibilityLabel />` and
  the exported `IconName` type + `ICON_SIZE` tokens. Every screen imports
  from `./components/icons` or `../components/icons`.
- Colors come from `useTheme()` (`src/theme.ts`): use `theme.colors.ink`,
  `muted`, `primary`, `onPrimary`, never hardcoded hex in icons, so dark
  mode keeps working. Brand violet is `#5B3DF5` (light) / `#9B8CFF` (dark).
- Accessibility: every `Icon` takes an `accessibilityLabel`; decorative
  icons pass none. Keep that behavior.
- The booking automation (`src/core/*`) does not use icons — don't touch it.

## Workflow context (included, do not redesign)

`src/App.tsx` (shell + ThemeProvider), `src/nav.ts`, `src/screens/` (the
booking flow: Home → TripSetup → Passengers → Booking WebView → Settings),
`src/core/` (the IRCTC automation engines — logic only, no UI).

## Verify after redesign

- `node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json` (clean)
- `node node_modules/jest/bin/jest.js` (178/178)
- `node src/harness/runHarness.js` (38/38)
