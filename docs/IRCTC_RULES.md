# IRCTC Rules & Enforcement Facts (L1 research spike)

All facts verified by web search on **2026-09-26**. Each fact carries its
source. Items that could not be confirmed are marked **UNVERIFIED**.
Re-verify before every release — IRCTC changes rules without much notice.

## 1. Tatkal booking window

- Tatkal opens **one day before the journey date**, excluding the date of
  journey, calculated from the train's **originating station**.
- **AC classes: 10:00 AM IST. Non-AC classes: 11:00 AM IST.**
  AC = 2A/3A/CC/EC/3E; Non-AC = SL/FC/2S. Tatkal not available in First AC.
- Agent restriction: authorised ticketing agents are barred from booking
  opening-day Tatkal during the first 30 minutes: **10:00–10:30 (AC)** and
  **11:00–11:30 (non-AC)**.
- Timings were rumoured to change in April 2025; IRCTC officially denied it —
  timings unchanged since.
- Sources:
  - https://www.aaptaxlaw.com/IRCTC/Tatkal-Ticket-Booking-IRCTC-Charges-Indian-Railway-Tatkal-Ticket-booking-Timing.html
  - https://factly.in/indian-railways-has-not-changed-the-tatkal-booking-timings-and-rules/
  - https://www.cnbctv18.com/travel/destinations/commuters-unsure-of-change-in-tatkal-ticket-booking-timings-irctc-says-no-change-19588540.htm/amp

## 2. Aadhaar OTP mandate for Tatkal (2025)

- **1 July 2025:** online Tatkal (IRCTC website/app) restricted to
  **Aadhaar-authenticated accounts** (profile linked + verified via UIDAI OTP).
- **15 July 2025:** **Aadhaar-based OTP authentication became mandatory per
  Tatkal booking** made online — OTP goes to the **Aadhaar-linked mobile
  number** (UIDAI), and must be completed for every booking, even on an
  already-verified account.
- PRS counters / authorised agents: system-generated OTP to the mobile number
  given at booking time, also from 15 July 2025.
- New IRCTC accounts without Aadhaar verification must wait **3 days** after
  registration before booking Tatkal (reported June 2025).
- Authoritative source (Ministry of Railways press release, 11 Jun 2025):
  - https://www.pib.gov.in/PressReleasePage.aspx?PRID=2135694&ref=static.internetfreedom.in&reg=48&lang=2
- Also: https://www.thehindu.com/news/national/railways-tightens-tatkal-ticket-norms-aadhaar-based-authentication-made-mandatory/article69683148.ece
- https://www.mymobileindia.com/tatkal-booking-rules-change-starting-july-1-aadhaar-now-mandatory-for-irctc-users/ ("every time you make a Tatkal booking" → per-booking scope)
- https://www.medianama.com/2025/06/223-indian-railways-tackles-tatkal-booking-problems-with-anti-bot-system/ (3-day wait for non-Aadhaar accounts)

**Design impact:** the engine MUST pause at the OTP step and emit
OTP_REQUIRED; no auto-submit. The OTP is read via Android SMS User Consent
(one user tap) and the user confirms.

## 3. Anti-bot enforcement

- IRCTC's AI system analyses **typing speed, login patterns, user behaviour**.
  Officially reported tripwires:
  - Filling details for **five passengers in < 4.2 seconds** → flagged as
    bot-like. Copy-paste entries, auto-fill tools, script-based entry also
    attract scrutiny.
  - **> 5 logins/logouts in 30 minutes** from the same ID → 24-hour block.
  - IP geolocation vs registered mobile number region mismatch → transaction
    halted midway.
  - Bulk late-night add/delete of master-list names, frequent master-list
    changes → suspicious.
- Sources:
  - https://the420.in/irctc-blocks-28-lakh-accounts-ai-tout-detection/
  - https://patnapress.com/irctc-ai-id-block-rule/
- Sept 2026 crackdown (announced 11 Sept 2026): **3.04 crore user IDs
  deactivated**, **6.33 crore IDs suspended** pending authenticity
  verification; 16,041 suspicious email domains blocked; 592 cyber-crime
  complaints covering 4.21 lakh suspicious PNRs.
  - https://www.thehindu.com/news/national/irctc-deactivates-over-three-crore-user-ids-suspends-633-crore-ids/article71456066.ece
- Enforcement scale context: Railway Minister (Lok Sabha reply, ~July 2026):
  ~58% of IRCTC booking requests were automated/bot attempts denied access;
  bot manager uses behavioural analysis, bot-signature matching, real-time
  risk scoring.
  - https://timesofindia.indiatimes.com/india/58-of-irctc-booking-requests-were-automated-access-denied-railways/articleshow/132564519.cms
- Tout arrests: RPF arrested **22,676 touts since 2021** (TOI, mid-2026).
  Earlier parent-context figure of 13,580 in 3.5 years (Railway Minister,
  Lok Sabha) is older/partial — **record the conflict; use 22,676 as the
  newer figure** with the TOI citation.
- Session hygiene (peak periods): > 25 enquiries in one session → auto
  logout; one ticket per session (return/onward excepted).
  - https://hospitalitycareerprofile.com/news/irctc-enhances-ticketing-platform-security-with-major-digital-overhaul-deactivation-of-over-two-crore-suspect-user-ids-and-anti-bot-measures
- Useful: IRCTC **removed the login captcha** in its 2025–26 site/app
  redesign.
  - https://www.mid-day.com/amp/mumbai/mumbai-news/article/irctc-cracks-down-on-ticketing-fraud-303-cr-fake-ids-blocked-23617705

**Design impact:** fill pacing floor = 4.2s for 5 passengers (G2). Use a
safety margin well above it. One booking per session. Never exceed 5
logins/30min. Keep the user's own device/IP region consistent (on-device
WebView satisfies this).

## 4. Tatkalforsure — Karnataka High Court ruling (6 Sept 2024)

- Developer: Gaurav Dhake (IIT graduate, BuyHatke founder). Tool:
  **Tatkalforsure**, a browser extension that **auto-filled traveller
  details** on the IRCTC website, cutting booking time from ~7 minutes to
  ~40–45 seconds. Free initially; from Feb 2020 capped at 10 bookings/day
  (anti-agent) and charged ₹30/booking.
- Charged under **Section 143 of the Railways Act, 1989** (unauthorised
  procuring/supplying of tickets). Justice M. Nagaprasanna **quashed** the
  proceedings: *"The petitioner has neither procured nor supplied tickets.
  All that the petitioner has done was creation of an extension to the IRCTC
  website... Unless the ingredients of Section 143 are met, the crime itself
  could not have been registered."* Referenced a similar 2016 Kerala HC
  judgment.
- **Limits of the ruling (do not over-read it):**
  - It kills **criminal liability under S.143** for pure auto-fill tools. It
    does **not** bind IRCTC's own terms-of-service enforcement — IRCTC can
    still deactivate/suspend accounts for automation-like behaviour under
    its anti-bot rules (see §3; 3.04cr + 6.33cr IDs hit in Sept 2026).
  - The tool in question filled the form; the **user still completed the
    booking**. A fully autonomous auto-submit/auto-pay bot was not what the
    court examined.
  - The ruling is from a single-judge bench of one High Court — persuasive,
    not Supreme Court-settled law.
- Sources:
  - https://www.livelaw.in/amp/high-court/karnataka-high-court/karnataka-high-court-quashes-railways-act-case-against-iit-graduate-developing-fast-tatkal-ticket-booking-software-case-268801
  - https://theprint.in/india/karnataka-hc-quashes-criminal-case-against-startup-founder-over-tatkal-ticket-booking-tool/2256314/
  - https://www.verdictum.in/court-updates/high-courts/karnataka-high-court-gaurav-dahake-v-union-of-india-proceedings-section143-railways-act-software-developer-tatkalforsure-1550554

**Design impact:** our hard lines (user-tap final submit, no auto-book, no
credential exfiltration) sit squarely inside the protected lane. The G5
no-auto-book invariant is the legal load-bearing wall — keep it.

## 5. Technical implementation notes

- **Android SMS User Consent API** (Google Play Services, `SmsRetriever`):
  needs **no** `READ_SMS`/`RECEIVE_SMS` permission, is Play-policy clean, and
  shows a **system one-tap consent dialog** per incoming OTP SMS — the app
  then gets the full message body to extract the code. Works with **any SMS
  sender format** (unlike SMS Retriever API, which needs our app-hash in the
  message — impossible for IRCTC/UIDAI-sent OTPs). Requires Google Play
  services; consent window ~5 minutes, re-armable. RN library:
  `@pushpendersingh/react-native-otp-verify` exposes both methods with TS
  support and Expo prebuild support.
  - https://developers.google.com/android/reference/com/google/android/gms/auth/api/phone/package-summary
  - https://github.com/pushpender-singh-ap/react-native-otp-verify
- **WebView on irctc.co.in:** the app loads IRCTC as a **top-level document
  in a native WebView** (react-native-webview), not inside an `<iframe>`.
  `X-Frame-Options` / CSP `frame-ancestors` only restrict *framing*, so they
  do not apply to a top-level WebView load — this is standard web-platform
  behaviour, and our architecture doesn't depend on embedding.
- **UNVERIFIED — IRCTC's exact framing headers:** could not confirm whether
  irctc.co.in sends `X-Frame-Options`/`frame-ancestors`. Not load-bearing for
  the current design (see above), but confirm during device testing if the
  design ever changes to embedded frames.
- **CONFIRMED 2026-09-26 (device field report) — WebView fingerprint blocking:**
  IRCTC's Akamai bot protection serves HTTP 403 "Access Denied"
  (ref 18.c60e0317.1790397001.2e4c6986) to the embedded WebView EVEN WITH a
  stock mobile-Chrome UA string set. The WebView is fingerprinted beyond its
  UA, so UA changes are not a fix and must not be used as evasion. Sanctioned
  response: detect the denial (HTTP 403 / "Access Denied" title) and offer a
  genuine Chrome tab (expo-web-browser Custom Tabs — real browser identity,
  shared login) as the fallback. No automation may attempt to bypass the
  block.
- **UNVERIFIED — exact OTP screen position in the booking flow:** sources
  confirm the per-booking Aadhaar OTP is mandatory, but the precise screen
  order inside IRCTC's current SPA (before vs after payment selection) was
  not pinned down from public docs. The state machine must be validated
  against the live flow — **device-test item**.

## 6. Recorded conflicts / corrections vs PLAN.md assumptions

1. **Passenger count:** PLAN gates G1/G2 assume a **5-passenger** form, and
   the 4.2s anti-bot figure is calibrated for five passengers. Multiple
   2026 sources state the **Tatkal PNR cap is 4 passengers per PNR**
   (https://www.kadvacorp.com/ai/can-ai-book-irctc-tatkal-tickets/,
   https://kanojiaadvocate.in/tatkal-ticket-booking-rules-2026/). Keep the
   4.2s/5-pax floor as the *pacing* reference (it's what IRCTC published),
   but the harness should also cover the realistic 4-pax Tatkal case and the
   pacing constant should scale per-passenger. Recommend: pacing floor =
   max(4.2s, 0.84s × pax).
2. **Tout-arrest figures:** 13,580 (3.5 yrs, minister's Lok Sabha reply,
   older) vs **22,676 since 2021** (TOI, mid-2026, newer). Use the newer
   figure with citation.

## 7. Watch list (re-check before release)

- Tatkal open times / days-before rule (IRCTC denied 2025 change rumours;
  check again).
- Aadhaar OTP mandate scope (per-booking confirmed 2026-09-26).
- Anti-bot thresholds (4.2s figure is from Feb-2026 reporting of the AI
  rollout; IRCTC may tighten silently).
- Any new IRCTC terms-of-service clause explicitly naming auto-fill
  assistants.
