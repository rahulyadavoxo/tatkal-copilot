# Tatkal Copilot — Build Plan (Unlazy style)

**Goal:** Android-first mobile app that gives a user the fastest *legitimate* Tatkal
booking attempt possible: prefilled form fired at 10:00 at human pace, Aadhaar OTP
handled with one-tap fill, payment handed to the user's own UPI app.

**Hard lines (never crossed):**
- No auto-submit bot. The final booking submit happens only on an explicit user tap.
- No credential exfiltration: IRCTC login stays inside the on-device WebView session.
- No UPI PIN handling: payment approval happens inside the user's UPI app only.
- Fill pacing respects IRCTC's anti-bot tripwire (~4.2s floor for 5 passengers).

## Verdict: app, not web (answered 2026-09-26)

A pure website **cannot** do the core job: browsers block cross-origin script
injection (same-origin policy), so a web page can never fill IRCTC's form.
Mobile Chrome doesn't run extensions either. Only a native app gives us:
(1) a WebView we control (inject the fill script into IRCTC pages),
(2) SMS OTP autofill on Android, (3) exact alarms at 09:55, (4) persistent login
session. A desktop Chrome extension can come later as a companion for laptop bookers.

**Stack:** Expo (React Native + TypeScript), `react-native-webview` (fill injection),
`@noble/ciphers` (AES-256-GCM, pure JS) + `expo-secure-store` (key storage),
`react-native-otp-verify` (Android SMS User Consent, one-tap OTP read) via config
plugin → requires Expo dev client (not Expo Go) for the OTP native module.

## Acceptance gates (written before implementation)

| Gate | Requirement | Fail-honest check | Success marker |
|------|-------------|-------------------|----------------|
| G0 | This PLAN.md exists with gates, leaves, architecture | reviewer reads it | file present |
| G1 | Fill engine completes 4-passenger Tatkal form (Tatkal PNR cap) on mock IRCTC DOM, every field correct, wall time in (4.2s, 120s] | headless-Chromium harness asserts each field value + timing | harness prints `FILL_OK` + duration |
| G2 | Human-pace floor: total ≥ max(4.2s, 0.84s × pax) (4.2s = IRCTC's published 5-pax tripwire, binding minimum); per-field gaps ≥ 120ms with jitter (seeded in tests) | timing analysis of engine event log | `PACE_OK` |
| G3 | Passenger vault: AES-256-GCM at rest; decrypt(encrypt(x))==x; wrong key throws; ciphertext ≠ plaintext; key never logged | Jest suite | `VAULT_OK` |
| G4 | OTP gate: on OTP screen engine MUST pause and emit OTP_REQUIRED; MUST NOT submit without USER_CONFIRMED_OTP | state-machine test on trace | `OTP_GATE_OK` |
| G5 | No-auto-book invariant: injected script contains zero booking-submit calls outside the user-tap handler | unit test scanning script source + review | `NO_AUTOBOOK_OK` |
| G6 | Tatkal window math: open = journeyDate − 1 day @ 10:00 (AC) / 11:00 (non-AC) IST; month/year boundaries pass | Jest with fixed dates | `WINDOW_OK` |
| G7 | Fallback: mock "seats unavailable" → alternates (trains/dates) surfaced ≤ 5s | harness test | `FALLBACK_OK` |
| G8 | Build health: `tsc --noEmit` clean, Jest green, ESLint clean, `expo prebuild` (Android) succeeds, secret scan clean | CI-style script | `BUILD_OK` |
| G9 | Privacy: network allowlist = irctc.co.in (+ PNR API if used); vault never leaves device | WebView request-interception test + arch review | `PRIVACY_OK` |

Config constants (open times, OTP mandate) live in `src/core/tatkalConfig.ts` and MUST
cite sources in `docs/IRCTC_RULES.md` (L1). If IRCTC changes rules, only the config changes.

## Leaves & dependencies

- **L1 research spike** → `docs/IRCTC_RULES.md` + `tatkalConfig.ts`. No deps. (subagent)
- **L2 fill engine + mock harness** → `src/core/fillEngine.ts`, `src/harness/*`. Deps: PLAN.md contract; uses config constants (stub until L1 lands). (subagent)
- **L3 vault + window math** → `src/core/vault.ts`, `timing.ts`, tests. Deps: L1 constants. (main agent)
- **L4 RN shell** → `app/` screens: countdown, WebView, OTP UI. Deps: L2, L3.
- **L5 fallback + PNR** → `src/core/alternates.ts`, PNR tracking. Deps: L2.
- **B1 branch gates** → full E2E harness run, security review, README + your-half checklist.

## Device reality (standing rule)

Harness-verified ≠ device-verified. Live IRCTC testing on a real phone is the
user's half (like Receipto's phone tests). Nothing is called "works on IRCTC"
until a real 10:00 attempt confirms it.
