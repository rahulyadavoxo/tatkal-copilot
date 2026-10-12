# Tatkal Copilot — Frontend Handoff (2026-10-08)

Complete React Native (Expo) frontend source. Redesign the UI/UX freely.

## What this app does

Android-first Expo app that automates IRCTC Tatkal train booking up to the
payment step. A WebView loads the real IRCTC site; JS "engines" injected into
the page fill forms and tap buttons. The user reviews everything and pays by
hand — the app never submits payment itself.

## Workflow (the part that must keep working)

1. Home — trip list, countdown to Tatkal opening, readiness checklist.
2. TripSetup — journey details + payment preferences (saved per trip).
3. Passengers — saved passenger vault (add/edit/delete, meal preference).
4. Booking (WebView) — engines run in order:
   - prebookEngine — login detection, waits for user login.
   - postSearchEngine — fills search form, taps Search Trains, picks train,
     handles Tatkal quota countdown, taps Book Now.
   - fillEngine — fills passenger form (names, age, gender, berth, food,
     mobile), insurance, payment mode.
   - reviewEngine — taps Continue on the Review Journey page (single tap,
     waits as long as the page needs — NEVER add auto re-taps; IRCTC kills
     the session on double-clicked buttons).
   - paymentEngine — selects the saved payment method (verify-first, max 2
     clicks, never the same target twice), selects provider, taps Continue,
     taps Pay & Book once. STOPS at the external gateway; user pays by hand.
   - resumeProbe — classifies the current page so "Find train & continue"
     injects the right engine after interruptions.
5. Settings — app updates row (shows running OTA update id), vault, etc.

## Files you care about (UI/UX redesign)

- src/theme.ts — design tokens (colors, spacing, type). Start here.
- src/components/ — shared UI: Icon.tsx (centralized icon component —
  ALL icons go through this), buttons, cards, banners, steppers.
- src/screens/ — HomeScreen, TripSetupScreen, PassengersScreen,
  BookingScreen (WebView + notices), SettingsScreen, Onboarding.
- src/nav.ts — navigation structure.
- App.tsx, src/ErrorBoundary.tsx — shell.

## Files you should NOT redesign (logic must stay intact)

- src/core/*Engine.ts, src/core/resumeProbe.ts — the injected automation.
  You may change how their status/notices LOOK in BookingScreen, but not
  what they do. The engines post events (FILL_STEP_OK, PAYMENT_STEP_MISSING,
  GATEWAY_REACHED, etc.); BookingScreen renders notices from those events —
  that notice UI is yours to redesign.
- src/vaultStore.ts, src/updates.ts — encrypted vault + OTA update logic.
- src/__tests__/, src/harness/ — tests and the browser test harness
  (mockIrctcBooking.html simulates IRCTC; runHarness.js runs 38 checks).

## Hard rules (from real IRCTC behavior — do not break)

- Never auto re-tap any IRCTC button (session death).
- Never auto-select a payment option twice / when already selected.
- Never submit payment or enter OTP/bank details — user does it by hand.
- No user-agent spoofing or WAF evasion anywhere.
- Notices must stay plain, non-technical wording.

## Build & verify

- npm install, then: node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json
- Tests: node node_modules/jest/bin/jest.js
- Browser harness: node src/harness/runHarness.js
- android/ and ios/ native dirs are NOT in this zip — regenerate with
  `expo prebuild` (then re-pin android.kotlinVersion=1.9.24 in
  android/gradle.properties, template default breaks the build).

## Current state

- Branch preview, runtime 1.0.0, latest OTA 32634e5b (Android update 01a11c45).
- Preview APK: https://expo.dev/artifacts/eas/tDBBobquKpkAJdq0txXtWzTTqL-3XohO9XnU2eh9GdA.apk
- All 178 unit tests + 38 harness checks green.
