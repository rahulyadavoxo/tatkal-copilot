# Tatkal Copilot

An Android-first copilot that makes your Tatkal attempt the fastest *legitimate*
attempt possible. It does not book tickets by itself, it cannot guarantee a
confirmed seat, and it never touches your IRCTC password.

## What it does

On a normal Tatkal morning you type passenger names, ages, genders and berth
preferences while seats vanish — roughly 7 minutes of typing against a 2-minute
seat window. Tatkal Copilot reduces that to one tap:

1. **Before the window:** save up to 4 passengers (encrypted on your phone),
   set your trip (train, stations, date, AC/non-AC), see the exact 10:00 / 11:00
   IST opening countdown.
2. **At the window:** log in to IRCTC yourself inside the app, tap **"Fill my
   form"** — all passenger fields fill in under 5 seconds, paced to stay above
   IRCTC's bot-detection tripwire.
3. **OTP:** when IRCTC asks for the Aadhaar OTP, the app stops and shows you a
   keypad. You enter it, tap once to place it on the page.
4. **Final tap is yours:** you review the filled form and tap **"Review & Book
   on IRCTC"** — the *only* thing that can submit the booking, and only from
   your explicit tap.

Also included: PNR tracking with chart-prep reminders, all inside the same
IRCTC-only WebView.

## What it will NOT do (hard lines)

- No auto-booking. No background booking. No booking without your tap.
- No CAPTCHA bypass, no server hammering, no request spoofing.
- Your IRCTC login stays inside the on-device IRCTC session — it goes only to
  IRCTC, never to the agent, never to any server.
- No broad SMS permission; OTP is entered manually (v1).
- Payment happens on IRCTC's own pages in the WebView; no UPI PIN is ever
  stored or handled.

## Project status

| Gate | State |
|------|-------|
| G1 Fill engine: 4-passenger form in <5s | ✅ headless-harness verified |
| G2 Human-like pacing (≥4.2s total, ≥120ms/field) | ✅ verified |
| G3 AES-256-GCM passenger vault | ✅ 15/15 tests |
| G4 Engine halts at OTP, submits nothing | ✅ verified |
| G5 No autonomous booking path | ✅ single user-tap call site, grep-audited |
| G6 Tatkal window math (10:00 AC / 11:00 non-AC, leap days) | ✅ tests |
| G7 No-seat fallbacks surface in <5s | ✅ harness (3 alternates, ~30ms) |
| G8 Typecheck, tests, lint, secret scan | ✅ 47/47 tests, tsc clean, scan clean |
| G9 Network allowlist limited to `irctc.co.in` | ✅ tests |

**Not yet verified (needs your phone):** live IRCTC DOM mapping, WebView
fingerprint behavior, OTP screen position, and a real 10:00/11:00 attempt.
Harness-green ≠ IRCTC-live.

## Build it (your machine)

Requires Node 18+ and the Expo/EAS CLI. From this folder:

```bash
npm install --no-bin-links   # sandbox quirk: skip .bin symlinks
npm test                      # 47/47 expected
npm run typecheck             # must be clean
npx expo prebuild             # generates android/
npx eas build -p android --profile preview   # APK, or use Expo Go for UI-only testing
```

Install the APK on your Android phone. First launch: add passengers, set a
trip, and run the dry-run checklist below *before* any real Tatkal morning.

## Your-half checklist (the part only you can do)

- [ ] IRCTC account is Aadhaar-verified (mandatory for online Tatkal since
      July 2025) and you can log in normally in Chrome.
- [ ] App installed; passengers added; a *practice* trip set for a date with
      no real booking intent.
- [ ] IRCTC opens inside the app's WebView and you can log in.
- [ ] "Fill my form" fills the passenger form on the **live** IRCTC page
      (note any field it misses — IRCTC changes its DOM; report it).
- [ ] OTP overlay appears at the right step; manual OTP entry works.
- [ ] Do a full dry run at a real 10:00/11:00 window **without** paying, to
      time yourself to the payment step.
- [ ] If IRCTC ever warns about or blocks the account: STOP and report it.
      Never try to evade a block.

## Repo layout

- `src/core/` — engine, vault, timing, privacy allowlist, PNR logic (+ tests)
- `src/screens/` — the 6 app screens
- `src/harness/` — mock-IRCTC page + headless verification harness
- `docs/IRCTC_RULES.md` — researched rules with sources (2026-09-26)
- `PLAN.md` — gates and architecture
