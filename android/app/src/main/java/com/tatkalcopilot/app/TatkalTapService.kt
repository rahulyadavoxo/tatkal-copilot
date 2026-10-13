package com.tatkalcopilot.app

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.GestureDescription
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.SharedPreferences
import android.graphics.Path
import android.graphics.Rect
import android.os.Build
import android.os.Bundle
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo
import android.view.accessibility.AccessibilityWindowInfo
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import org.json.JSONArray
import org.json.JSONObject
import java.util.Collections
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Books IRCTC in real Chrome exactly like the in-app WebView flow, up to and
 * including the single "Pay & Book" tap, then stops for good.
 *
 * The choreography (pages, steps, choices) comes from the app's JS layer via
 * encrypted prefs (DEFAULT_CHOREO_MAP + buildFillData in
 * src/native/autofillData.ts); this engine only knows HOW to do each step
 * type, never WHAT to pick.
 *
 * Safety architecture:
 * - EXPLICIT PAYMENT STOP: on every pass the gateway check runs before
 *   anything else. A non-IRCTC host in Chrome's address bar, or gateway-only
 *   page text, locks the run down for the session (no fills, no taps, no
 *   reads). The one step marked `final` ("Pay & Book") locks it down the
 *   moment it fires. A lockdown also switches automation OFF; only a new
 *   tile tap (a newer run_requested_ts) clears it.
 * - ALLOWLIST: only the (page -> step) pairs in the map ever act.
 * - CAPTCHA and OTP are never solved: the engine focuses the captcha box and
 *   waits; on an OTP screen it pauses until the screen is gone.
 * - "Please Wait..." loaders pause the run without counting as stuck steps.
 * - Taps that IRCTC punishes when doubled (Continue, Pay & Book) fire once.
 */
class TatkalTapService : AccessibilityService() {

    companion object {
        const val PREFS_PROBE = "tatkal_probe"
        const val PREFS_SECURE = "tatkal_autofill"
        const val KEY_CLICKABLE_DUMP = "tap_clickable_dump"
        const val KEY_TAP_TARGET = "probe_tap_target"
        const val KEY_TAP_RESULT = "probe_tap_result"
        const val KEY_ENGINE_STATUS = "tap_engine_status"
        const val KEY_CHOREO_MAP = "choreo_map"
        const val PREFS_AUTOMATION = "tatkal_automation"
        const val KEY_AUTOMATION_ENABLED = "automation_enabled"
        const val KEY_SESSION_ACTIVE = "session_active"
        const val KEY_SESSION_TS = "session_ts"
        const val KEY_RUN_REQUESTED_TS = "run_requested_ts"
        const val ACTION_STOP_AUTOMATION = "com.tatkalcopilot.app.STOP_AUTOMATION"
        const val NOTIF_ID = 4242
        const val NOTIF_DONE_ID = 4243
        const val KEY_FILL_DATA = "fill_data"
        const val CHROME_PKG = "com.android.chrome"

        private val STAGE_NAMES_DEFAULT = listOf(
            "Login", "Search", "Train", "Passengers", "Review", "Payment", "Done"
        )
        private val MONTHS = listOf(
            "january", "february", "march", "april", "may", "june", "july",
            "august", "september", "october", "november", "december"
        )

        private val BROWSER_PACKAGES = setOf(
            "com.android.chrome", "com.chrome.beta", "com.chrome.dev", "com.chrome.canary",
            "org.mozilla.firefox", "org.mozilla.firefox_beta", "org.mozilla.fenix",
            "com.brave.browser", "com.mi.globalbrowser", "com.sec.android.app.sbrowser",
            "com.opera.browser", "com.opera.mini.native", "com.ucmobile.intl",
            "com.microsoft.emmx", "com.duckduckgo.mobile.android", "com.vivaldi.browser",
            "app.vanadium", "com.realme.browser", "com.coloros.browser"
        )
    }

    /** Result of one step attempt. */
    private enum class Res { DONE, ACTED_DONE, ACTED, WAIT, MISSING }

    /** One node of a tree snapshot (preorder), with its parent's index. */
    private class S(
        val node: AccessibilityNodeInfo,
        val parent: Int,
        val text: String,     // trimmed raw text (or content description)
        val lower: String,    // lowercase, whitespace-collapsed
        val hint: String,     // lowercase hint text
        val bounds: Rect
    ) {
        val editable: Boolean get() = node.isEditable
        val clickable: Boolean get() = node.isClickable
    }

    private class TapRec(var count: Int, var lastTs: Long)

    @Volatile private var paymentLockdown = false
    @Volatile private var choreographyRunning = false
    private val donePages = Collections.synchronizedSet(mutableSetOf<String>())
    private val doneSteps = Collections.synchronizedSet(mutableSetOf<String>())
    private val skippedSteps = Collections.synchronizedSet(mutableSetOf<String>())
    private val stepAttempts = Collections.synchronizedMap(mutableMapOf<String, Int>())
    private val suggestionPicked = Collections.synchronizedMap(mutableMapOf<String, Long>())
    private val passwordFilled = Collections.synchronizedSet(mutableSetOf<String>())
    private val taps = Collections.synchronizedMap(mutableMapOf<String, TapRec>())
    private val stepFlags = Collections.synchronizedMap(mutableMapOf<String, Int>())
    private val openedControls = Collections.synchronizedMap(mutableMapOf<String, List<Rect>>())
    private val pageFirstActionTs = Collections.synchronizedMap(mutableMapOf<String, Long>())
    private var lastActionTs = 0L
    private var lastLoaderTs = 0L
    private var captchaText = ""
    private var captchaSince = 0L
    private var lastEngineStatus = "idle"
    private var lastSeenRunTs = 0L
    @Volatile private var notifShowing = false

    // Per-pass context (only touched by the choreography thread).
    private var snap: List<S> = emptyList()
    private var screenText = ""
    private var webTop = 0
    private var imeRect: Rect? = null
    private var stageNames: List<String> = STAGE_NAMES_DEFAULT

    // ------------------------------------------------------------------
    // Status + notification
    // ------------------------------------------------------------------

    private fun engineStatus(s: String) {
        if (s == lastEngineStatus) return
        lastEngineStatus = s
        try {
            probePrefs().edit().putString(KEY_ENGINE_STATUS, s).apply()
        } catch (_: Exception) { }
        if (notifShowing) showStopNotification()
    }

    private fun stageStatus(stage: Int, say: String, suffix: String = ""): String {
        val total = stageNames.size
        val st = stage.coerceIn(1, total)
        val name = stageNames.getOrElse(st - 1) { "" }
        return "Step $st/$total $name: $say$suffix"
    }

    private fun clearRunMemory() {
        paymentLockdown = false
        donePages.clear()
        doneSteps.clear()
        skippedSteps.clear()
        stepAttempts.clear()
        suggestionPicked.clear()
        passwordFilled.clear()
        taps.clear()
        stepFlags.clear()
        openedControls.clear()
        pageFirstActionTs.clear()
        lastActionTs = 0L
        lastLoaderTs = 0L
        captchaText = ""
        captchaSince = 0L
        try {
            (getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager).cancel(NOTIF_DONE_ID)
        } catch (_: Exception) { }
    }

    private fun securePrefs(): SharedPreferences {
        val masterKey = MasterKey.Builder(this)
            .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
            .build()
        return EncryptedSharedPreferences.create(
            this,
            PREFS_SECURE,
            masterKey,
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
        )
    }

    private fun probePrefs(): SharedPreferences =
        getSharedPreferences(PREFS_PROBE, MODE_PRIVATE)

    private fun automationPrefs(): SharedPreferences =
        getSharedPreferences(PREFS_AUTOMATION, MODE_PRIVATE)

    private fun isAutomationEnabled(): Boolean = try {
        automationPrefs().getBoolean(KEY_AUTOMATION_ENABLED, false)
    } catch (_: Exception) { false }

    private fun setAutomationEnabled(on: Boolean) {
        try {
            automationPrefs().edit().putBoolean(KEY_AUTOMATION_ENABLED, on).apply()
        } catch (_: Exception) { }
    }

    private fun requestedRunTs(): Long = try {
        automationPrefs().getLong(KEY_RUN_REQUESTED_TS, 0L)
    } catch (_: Exception) { 0L }

    private fun ensureChannel(nm: NotificationManager): String {
        val channelId = "tatkal_automation"
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val ch = NotificationChannel(channelId, "Booking automation", NotificationManager.IMPORTANCE_HIGH)
            ch.description = "Stop the auto-booking at any time"
            nm.createNotificationChannel(ch)
        }
        return channelId
    }

    private fun builder(channelId: String): Notification.Builder =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            Notification.Builder(this, channelId)
        } else {
            @Suppress("DEPRECATION")
            Notification.Builder(this).setPriority(Notification.PRIORITY_HIGH)
        }

    /** Persistent notification with a STOP action and the live booking step. */
    private fun showStopNotification() {
        try {
            val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            val channelId = ensureChannel(nm)
            val stopIntent = Intent(ACTION_STOP_AUTOMATION).apply { setPackage(packageName) }
            var flags = PendingIntent.FLAG_UPDATE_CURRENT
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) flags = flags or PendingIntent.FLAG_IMMUTABLE
            val pi = PendingIntent.getBroadcast(this, 0, stopIntent, flags)
            val notif = builder(channelId)
                .setContentTitle("Tatkal Copilot: auto-booking ON")
                .setContentText(lastEngineStatus)
                .setStyle(Notification.BigTextStyle().bigText("$lastEngineStatus\nTap STOP to halt immediately."))
                .setOnlyAlertOnce(true)
                .setSmallIcon(android.R.drawable.ic_dialog_alert)
                .addAction(android.R.drawable.ic_menu_close_clear_cancel, "STOP", pi)
                .setOngoing(true)
                .build()
            nm.notify(NOTIF_ID, notif)
            notifShowing = true
        } catch (_: Exception) { }
    }

    private fun hideStopNotification() {
        try {
            val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            nm.cancel(NOTIF_ID)
            notifShowing = false
        } catch (_: Exception) { }
    }

    private fun showDoneNotification(text: String) {
        try {
            val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            val channelId = ensureChannel(nm)
            val notif = builder(channelId)
                .setContentTitle("Tatkal Copilot: pay by hand now")
                .setContentText(text)
                .setStyle(Notification.BigTextStyle().bigText(text))
                .setSmallIcon(android.R.drawable.ic_dialog_info)
                .setAutoCancel(true)
                .build()
            nm.notify(NOTIF_DONE_ID, notif)
        } catch (_: Exception) { }
    }

    /**
     * EXPLICIT STOP. Locks the session: automation OFF, no further fills,
     * taps or reads until a new tile tap starts a fresh run.
     */
    private fun lockDownForPayment(reason: String) {
        paymentLockdown = true
        setAutomationEnabled(false)
        val total = stageNames.size
        val msg = "Step $total/$total ${stageNames.getOrElse(total - 1) { "Done" }}: $reason"
        engineStatus(msg)
        showDoneNotification("$reason The app won't touch the payment page.")
    }

    // ------------------------------------------------------------------
    // Accessibility entry point
    // ------------------------------------------------------------------

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {
        if (event == null) return
        val pkg = event.packageName?.toString() ?: return
        // The notification shade / Quick Settings is not "leaving the browser".
        if (pkg == "com.android.systemui") return
        // Leaving the browser (a UPI app, SMS for the OTP, the keyboard)
        // never resets the run: memory clears only on a new tile tap, so a
        // finished Pay & Book can never be tapped again.
        if (!BROWSER_PACKAGES.contains(pkg)) return
        try {
            if (paymentLockdown && requestedRunTs() <= lastSeenRunTs) return
            val root = rootInActiveWindow ?: return

            try {
                val dump = dumpClickables(root)
                probePrefs().edit().putString(KEY_CLICKABLE_DUMP, dump.toString()).apply()
            } catch (_: Exception) { }

            val prefs = probePrefs()
            val target = prefs.getString(KEY_TAP_TARGET, null)
            if (!target.isNullOrEmpty()) {
                val tapped = tapNodeWithText(root, target)
                prefs.edit()
                    .putString(KEY_TAP_RESULT, if (tapped) "tapped:$target" else "not_found:$target")
                    .remove(KEY_TAP_TARGET)
                    .apply()
                return
            }

            if (!isAutomationEnabled()) {
                hideStopNotification()
                engineStatus("automation is OFF")
                return
            }
            synchronized(this) {
                if (!choreographyRunning) {
                    choreographyRunning = true
                    showStopNotification()
                    Thread {
                        try {
                            runChoreographyFast()
                        } catch (e: Throwable) {
                            // Never fail silently: the Automation probe screen shows this.
                            val at = e.stackTrace.firstOrNull { it.className.contains("tatkal") }
                            engineStatus("CRASH ${e.javaClass.simpleName}: ${(e.message ?: "").take(90)} @${at?.methodName}:${at?.lineNumber}")
                        } finally {
                            hideStopNotification()
                            synchronized(this) { choreographyRunning = false }
                        }
                    }.start()
                }
            }
        } catch (_: Exception) {
            // The service must never crash.
        }
    }

    override fun onInterrupt() { }

    // ------------------------------------------------------------------
    // Choreography loop
    // ------------------------------------------------------------------

    private fun runChoreographyFast() {
        val requested = requestedRunTs()
        if (requested > lastSeenRunTs) {
            lastSeenRunTs = requested
            clearRunMemory()
        }
        if (paymentLockdown) return

        val prefs = try { securePrefs() } catch (_: Exception) {
            engineStatus("secure prefs unavailable")
            return
        }
        val mapJson = prefs.getString(KEY_CHOREO_MAP, null) ?: run {
            engineStatus("no choreography map — open the app once to sync")
            return
        }
        val map: JSONObject
        val fillData: JSONObject
        try {
            map = JSONObject(mapJson)
            fillData = JSONObject(prefs.getString(KEY_FILL_DATA, null) ?: "{}")
        } catch (_: Exception) {
            engineStatus("choreography map unreadable")
            return
        }
        stageNames = jsonStrList(map.optJSONArray("stages")).ifEmpty { STAGE_NAMES_DEFAULT }
        val idleTimeout = map.optLong("runIdleTimeoutMs", 600_000L)
        val maxRun = map.optLong("runMaxMs", 3_600_000L)
        val loader = map.optJSONObject("loader")
        val loaderTexts = jsonStrList(loader?.optJSONArray("anyContains")).map { it.lowercase() }
        val loaderSlowMs = loader?.optLong("slowAfterMs", 90_000L) ?: 90_000L
        val otpTexts = jsonStrList(map.optJSONObject("otp")?.optJSONArray("anyContains")).map { it.lowercase() }
        val gateway = map.optJSONObject("gateway")
        val pages = map.optJSONArray("pages")

        engineStatus("started — reading page")
        setSessionActive(true)
        val runStart = System.currentTimeMillis()
        var lastProgress = runStart
        var loaderSince = 0L
        var lastBeat = 0L
        try {
            while (true) {
                val now = System.currentTimeMillis()
                if (now - lastBeat > 3_000L) { setSessionActive(true); lastBeat = now }
                if (now - runStart > maxRun || now - lastProgress > idleTimeout) {
                    engineStatus("$lastEngineStatus — stopped waiting (no progress)")
                    return
                }
                if (!isAutomationEnabled()) {
                    engineStatus("automation stopped")
                    return
                }
                if (paymentLockdown) return

                val root = try { rootInActiveWindow } catch (_: Exception) { null }
                if (root == null) { Thread.sleep(250); continue }
                val pkg = try { root.packageName?.toString() } catch (_: Exception) { null }
                if (pkg == "com.android.systemui") { Thread.sleep(250); continue }
                if (pkg == null || !BROWSER_PACKAGES.contains(pkg)) return // resumes on return

                snap = snapshotWindows(root)
                screenText = buildScreenText()
                webTop = webContentTop()
                imeRect = findImeRect()

                // 1. EXPLICIT PAYMENT STOP — always first.
                val gw = gatewayReason(root, gateway)
                if (gw != null) {
                    lockDownForPayment(gw)
                    return
                }
                // Not on IRCTC yet (Chrome still showing the previous tab while
                // the tile's IRCTC link loads): act on nothing, just wait.
                if (offIrctcHost(root, gateway)) {
                    engineStatus("started — waiting for IRCTC to open in Chrome")
                    Thread.sleep(500)
                    continue
                }

                // 2. "Please Wait..." loader: do nothing, never count as stuck.
                if (loaderTexts.any { loaderVisible(it) }) {
                    if (loaderSince == 0L) loaderSince = now
                    lastLoaderTs = now
                    lastProgress = now
                    val slow = now - loaderSince > loaderSlowMs
                    engineStatus(
                        if (slow) "IRCTC is slow, still waiting… (${lastEngineStatus.substringBefore(" —")})"
                        else "${lastEngineStatus.substringBefore(" —")} — IRCTC is loading"
                    )
                    Thread.sleep(200)
                    continue
                }
                loaderSince = 0L

                // 3. OTP: the user's job. Pause until the OTP screen is gone.
                if (otpTexts.any { screenText.contains(it) } && snap.any { it.editable }) {
                    lastProgress = now
                    engineStatus("Waiting for you: enter the OTP IRCTC sent")
                    Thread.sleep(700)
                    continue
                }

                // 4. Current page -> its next pending step.
                var pageFound = false
                var acted = false
                var waiting = false
                if (pages != null) {
                    for (i in 0 until pages.length()) {
                        val page = pages.optJSONObject(i) ?: continue
                        val pageId = page.optString("id")
                        if (pageId.isEmpty() || donePages.contains(pageId)) continue
                        if (!detectMatches(page.optJSONObject("detect"))) continue
                        pageFound = true
                        if (page.optInt("stage", 1) >= 5) stepFlags["payment:reached"] = 1
                        if (pageId == "login") stepFlags["login:seen"] = 1
                        val outcome = runPage(page, pageId, fillData)
                        acted = outcome == Res.ACTED || outcome == Res.ACTED_DONE
                        waiting = outcome == Res.WAIT
                        break
                    }
                }
                if (acted || waiting) lastProgress = System.currentTimeMillis()
                if (!pageFound) {
                    engineStatus("${lastEngineStatus.substringBefore(" —")} — waiting for the next IRCTC page")
                    Thread.sleep(250)
                } else if (!acted) {
                    Thread.sleep(120)
                }
            }
        } finally {
            setSessionActive(false)
            snap = emptyList()
        }
    }

    /** Runs the first pending step of [page]. Returns what happened. */
    private fun runPage(page: JSONObject, pageId: String, data: JSONObject): Res {
        val steps = page.optJSONArray("steps") ?: return Res.DONE
        val pageStage = page.optInt("stage", 1)
        val floorMs = data.optString(page.optString("paceFloorKey"), "").toLongOrNull() ?: 0L
        val minGap = data.optString("pace.minGapMs", "120").toLongOrNull() ?: 120L
        val gap = if (floorMs > 0) maxOf(minGap, floorMs / maxOf(1, steps.length())) else 0L

        for (s in 0 until steps.length()) {
            val step = steps.optJSONObject(s) ?: continue
            val key = "$pageId:$s"
            if (doneSteps.contains(key) || skippedSteps.contains(key)) continue
            val stage = step.optInt("stage", pageStage)
            val say = step.optString("say", step.optString("do"))

            val onlyIf = step.optString("onlyIf")
            if (onlyIf.isNotEmpty()) {
                val v = data.optString(onlyIf, "")
                if (v.isEmpty() || v == "false") { doneSteps.add(key); continue }
            }

            // fillEngine pacing: keep a minimum gap between actions on this page.
            if (gap > 0 && lastActionTs > 0) {
                val wait = gap - (System.currentTimeMillis() - lastActionTs)
                if (wait > 0) try { Thread.sleep(minOf(wait, 2_000L)) } catch (_: Exception) { }
            }
            if (step.optBoolean("minPageElapsed", false) && floorMs > 0) {
                val first = pageFirstActionTs[pageId] ?: 0L
                if (first > 0 && System.currentTimeMillis() - first < floorMs) {
                    engineStatus(stageStatus(stage, say, " — pacing"))
                    return Res.WAIT
                }
            }

            val r: Res = try { execute(key, step, data, stage, say) } catch (_: Exception) { Res.MISSING }
            when (r) {
                Res.DONE -> { doneSteps.add(key); stepAttempts.remove(key); continue }
                Res.ACTED_DONE, Res.ACTED -> {
                    if (r == Res.ACTED_DONE) doneSteps.add(key)
                    stepAttempts.remove(key)
                    lastActionTs = System.currentTimeMillis()
                    if (!pageFirstActionTs.containsKey(pageId)) pageFirstActionTs[pageId] = lastActionTs
                    if (step.optBoolean("final", false)) {
                        lockDownForPayment("Pay & Book tapped — you're at the payment gateway. Pay by hand.")
                        return r
                    }
                    engineStatus(stageStatus(stage, say))
                    val settle = step.optLong("settleMs", 200L).coerceIn(120L, 600L)
                    try { Thread.sleep(settle) } catch (_: Exception) { }
                    return r
                }
                Res.WAIT -> return r
                Res.MISSING -> {
                    val n = (stepAttempts[key] ?: 0) + 1
                    stepAttempts[key] = n
                    if (step.optBoolean("optional", false) && n >= step.optInt("optionalTries", 8)) {
                        skippedSteps.add(key)
                        engineStatus(stageStatus(stage, say, " — not on this page, skipped"))
                        continue
                    }
                    engineStatus(stageStatus(stage, say, " — looking (try $n)"))
                    return r
                }
            }
        }
        donePages.add(pageId)
        return Res.DONE
    }

    private fun execute(key: String, step: JSONObject, data: JSONObject, stage: Int, say: String): Res {
        return when (step.optString("do")) {
            "tap" -> stepTap(key, step, data, stage, say)
            "tapLogin" -> stepTapLogin(key)
            "fillField" -> stepFillField(key, step, data)
            "typeAndPickSuggestion" -> stepTypeAndPick(key, step, data)
            "setDate" -> stepSetDate(key, step, data)
            "selectDropdownOption" -> stepDropdown(key, step, data)
            "selectRadio" -> stepRadio(key, step, data)
            "checkbox" -> stepCheckbox(key, step)
            "tapInCard" -> stepTapInCard(key, step, data, stage, say)
            "waitForPage" -> if (detectMatches(step.optJSONObject("detect"))) Res.DONE else {
                engineStatus(stageStatus(stage, say)); Res.WAIT
            }
            "confirmPopup" -> stepConfirmPopup(key, step, stage, say)
            "focusCaptcha" -> stepFocusCaptcha(key)
            "submitLogin" -> stepSubmitLogin(key, step, stage, say)
            "waitTatkal" -> stepWaitTatkal(step, data, stage, say)
            "addPassengerRow" -> stepAddPassenger(key, step)
            "waitUserCaptcha" -> stepWaitUserCaptcha(key, stage, say)
            "selectOption" -> stepSelectOption(key, step, data)
            else -> Res.DONE
        }
    }

    // ------------------------------------------------------------------
    // Step types
    // ------------------------------------------------------------------

    /**
     * Generic tap. One-shot unless `doneWhen` is given: then the step is
     * done only once the page shows the result, re-tapping at most
     * `maxTaps` times, `retryAfterMs` apart (loader time never counts).
     */
    private fun stepTap(key: String, step: JSONObject, data: JSONObject, stage: Int, say: String): Res {
        val gate = step.optString("gateKey")
        if (gate.isNotEmpty() && !tatkalOpen(data.optString(gate, ""), stage, say)) return Res.WAIT
        val labels = mutableListOf<String>()
        val fromData = resolveValue(step.optString("textKey"), data)
        if (fromData.isNotEmpty()) labels.add(fromData)
        val text = step.optString("text")
        if (text.isNotEmpty() && fromData.isEmpty()) labels.add(text)
        labels.addAll(jsonStrList(step.optJSONArray("textAny")))
        if (labels.isEmpty()) return Res.DONE

        if (step.optBoolean("repeatWhilePage", false)) {
            // Language alert: the page header has its own "English" toggle, so
            // take matches nearest the alert's sentence, and rotate to the next
            // match on each retry if the alert is still up.
            val wants = labels.map { it.trim().lowercase() }
            val anchor = snap.firstOrNull { it.lower.contains("preferred language") }
            val cands = snap.filter { c -> !c.editable && wants.any { c.lower == it } && c.bounds.width() > 0 }
                .sortedBy { c -> if (anchor == null) 0 else Math.abs(c.bounds.centerY() - anchor.bounds.centerY()) }
            val rec = taps.getOrPut(key) { TapRec(0, 0L) }
            if (cands.isEmpty() && anchor != null) {
                // Device 2026-10-13: Chrome shows IRCTC's alert as ONE Button
                // ("Confirmation. ... Please select your preferred language ...
                // press the Enter key") with no English/Hindi buttons. Rotate:
                // tap where the language button is drawn, then click it, then ×.
                val dlg = snap.firstOrNull { it.lower.contains("preferred language") && (it.clickable || it.node.className?.toString() == "android.widget.Button") } ?: anchor
                val x = snap.firstOrNull { it.lower == "×" || it.lower == "✕" || it.lower == "close" }
                // Device screenshot: [हिंदी] [English] sit side by side at the
                // dialog's bottom, ~6% of its height above the edge; English
                // centre at ~58% of the width, हिंदी at ~38% (the middle is a gap).
                val attempt = rec.count % 4
                rec.count += 1; rec.lastTs = System.currentTimeMillis()
                val b = dlg.bounds
                val hindi = wants.any { it == "हिंदी" }
                val fx = b.left + b.width() * (if (hindi) 0.38f else 0.585f)
                val dy = (b.height() * 0.062f).coerceIn(45f, 120f)
                // Screen fallback from the device screenshot (909x2000): English
                // at (533,1647) = 58.6% x, 82.4% y; हिंदी at (357,1647).
                val dm = android.util.DisplayMetrics()
                try {
                    @Suppress("DEPRECATION")
                    (getSystemService(WINDOW_SERVICE) as android.view.WindowManager).defaultDisplay.getRealMetrics(dm)
                } catch (_: Exception) { dm.setTo(resources.displayMetrics) }
                val sx = dm.widthPixels * (if (hindi) 0.393f else 0.586f)
                val sy = dm.heightPixels * 0.8235f
                val boundsOk = b.height() > 300 && b.width() > dm.widthPixels * 0.6f
                // Device-independent first: look at the screen and tap the
                // orange button itself (pair side by side: left हिंदी, right English).
                val seen = findLanguageButtons()
                if (seen != null) {
                    val r = if (hindi) seen.first else seen.second
                    val ok2 = gestureTap(r.exactCenterX(), r.exactCenterY())
                    engineStatus(stageStatus(stage, say, " — saw buttons on screen, tapped ${if (hindi) "हिंदी" else "English"} at ${r.centerX()},${r.centerY()} ${if (ok2) "sent" else "failed"}"))
                    sleep(800)
                    if (ok2) return Res.ACTED
                }
                val ok = when (attempt) {
                    0 -> if (boundsOk) gestureTap(fx, b.bottom - dy) else gestureTap(sx, sy)
                    1 -> gestureTap(sx, sy)
                    2 -> if (boundsOk) gestureTap(fx, b.bottom - dy - 35f) else gestureTap(sx, sy - 30f)
                    else -> clickNodeOrAncestor(dlg.node) || (x != null && tapNode(x))
                }
                engineStatus(stageStatus(stage, say, " — attempt ${attempt + 1}/4 ${if (ok) "sent" else "failed"} box=${b.left},${b.top},${b.right},${b.bottom} scr=${dm.widthPixels}x${dm.heightPixels}"))
                sleep(800)
                return if (ok) Res.ACTED else Res.MISSING
            }
            val n = if (cands.isNotEmpty()) cands[rec.count % cands.size] else findTapTarget(labels, step)
            if (n == null) {
                engineStatus(stageStatus(stage, say, " — '${wants.firstOrNull()}' not found (${snap.size} nodes)"))
                return Res.MISSING
            }
            rec.count += 1; rec.lastTs = System.currentTimeMillis()
            val ok = tapNode(n)
            engineStatus(stageStatus(stage, say, " — tap ${rec.count} on '${n.lower.take(20)}' (${cands.size} matches) ${if (ok) "sent" else "FAILED"}"))
            return if (ok) { sleep(800); Res.ACTED } else Res.MISSING
        }

        val doneWhen = step.optJSONObject("doneWhen")
        val rec = taps[key]
        if (doneWhen != null && rec != null && rec.count > 0 && detectMatches(doneWhen)) return Res.DONE
        val maxTaps = step.optInt("maxTaps", 1)
        if (rec != null && rec.count >= maxTaps) {
            if (doneWhen == null) return Res.DONE
            engineStatus(stageStatus(stage, say, " — waiting for IRCTC"))
            return Res.WAIT
        }
        if (rec != null && rec.count > 0) {
            val retry = step.optLong("retryAfterMs", 0L)
            val now = System.currentTimeMillis()
            if (retry <= 0 || now - rec.lastTs < retry || now - lastLoaderTs < retry) {
                engineStatus(stageStatus(stage, say, " — waiting for IRCTC"))
                return Res.WAIT
            }
        }
        val n = findTapTarget(labels, step) ?: return Res.MISSING
        if (!tapNode(n)) return Res.MISSING
        val r2 = taps.getOrPut(key) { TapRec(0, 0L) }
        r2.count += 1
        r2.lastTs = System.currentTimeMillis()
        return if (doneWhen == null) Res.ACTED_DONE else Res.ACTED
    }

    /** Finds the node to tap for [labels]: exact text first, then a short containing label; `fuzzy` = all words, last match. */
    private fun findTapTarget(labels: List<String>, step: JSONObject): S? {
        val exactOnly = step.optBoolean("exactOnly", false)
        if (step.optBoolean("fuzzy", false)) {
            for (l in labels) {
                val words = l.lowercase().split(Regex("[^a-z0-9]+")).filter { it.isNotEmpty() }
                val hit = snap.lastOrNull { s ->
                    !s.editable && s.lower.isNotEmpty() && s.lower.length <= 40 &&
                        words.all { s.lower.contains(it) } && isActionable(s)
                }
                if (hit != null) return hit
            }
            return null
        }
        for (l in labels) {
            val want = l.trim().lowercase()
            snap.firstOrNull { it.lower == want && !it.editable }?.let { return it }
        }
        if (exactOnly) return null
        for (l in labels) {
            val want = l.trim().lowercase()
            val slack = step.optInt("slack", 12)
            snap.firstOrNull { !it.editable && it.lower.contains(want) && it.lower.length <= want.length + slack }
                ?.let { return it }
        }
        return null
    }

    private fun isActionable(s: S): Boolean {
        var i = indexOf(s)
        var d = 0
        while (i >= 0 && d < 4) {
            if (snap[i].clickable) return true
            i = snap[i].parent
            d++
        }
        return true // Chrome often hides clickability; a gesture tap still works.
    }

    /** prebookEngine stepOpenLogin. Skips when logged in or the form is open. */
    private fun stepTapLogin(key: String): Res {
        if (screenText.contains("logout") || screenText.contains("log out") || screenText.contains("sign out")) return Res.DONE
        if (stepFlags["login:seen"] == 1) return Res.DONE // the user logged in during this run
        if (snap.any { it.node.isPassword }) return Res.DONE
        val rec = taps[key]
        if (rec != null && rec.count >= 1) return Res.DONE
        val target = snap.firstOrNull { it.lower == "login" || it.lower == "sign in" || it.lower.startsWith("login /") }
            ?: snap.firstOrNull {
                val d = (it.node.contentDescription?.toString() ?: "").lowercase()
                d.isNotEmpty() && Regex("log\\s?in|sign\\s?in|user|person|account|profile").containsMatchIn(d)
            }
            ?: topRightClickable()
            ?: return Res.DONE
        if (!tapNode(target)) return Res.MISSING
        taps[key] = TapRec(1, System.currentTimeMillis())
        sleep(1200)
        return Res.ACTED_DONE
    }

    private fun topRightClickable(): S? {
        val w = resources.displayMetrics.widthPixels
        return snap.filter {
            it.clickable && !it.editable && it.bounds.width() > 0 &&
                it.bounds.top >= webTop && it.bounds.top < webTop + 220 && it.bounds.right > w - 220
        }.maxByOrNull { it.bounds.right }
    }

    private fun stepFillField(key: String, step: JSONObject, data: JSONObject): Res {
        val value = resolveValue(step.optString("valueKey"), data)
        if (value.isEmpty()) {
            if (step.optString("valueKey").startsWith("irctc.")) engineStatus("Login: no saved IRCTC ${if (step.optBoolean("passwordField")) "password" else "user name"} in the app — fill it by hand")
            return Res.DONE
        }
        val field = findField(step) ?: return Res.MISSING
        if (field.node.isPassword) {
            if (passwordFilled.contains(key)) return Res.DONE
            field.node.performAction(AccessibilityNodeInfo.ACTION_FOCUS)
            if (setText(field, value)) { passwordFilled.add(key); return Res.ACTED_DONE }
            return Res.MISSING
        }
        val current = fieldValue(field)
        if (step.optBoolean("keepExisting", false) && current.isNotEmpty()) return Res.DONE
        if (current.contains(value)) return Res.DONE
        val n = (stepFlags[key] ?: 0) + 1
        stepFlags[key] = n
        if (n > 4) return Res.MISSING
        field.node.performAction(AccessibilityNodeInfo.ACTION_FOCUS)
        setText(field, value)
        return Res.ACTED
    }

    /** prebookEngine setAutocomplete: type the code, tap the suggestion carrying it. */
    private fun stepTypeAndPick(key: String, step: JSONObject, data: JSONObject): Res {
        val code = resolveValue(step.optString("valueKey"), data).trim()
        if (code.isEmpty()) return Res.DONE
        val field = findField(step) ?: return Res.MISSING
        val cur = fieldValue(field)
        val codeRe = Regex("\\b" + Regex.escape(code.lowercase()) + "\\b")
        val picked = suggestionPicked[key]
        val hasCode = codeRe.containsMatchIn(cur.lowercase())
        // A picked suggestion fills "NEW DELHI - NDLS": the code plus more text.
        if (hasCode && cur.trim().length > code.length && (picked != null || stepFlags[key] == null)) return Res.DONE
        if (picked != null) {
            if (System.currentTimeMillis() - picked < 1_500L) return Res.WAIT
            suggestionPicked.remove(key) // the pick did not stick; try again
        }
        val rounds = (stepFlags["$key:rounds"] ?: 0) + 1
        stepFlags["$key:rounds"] = rounds
        if (rounds > 8) return Res.MISSING
        if (!hasCode) {
            tapNode(field)
            setText(field, code)
            stepFlags[key] = (stepFlags[key] ?: 0) + 1
            sleep(900)
            return Res.ACTED
        }
        val fb = field.bounds
        val sug = snap.filter { s ->
            !s.editable && s !== field && s.lower.isNotEmpty() && s.lower.length <= 80 &&
                codeRe.containsMatchIn(s.lower) && s.bounds.top >= fb.top
        }.minByOrNull { it.lower.length } ?: return Res.MISSING
        if (!tapNode(sug)) return Res.MISSING
        suggestionPicked[key] = System.currentTimeMillis()
        return Res.ACTED
    }

    /** prebookEngine stepDate: type DD/MM/YYYY; if the field is a calendar, pick the day. */
    private fun stepSetDate(key: String, step: JSONObject, data: JSONObject): Res {
        val value = resolveValue(step.optString("valueKey"), data)
        if (value.isEmpty()) return Res.DONE
        val m = Regex("^(\\d{1,2})/(\\d{1,2})/(\\d{4})$").find(value.trim()) ?: return Res.DONE
        val day = m.groupValues[1].toInt()
        val month = m.groupValues[2].toInt()
        val year = m.groupValues[3].toInt()
        val want = value.filter { it.isDigit() }
        val title = calendarTitle()
        if (title == null) {
            val field = findField(step) ?: return Res.MISSING
            if (fieldValue(field).filter { it.isDigit() } == want) return Res.DONE
            val phase = stepFlags[key] ?: 0
            stepFlags[key] = phase + 1
            if (phase > 12) return Res.MISSING
            if (phase == 0) {
                field.node.performAction(AccessibilityNodeInfo.ACTION_FOCUS)
                setText(field, value)
                return Res.ACTED
            }
            // Read-only calendar widget: open it.
            return if (tapNode(field)) { sleep(600); Res.ACTED } else Res.MISSING
        }
        val (shownM, shownY, titleNode) = title
        if (shownM == month && shownY == year) {
            val dayNode = snap.filter { s ->
                !s.editable && s.lower == day.toString() && s.bounds.top > titleNode.bounds.bottom
            }.minByOrNull { it.bounds.width() * it.bounds.height() } ?: return Res.MISSING
            if (!tapNode(dayNode)) return Res.MISSING
            sleep(600)
            return Res.ACTED
        }
        val navs = (stepFlags["$key:nav"] ?: 0) + 1
        stepFlags["$key:nav"] = navs
        if (navs > 24) return Res.MISSING
        val goPrev = shownY > year || (shownY == year && shownM > month)
        val nav = calendarNav(titleNode, goPrev) ?: return Res.MISSING
        if (!tapNode(nav)) return Res.MISSING
        sleep(450)
        return Res.ACTED
    }

    private fun calendarTitle(): Triple<Int, Int, S>? {
        val re = Regex("^(" + MONTHS.joinToString("|") + ")\\s*,?\\s*(\\d{4})$")
        for (s in snap) {
            if (s.lower.length > 24) continue
            val mm = re.find(s.lower) ?: continue
            return Triple(MONTHS.indexOf(mm.groupValues[1]) + 1, mm.groupValues[2].toInt(), s)
        }
        return null
    }

    private fun calendarNav(title: S, prev: Boolean): S? {
        val word = if (prev) "prev" else "next"
        snap.firstOrNull { s ->
            val d = (s.node.contentDescription?.toString() ?: "").lowercase()
            (d.contains(word) || s.lower.contains(word)) && s.lower.length < 20
        }?.let { return it }
        val tb = title.bounds
        val band = snap.filter { s ->
            s !== title && s.clickable && s.bounds.height() > 0 &&
                Math.abs(s.bounds.centerY() - tb.centerY()) < maxOf(tb.height(), 40) &&
                (if (prev) s.bounds.right <= tb.left + 4 else s.bounds.left >= tb.right - 4)
        }
        return if (prev) band.maxByOrNull { it.bounds.right } else band.minByOrNull { it.bounds.left }
    }

    /**
     * Opens a dropdown (native select or custom) found by the value it shows,
     * then taps the wanted option by visible text. Done when the control
     * shows the wanted value (exact, or "(CODE)").
     */
    private fun stepDropdown(key: String, step: JSONObject, data: JSONObject): Res {
        val wanted = resolveValue(step.optString("optionsKey"), data).split('|').map { it.trim() }.filter { it.isNotEmpty() }
        if (wanted.isEmpty()) return Res.DONE
        val ctrlSpec = step.optJSONObject("control") ?: return Res.DONE
        val exact = jsonStrList(ctrlSpec.optJSONArray("exactAny")).map { it.lowercase() }
        val rx = ctrlSpec.optString("regex").takeIf { it.isNotEmpty() }?.let { Regex(it) }
        val idx = ctrlSpec.optInt("index", 0)
        val opened = openedControls[key]

        if (opened == null) {
            val controls = dropdownControls(exact, rx)
            val ctrl = controls.getOrNull(idx) ?: return Res.MISSING
            val shown = ctrl.lower
            if (displayMatches(shown, wanted[0])) return Res.DONE
            if ((stepFlags[key] ?: 0) > 0 && wanted.any { displayMatches(shown, it) }) return Res.DONE
            val tries = (stepFlags["$key:open"] ?: 0) + 1
            stepFlags["$key:open"] = tries
            if (tries > 3) return Res.MISSING
            openedControls[key] = controls.map { Rect(it.bounds) }
            if (!tapNode(ctrl)) { openedControls.remove(key); return Res.MISSING }
            sleep(700)
            return Res.ACTED
        }

        // The list is open: search every window (a native <select> pops up its own).
        val nodes = snap
        fun isControl(s: S) = opened.any { it == s.bounds }
        var pick: S? = null
        loop@ for (pass in 0..2) {
            for (w in wanted) {
                val wl = w.lowercase()
                pick = nodes.firstOrNull { s ->
                    !s.editable && !isControl(s) && s.lower.isNotEmpty() && when (pass) {
                        0 -> s.lower == wl
                        1 -> s.lower.contains("($wl)")
                        else -> s.lower.contains(wl) && s.lower.length <= wl.length + 30
                    }
                }
                if (pick != null) break@loop
            }
        }
        openedControls.remove(key)
        val p = pick ?: return Res.MISSING
        if (!tapNode(p)) return Res.MISSING
        stepFlags[key] = (stepFlags[key] ?: 0) + 1
        sleep(500)
        return Res.ACTED
    }

    private fun dropdownControls(exact: List<String>, rx: Regex?): List<S> {
        val hits = snap.filter { s ->
            !s.editable && s.lower.isNotEmpty() && s.lower.length <= 60 &&
                (exact.contains(firstLine(s)) || (rx != null && rx.containsMatchIn(s.lower)))
        }
        // Keep the innermost node of each control (a wrapper repeating its child's text loses).
        return hits.filter { h -> hits.none { o -> o !== h && isAncestor(h, o) && firstLine(o) == firstLine(h) } }
    }

    private fun firstLine(s: S): String = s.text.lineSequence().firstOrNull()?.trim()?.lowercase() ?: ""

    private fun displayMatches(displayed: String, want: String): Boolean {
        val d = displayed.trim().lowercase()
        val w = want.trim().lowercase()
        if (w.isEmpty()) return false
        return d == w || d.lineSequence().firstOrNull()?.trim() == w || d.contains("($w)")
    }

    /**
     * Radio by label. `optionsKey` (any label), `labelContains` (any) or
     * `tokensKey` (all tokens in the option's own text). `scopeAny`: the
     * option must sit in a section mentioning one of these. `exclude`:
     * never an option whose own text contains these.
     */
    private fun stepRadio(key: String, step: JSONObject, data: JSONObject): Res {
        val any = mutableListOf<String>()
        any.addAll(resolveValue(step.optString("optionsKey"), data).split('|').filter { it.isNotBlank() })
        any.addAll(jsonStrList(step.optJSONArray("labelContains")))
        val tokens = resolveValue(step.optString("tokensKey"), data).split('|').filter { it.isNotBlank() }.map { it.lowercase() }
        val anyL = any.map { it.lowercase() }
        if (anyL.isEmpty() && tokens.isEmpty()) return Res.DONE
        val scope = jsonStrList(step.optJSONArray("scopeAny")).map { it.lowercase() }
        val exclude = jsonStrList(step.optJSONArray("exclude")).map { it.lowercase() }

        val cands = snap.filter { s ->
            s.lower.isNotEmpty() && s.lower.length <= 200 &&
                (anyL.isEmpty() || anyL.any { s.lower.contains(it) }) &&
                tokens.all { s.lower.contains(it) } &&
                exclude.none { s.lower.contains(it) }
        }.sortedBy { it.lower.length }
        val label = cands.firstOrNull { scope.isEmpty() || inScope(it, scope) }
        if (label == null) {
            if (step.optBoolean("absentOk", false) && scope.none { screenText.contains(it) }) return Res.DONE
            return Res.MISSING
        }
        val radio = checkableFor(label)
        if (radio != null && radio.node.isChecked) return Res.DONE
        val tapped = taps[key]?.count ?: 0
        if (tapped >= 1 && radio == null) return Res.DONE // state unreadable: trust the tap (in-app rule)
        if (tapped >= 2) return Res.MISSING
        if (!tapNode(radio ?: label)) return Res.MISSING
        taps[key] = TapRec(tapped + 1, System.currentTimeMillis())
        return Res.ACTED
    }

    /** Ensures a checkbox is ticked (never un-ticks). */
    private fun stepCheckbox(key: String, step: JSONObject): Res {
        val labels = jsonStrList(step.optJSONArray("labelContains")).map { it.lowercase() }
        val label = snap.filter { s -> labels.any { s.lower.contains(it) } && s.lower.length <= 120 }
            .minByOrNull { it.lower.length } ?: return Res.MISSING
        val box = checkableFor(label)
        if (box != null && box.node.isChecked) return Res.DONE
        val tapped = taps[key]?.count ?: 0
        if (tapped >= 1 && box == null) return Res.DONE
        if (tapped >= 2) return Res.MISSING
        if (!tapNode(box ?: label)) return Res.MISSING
        taps[key] = TapRec(tapped + 1, System.currentTimeMillis())
        return Res.ACTED
    }

    /** paymentEngine selectOption: tap the row, then its radio; never a third tap. */
    private fun stepSelectOption(key: String, step: JSONObject, data: JSONObject): Res {
        val opt: S? = if (step.optBoolean("provider", false)) {
            val name = resolveValue(step.optString("textKey"), data).lowercase().trim()
            if (name.isEmpty()) return Res.DONE
            snap.filter { s ->
                val t = s.lower
                t.length <= 60 && (t == name || t.startsWith("$name ") || t.contains(" $name"))
            }.minByOrNull { it.lower.length }
        } else {
            val src = resolveValue(step.optString("patternKey"), data)
            if (src.isEmpty()) return Res.DONE
            val rx = Regex(src)
            snap.filter { s -> s.lower.length <= 120 && rx.containsMatchIn(s.lower) }.minByOrNull { it.lower.length }
        }
        if (opt == null) return Res.MISSING
        val radio = checkableFor(opt)
        if (radio?.node?.isChecked == true || opt.node.isSelected || opt.node.isChecked) return Res.DONE
        val tapped = taps[key]?.count ?: 0
        if (tapped >= 1 && radio == null) return Res.DONE // no state exposed: trust the tap
        if (tapped >= 2) {
            engineStatus("$lastEngineStatus — tap it by hand")
            return Res.WAIT
        }
        val target = if (tapped == 0 || radio == null) opt else radio
        if (!tapNode(target)) return Res.MISSING
        taps[key] = TapRec(tapped + 1, System.currentTimeMillis())
        sleep(700)
        return Res.ACTED
    }

    /** postSearchEngine stepSelectTrain, split into class / date / Book Now. */
    private fun stepTapInCard(key: String, step: JSONObject, data: JSONObject, stage: Int, say: String): Res {
        val trainNo = data.optString("trip.trainNo", "").trim()
        if (trainNo.isEmpty()) return Res.DONE
        val card = trainCard(trainNo)
        if (card == null) {
            engineStatus(stageStatus(stage, say, " — train $trainNo not in the list yet"))
            return Res.MISSING
        }
        val dateCard = data.optString("trip.dateCard", "").lowercase()
        val dateAlt = dateCard.removePrefix("0")
        val availRe = Regex("available|waiting|wl|rac|regret")
        fun availBox(): S? = card.filter { s ->
            s.lower.isNotEmpty() && (dateCard.isNotEmpty() && (s.lower.contains(dateCard) || s.lower.contains(dateAlt))) &&
                availRe.containsMatchIn(s.lower)
        }.minByOrNull { it.lower.length }
        val bookNow = card.lastOrNull { it.lower == "book now" || (it.lower.contains("book") && it.lower.contains("now") && it.lower.length <= 12) }

        when (step.optString("target")) {
            "class" -> {
                val code = data.optString("trip.classCode", "ALL").uppercase()
                val tabs = card.filter { s -> s.text.trim().uppercase() in setOf("1A", "2A", "3A", "SL", "2S", "CC", "EC", "FC", "3E", "EA", "EV", "VC", "VS") }
                val tab = if (code == "ALL") tabs.firstOrNull() else tabs.firstOrNull { it.text.trim().uppercase() == code }
                val rec = taps[key]
                if (tab != null) {
                    if (tab.node.isSelected || tab.node.isChecked) return Res.DONE
                    if (rec != null && rec.lastTs > 0 && stepFlags["$key:tab"] == 1) return Res.DONE
                    if (!tapNode(tab)) return Res.MISSING
                    stepFlags["$key:tab"] = 1
                    taps[key] = TapRec((rec?.count ?: 0) + 1, System.currentTimeMillis())
                    sleep(900)
                    return Res.ACTED
                }
                if (tabs.isNotEmpty()) {
                    engineStatus(stageStatus(stage, say, " — class $code is not offered on train $trainNo; pick one by hand"))
                    return Res.WAIT
                }
                // Collapsed card: tap the class box to expand the tab strip.
                val want = if (code == "ALL") null else "(${code.lowercase()})"
                val box = card.filter { s ->
                    s.lower.length in 8..60 && (if (want != null) s.lower.contains(want)
                    else Regex("\\((1a|2a|3a|sl|2s|cc|ec|fc|3e|ea|ev|vc|vs)\\)").containsMatchIn(s.lower))
                }.minByOrNull { it.lower.length }
                if (box == null) {
                    // Some layouts show availability straight away.
                    return if (availBox() != null) Res.DONE else Res.MISSING
                }
                val expands = (stepFlags["$key:expand"] ?: 0) + 1
                stepFlags["$key:expand"] = expands
                if (expands > 3) return if (availBox() != null) Res.DONE else Res.MISSING
                if (!tapNode(box)) return Res.MISSING
                sleep(1200)
                return Res.ACTED
            }
            "date" -> {
                val tapped = taps[key]?.count ?: 0
                if (tapped > 0 && bookNow != null && bookNow.node.isEnabled) return Res.DONE
                // An availability dropdown opened by the first tap: pick the date in it.
                if (tapped > 0) {
                    val opt = snap.firstOrNull { s ->
                        card.none { it === s } && s.lower.length <= 60 &&
                            (s.lower.contains(dateCard) || s.lower.contains(dateAlt)) && availRe.containsMatchIn(s.lower)
                    }
                    if (opt != null && stepFlags["$key:opt"] != 1) {
                        stepFlags["$key:opt"] = 1
                        if (tapNode(opt)) { sleep(900); return Res.ACTED }
                    }
                }
                if (tapped >= 3) {
                    engineStatus(stageStatus(stage, say, " — Book Now stayed off; tap your date's availability by hand"))
                    return Res.WAIT
                }
                val box = availBox() ?: return Res.MISSING
                if (!tapNode(box)) return Res.MISSING
                taps[key] = TapRec(tapped + 1, System.currentTimeMillis())
                sleep(900)
                return Res.ACTED
            }
            "bookNow" -> {
                val gate = step.optString("gateKey", "trip.tatkalOpenAt")
                if (!tatkalOpen(data.optString(gate, ""), stage, say)) return Res.WAIT
                val doneWhen = step.optJSONObject("doneWhen")
                val rec = taps[key]
                if (rec != null && rec.count > 0 && doneWhen != null && detectMatches(doneWhen)) return Res.DONE
                val maxTaps = step.optInt("maxTaps", 2)
                if (rec != null && rec.count > 0) {
                    val retry = step.optLong("retryAfterMs", 4000L)
                    val now = System.currentTimeMillis()
                    if (rec.count >= maxTaps || now - rec.lastTs < retry || now - lastLoaderTs < retry) {
                        engineStatus(stageStatus(stage, say, " — waiting for IRCTC"))
                        return Res.WAIT
                    }
                }
                val b = bookNow ?: return Res.MISSING
                if (!b.node.isEnabled) {
                    engineStatus(stageStatus(stage, say, " — Book Now is not active yet"))
                    return Res.MISSING
                }
                if (!tapNode(b)) return Res.MISSING
                taps[key] = TapRec((rec?.count ?: 0) + 1, System.currentTimeMillis())
                sleep(1500)
                return Res.ACTED
            }
        }
        return Res.DONE
    }

    /**
     * The card holding [trainNo]: the smallest ancestor of the train-number
     * node with exactly one Book Now; else the vertical band from the train
     * number down to the first Book Now below it.
     */
    private fun trainCard(trainNo: String): List<S>? {
        val numRe = Regex("(^|\\D)" + Regex.escape(trainNo) + "(\\D|$)")
        val head = snap.filter { numRe.containsMatchIn(it.lower) && it.lower.length <= 120 }
            .minByOrNull { it.lower.length } ?: return null
        fun isBookNow(s: S) = s.lower == "book now" || (s.lower.contains("book") && s.lower.contains("now") && s.lower.length <= 12)
        var a = head.parent
        var depth = 0
        while (a >= 0 && depth < 10) {
            val sub = subtree(a)
            val n = sub.count { isBookNow(it) }
            if (n == 1) return sub
            if (n > 1) break
            a = snap[a].parent
            depth++
        }
        val top = head.bounds.top
        val book = snap.filter { isBookNow(it) && it.bounds.top > top }.minByOrNull { it.bounds.top } ?: return null
        val bottom = book.bounds.bottom
        return snap.filter { it.bounds.centerY() in top..bottom }
    }

    /** Preorder snapshot: a node's subtree is the contiguous run of its descendants. */
    private fun subtree(rootIdx: Int): List<S> {
        if (rootIdx < 0 || rootIdx >= snap.size) return emptyList()
        val out = mutableListOf(snap[rootIdx])
        var i = rootIdx + 1
        while (i < snap.size && isAncestorIdx(rootIdx, i)) { out.add(snap[i]); i++ }
        return out
    }

    /** postSearchEngine stepPopup: "Yes" only on the station-mismatch confirmation. */
    private fun stepConfirmPopup(key: String, step: JSONObject, stage: Int, say: String): Res {
        val prompt = step.optString("prompt").lowercase()
        if (prompt.isNotEmpty() && !screenText.contains(prompt)) return Res.DONE
        val markers = jsonStrList(step.optJSONArray("markers")).map { it.lowercase() }
        if (markers.none { screenText.contains(it) }) {
            engineStatus(stageStatus(stage, "IRCTC showed an unexpected popup — answer it yourself"))
            return Res.WAIT
        }
        val affirm = jsonStrList(step.optJSONArray("affirm")).map { it.lowercase() }
        val rec = taps[key]
        if (rec != null && (rec.count >= 2 || System.currentTimeMillis() - rec.lastTs < 3_000L)) return Res.WAIT
        val yes = snap.firstOrNull { s ->
            s.lower.length <= 8 && affirm.contains(s.lower.replace(Regex("^[^a-z]+"), ""))
        } ?: return Res.MISSING
        if (!tapNode(yes)) return Res.MISSING
        taps[key] = TapRec((rec?.count ?: 0) + 1, System.currentTimeMillis())
        sleep(1200)
        return Res.ACTED
    }

    /** Puts the cursor in the login captcha box for the user. Never types into it. */
    private fun stepFocusCaptcha(key: String): Res {
        val box = loginCaptchaField() ?: return Res.DONE
        if (fieldValue(box).isNotEmpty()) return Res.DONE
        if (taps[key] != null) return Res.DONE
        taps[key] = TapRec(1, System.currentTimeMillis())
        if (!tapNode(box)) box.node.performAction(AccessibilityNodeInfo.ACTION_FOCUS)
        return Res.ACTED_DONE
    }

    private fun loginCaptchaField(): S? {
        // Only a real, visible captcha box counts. "Any field after the
        // password" matched the search form behind the login sheet and
        // blocked SIGN IN even though IRCTC showed no captcha (2026-10-12).
        return snap.firstOrNull { s ->
            s.editable && !s.node.isPassword && s.bounds.width() > 0 && s.bounds.height() > 0 &&
                (s.hint.contains("captcha") || s.lower.contains("captcha")) &&
                (try { s.node.isVisibleToUser } catch (_: Exception) { false })
        }
    }

    /**
     * prebookEngine stepSubmitLogin, exactly: with a CAPTCHA on screen it
     * never taps SIGN IN (the user solves it and taps); without one it taps
     * SIGN IN once.
     */
    private fun stepSubmitLogin(key: String, step: JSONObject, stage: Int, say: String): Res {
        val captcha = loginCaptchaField()?.let { it.text.isEmpty() || it.lower.contains("captcha") } ?: false
        if (captcha) {
            engineStatus(stageStatus(stage, say))
            return Res.WAIT
        }
        if (taps[key] != null) {
            engineStatus(stageStatus(stage, "signing in", " — waiting for IRCTC"))
            return Res.WAIT
        }
        val btn = snap.firstOrNull { Regex("^sign\\s?in$").matches(it.lower) } ?: return Res.MISSING
        if (!tapNode(btn)) return Res.MISSING
        taps[key] = TapRec(1, System.currentTimeMillis())
        return Res.ACTED
    }

    /** Waits for the Tatkal window (CountdownScreen's FIRE instant). */
    private fun stepWaitTatkal(step: JSONObject, data: JSONObject, stage: Int, say: String): Res {
        val v = data.optString(step.optString("gateKey"), "")
        return if (tatkalOpen(v, stage, say)) Res.DONE else Res.WAIT
    }

    private fun tatkalOpen(openAtStr: String, stage: Int, say: String): Boolean {
        val openAt = openAtStr.toLongOrNull() ?: return true
        val left = openAt - System.currentTimeMillis()
        if (left <= 0) return true
        val sec = left / 1000
        val time = java.text.SimpleDateFormat("HH:mm", java.util.Locale.US).apply {
            timeZone = java.util.TimeZone.getTimeZone("Asia/Kolkata")
        }.format(java.util.Date(openAt))
        val wait = if (sec >= 3600) "${sec / 3600}h ${(sec % 3600) / 60}m" else if (sec >= 60) "${sec / 60}m ${sec % 60}s" else "${sec}s"
        engineStatus(stageStatus(stage, "ready — Tatkal opens at $time IST (in $wait)"))
        try { Thread.sleep(minOf(left, 400L)) } catch (_: Exception) { }
        return System.currentTimeMillis() >= openAt
    }

    /** fillEngine "+ Add Passenger": done once passenger row N exists. */
    private fun stepAddPassenger(key: String, step: JSONObject): Res {
        val row = step.optInt("row", 1)
        val labels = jsonStrList(step.optJSONArray("labelContains")).map { it.lowercase() }
        val rows = snap.count { s -> s.editable && labels.any { l -> s.hint.contains(l) || s.lower.contains(l) } }
        if (rows > row) return Res.DONE
        val rec = taps[key]
        if (rec != null && (rec.count >= 2 || System.currentTimeMillis() - rec.lastTs < 2_000L)) {
            return if (rec.count >= 2) Res.MISSING else Res.WAIT
        }
        val btn = snap.firstOrNull { !it.editable && it.lower.contains("add passenger") && it.lower.length <= 30 } ?: return Res.MISSING
        if (!tapNode(btn)) return Res.MISSING
        taps[key] = TapRec((rec?.count ?: 0) + 1, System.currentTimeMillis())
        sleep(700)
        return Res.ACTED
    }

    /**
     * A CAPTCHA on a booking page (e.g. Review Journey) is the user's: focus
     * it, then wait until they have typed it and paused for 2.5 s.
     */
    private fun stepWaitUserCaptcha(key: String, stage: Int, say: String): Res {
        if (!screenText.contains("captcha")) return Res.DONE
        val box = snap.firstOrNull { it.editable && it.hint.contains("captcha") }
            ?: snap.lastOrNull { it.editable && !it.node.isPassword }
            ?: return Res.DONE
        val v = fieldValue(box)
        if (v.isEmpty()) {
            if (taps[key] == null) {
                taps[key] = TapRec(1, System.currentTimeMillis())
                tapNode(box)
            }
            engineStatus(stageStatus(stage, say))
            return Res.WAIT
        }
        val now = System.currentTimeMillis()
        if (v != captchaText) { captchaText = v; captchaSince = now }
        if (v.length >= 4 && now - captchaSince >= 2_500L) return Res.DONE
        engineStatus(stageStatus(stage, say))
        return Res.WAIT
    }

    // ------------------------------------------------------------------
    // Payment stop
    // ------------------------------------------------------------------

    /** Non-null (a reason) when the screen is a payment gateway or bank/UPI page. */
    private fun gatewayReason(root: AccessibilityNodeInfo, gateway: JSONObject?): String? {
        val allow = jsonStrList(gateway?.optJSONArray("allowHosts")).map { it.lowercase() }
            .ifEmpty { listOf("irctc.co.in") }
        val host = urlHost(root)
        // Leaving IRCTC counts as the gateway only once the run reached the
        // review/payment pages. Before that a foreign host is just the old tab
        // Chrome shows while IRCTC loads (offIrctcHost pauses the run instead).
        if (stepFlags["payment:reached"] == 1 && host != null && allow.none { host == it || host.endsWith(".$it") }) {
            return "Left IRCTC for $host — you're at the payment step. Pay by hand."
        }
        // Gateway text counts only from the review/payment pages on: IRCTC's
        // home page itself shows e.g. "Scan QR" (app download), which killed
        // runs before the language alert.
        if (stepFlags["payment:reached"] != 1) return null
        val texts = jsonStrList(gateway?.optJSONArray("anyContains")).map { it.lowercase() }
        val hit = texts.firstOrNull { screenText.contains(it) }
        if (hit != null) return "Payment page detected — pay by hand."
        return null
    }

    /** A short, on-screen node shows [t] (hidden loader markup in the DOM doesn't count). */
    private fun loaderVisible(t: String): Boolean = snap.any { s ->
        s.lower.contains(t) && s.lower.length <= 60 && s.bounds.width() > 0 && s.bounds.height() > 0 &&
            (try { s.node.isVisibleToUser } catch (_: Exception) { false })
    }

    /** True when the address bar shows a host outside the allowlist. */
    private fun offIrctcHost(root: AccessibilityNodeInfo, gateway: JSONObject?): Boolean {
        val allow = jsonStrList(gateway?.optJSONArray("allowHosts")).map { it.lowercase() }
            .ifEmpty { listOf("irctc.co.in") }
        val host = urlHost(root) ?: return false
        return allow.none { host == it || host.endsWith(".$it") }
    }

    /** Host shown in the browser's address bar, when it is visible. */
    private fun urlHost(root: AccessibilityNodeInfo): String? {
        val ids = listOf(
            "com.android.chrome:id/url_bar", "com.chrome.beta:id/url_bar",
            "com.chrome.dev:id/url_bar", "com.chrome.canary:id/url_bar"
        )
        for (id in ids) {
            val nodes = try { root.findAccessibilityNodeInfosByViewId(id) } catch (_: Exception) { null }
            val t = nodes?.firstOrNull()?.text?.toString()?.trim()?.lowercase() ?: continue
            if (t.isEmpty() || t.contains(' ') || !t.contains('.')) return null
            return t.removePrefix("https://").removePrefix("http://").substringBefore('/').substringBefore(':')
        }
        return null
    }

    // ------------------------------------------------------------------
    // Tree snapshot + matching
    // ------------------------------------------------------------------

    private fun snapshot(root: AccessibilityNodeInfo): List<S> {
        val out = ArrayList<S>(512)
        snapshotInto(root, out)
        return out
    }

    private fun snapshotInto(root: AccessibilityNodeInfo, out: ArrayList<S>) {
        fun walk(n: AccessibilityNodeInfo, parent: Int, depth: Int) {
            if (out.size >= 8000 || depth > 60) return
            val raw = (n.text?.toString() ?: n.contentDescription?.toString() ?: "").trim()
            val r = Rect()
            n.getBoundsInScreen(r)
            val hint = if (Build.VERSION.SDK_INT >= 26) (n.hintText?.toString() ?: "").lowercase() else ""
            val me = out.size
            out.add(S(n, parent, raw, raw.lowercase().replace(Regex("\\s+"), " "), hint, r))
            for (i in 0 until n.childCount) {
                val c = try { n.getChild(i) } catch (_: Exception) { null } ?: continue
                walk(c, me, depth + 1)
            }
        }
        walk(root, -1, 0)
    }

    private fun buildScreenText(): String {
        val sb = StringBuilder()
        for (s in snap) {
            if (s.lower.isNotEmpty()) sb.append(s.lower).append(' ')
            val d = s.node.contentDescription?.toString()
            if (d != null && s.node.text != null) sb.append(d.lowercase()).append(' ')
            if (s.hint.isNotEmpty()) sb.append(s.hint).append(' ')
        }
        return sb.toString()
    }

    /**
     * The browser's app windows bottom-to-top (the page, then any popup a
     * native <select> opens), as one snapshot. Falls back to the active
     * window when the window list is unavailable.
     */
    private fun snapshotWindows(active: AccessibilityNodeInfo): List<S> {
        val out = ArrayList<S>(1024)
        try {
            val ws = windows.filter { it.type == AccessibilityWindowInfo.TYPE_APPLICATION }
                .sortedBy { it.layer }
            for (w in ws) {
                val r = w.root ?: continue
                val pkg = r.packageName?.toString() ?: continue
                if (!BROWSER_PACKAGES.contains(pkg)) continue
                snapshotInto(r, out)
            }
        } catch (_: Exception) { }
        if (out.isEmpty()) snapshotInto(active, out)
        return out
    }

    private fun findImeRect(): Rect? = try {
        windows.firstOrNull { it.type == AccessibilityWindowInfo.TYPE_INPUT_METHOD }?.let {
            val r = Rect(); it.getBoundsInScreen(r); r
        }
    } catch (_: Exception) { null }

    private fun webContentTop(): Int {
        val web = snap.firstOrNull { it.node.className?.toString() == "android.webkit.WebView" }
        return web?.bounds?.top ?: 0
    }

    private fun indexOf(s: S): Int = snap.indexOfFirst { it === s }

    private fun isAncestorIdx(anc: Int, idx: Int): Boolean {
        var p = snap.getOrNull(idx)?.parent ?: -1
        var guard = 0
        while (p >= 0 && guard < 80) {
            if (p == anc) return true
            p = snap[p].parent
            guard++
        }
        return false
    }

    private fun isAncestor(anc: S, s: S): Boolean {
        val a = indexOf(anc)
        val b = indexOf(s)
        return a >= 0 && b >= 0 && isAncestorIdx(a, b)
    }

    /** True when the label's section (up to 6 ancestors, short text) mentions a scope marker. */
    private fun inScope(s: S, scope: List<String>): Boolean {
        var i = indexOf(s)
        var d = 0
        while (i >= 0 && d < 7) {
            val sub = subtreeText(i, 600)
            if (scope.any { sub.contains(it) }) return true
            i = snap[i].parent
            d++
        }
        return false
    }

    private fun subtreeText(idx: Int, cap: Int): String {
        val sb = StringBuilder()
        for (n in subtree(idx)) {
            if (n.lower.isNotEmpty()) sb.append(n.lower).append(' ')
            if (sb.length > cap) break
        }
        return sb.toString()
    }

    /** The checkable control (radio / checkbox) belonging to a label node. */
    private fun checkableFor(label: S): S? {
        if (label.node.isCheckable) return label
        var i = indexOf(label)
        var d = 0
        while (i >= 0 && d < 3) {
            val cands = subtree(i).filter { it.node.isCheckable }
            if (cands.size == 1) return cands[0]
            if (cands.size > 1) {
                return cands.minByOrNull { Math.abs(it.bounds.centerY() - label.bounds.centerY()) }
            }
            i = snap[i].parent
            d++
        }
        return null
    }

    /**
     * Finds an editable field: `fieldIndex` (Nth editable), `labelContains`
     * (+ `index` for passenger rows, `labelExact` for short labels like
     * "Age"), with `fallbackIndex` when nothing is labelled, and the
     * password / username-before-password rule for the login form.
     */
    private fun findField(step: JSONObject): S? {
        val eds = snap.filter { it.editable }
        if (step.has("fieldIndex")) return eds.getOrNull(step.optInt("fieldIndex", -1))
        val labels = jsonStrList(step.optJSONArray("labelContains")).map { it.lowercase() }
        val exact = step.optBoolean("labelExact", false)
        val idx = step.optInt("index", 0)
        if (labels.isNotEmpty()) {
            val matches = eds.filter { s ->
                val desc = (s.node.contentDescription?.toString() ?: "").lowercase()
                labels.any { l ->
                    if (exact) s.hint.trim() == l || desc.trim() == l || s.hint.startsWith("$l ") || s.hint.startsWith("$l*")
                    else s.hint.contains(l) || desc.contains(l)
                }
            }
            if (matches.isNotEmpty()) return matches.getOrNull(idx)
            if (step.has("fallbackIndex")) {
                val nonLogin = eds.filter { !it.node.isPassword }
                return nonLogin.getOrNull(step.optInt("fallbackIndex", -1))
            }
        }
        if (step.optBoolean("passwordField", false) || step.optBoolean("loginUser", false)) {
            val pw = eds.indexOfFirst { it.node.isPassword }
            if (pw < 0) return null
            return if (step.optBoolean("passwordField", false)) eds[pw] else eds.getOrNull(pw - 1)
        }
        return null
    }

    /** The field's real value: Chrome reports the placeholder as text when empty. */
    private fun fieldValue(s: S): String {
        val t = s.node.text?.toString() ?: return ""
        if (Build.VERSION.SDK_INT >= 26 && s.node.isShowingHintText) return ""
        if (s.hint.isNotEmpty() && t.trim().lowercase() == s.hint.trim()) return ""
        return t.trim()
    }

    private fun setText(s: S, value: String): Boolean {
        val args = Bundle()
        args.putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, value)
        return try { s.node.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, args) } catch (_: Exception) { false }
    }

    private fun resolveValue(valueKey: String, fillData: JSONObject): String {
        if (valueKey.isEmpty()) return ""
        return fillData.optString(valueKey, "")
    }

    private fun detectMatches(detect: JSONObject?): Boolean {
        if (detect == null) return false
        val none = jsonStrList(detect.optJSONArray("noneContains"))
        if (none.any { screenText.contains(it.lowercase()) }) return false
        if (detect.optBoolean("passwordNode", false) && snap.any { it.editable && it.node.isPassword }) return true
        val anyOf = detect.optJSONArray("anyOf")
        if (anyOf != null && anyOf.length() > 0) {
            for (i in 0 until anyOf.length()) {
                val group = jsonStrList(anyOf.optJSONArray(i))
                if (group.isNotEmpty() && group.all { screenText.contains(it.lowercase()) }) return true
            }
            return false
        }
        val all = jsonStrList(detect.optJSONArray("allContains"))
        return all.isNotEmpty() && all.all { screenText.contains(it.lowercase()) }
    }

    private fun jsonStrList(arr: JSONArray?): List<String> {
        if (arr == null) return emptyList()
        return (0 until arr.length()).mapNotNull { arr.optString(it).takeIf { s -> s.isNotEmpty() } }
    }

    private fun sleep(ms: Long) {
        // Speed pass 2026-10-12: fixed waits cut to 40%, the page check after
        // each action confirms the result instead.
        try { Thread.sleep(maxOf(80L, ms * 2 / 5)) } catch (_: Exception) { }
    }

    // ------------------------------------------------------------------
    // Tapping
    // ------------------------------------------------------------------

    /**
     * A real finger tap at the node's centre (Chrome often ignores
     * ACTION_CLICK on web nodes). Scrolls the node on screen first and never
     * taps through the keyboard; falls back to ACTION_CLICK.
     */
    private fun tapNode(s: S): Boolean {
        val node = s.node
        val r = Rect()
        node.getBoundsInScreen(r)
        if (!onScreen(r)) {
            try {
                node.performAction(AccessibilityNodeInfo.AccessibilityAction.ACTION_SHOW_ON_SCREEN.id)
            } catch (_: Exception) { }
            sleep(400)
            try { node.refresh() } catch (_: Exception) { }
            node.getBoundsInScreen(r)
            imeRect = findImeRect()
        }
        if (onScreen(r) && r.width() > 0 && r.height() > 0) {
            if (gestureTap(r.exactCenterX(), r.exactCenterY())) return true
        }
        return clickNodeOrAncestor(node)
    }

    private fun onScreen(r: Rect): Boolean {
        val dm = resources.displayMetrics
        val top = maxOf(webTop, 0) + 4
        val bottom = dm.heightPixels - 4
        if (r.width() <= 0 || r.height() <= 0) return false
        val cy = r.centerY()
        val cx = r.centerX()
        if (cy < top || cy > bottom || cx < 0 || cx > dm.widthPixels) return false
        val ime = imeRect
        if (ime != null && ime.contains(cx, cy)) return false
        return true
    }

    /** Screenshot (API 30+) and find the language alert's two orange buttons.
     *  Returns (left, right) in screen pixels, or null. Runs on the engine thread. */
    private fun findLanguageButtons(): Pair<Rect, Rect>? {
        if (Build.VERSION.SDK_INT < 30) return null
        return try {
            val latch = CountDownLatch(1)
            var bmp: android.graphics.Bitmap? = null
            takeScreenshot(android.view.Display.DEFAULT_DISPLAY, mainExecutor,
                object : AccessibilityService.TakeScreenshotCallback {
                    override fun onSuccess(res: AccessibilityService.ScreenshotResult) {
                        try {
                            val hb = res.hardwareBuffer
                            val hw = android.graphics.Bitmap.wrapHardwareBuffer(hb, res.colorSpace)
                            bmp = hw?.copy(android.graphics.Bitmap.Config.ARGB_8888, false)
                            hb.close()
                        } catch (_: Throwable) { }
                        latch.countDown()
                    }
                    override fun onFailure(code: Int) { latch.countDown() }
                })
            latch.await(2, TimeUnit.SECONDS)
            val b = bmp ?: return null
            val w = b.width; val h = b.height
            val px = IntArray(w * h); b.getPixels(px, 0, w, 0, 0, w, h); b.recycle()
            val st = 3
            val gw = w / st; val gh = h / st
            val mark = BooleanArray(gw * gh)
            for (gy in (gh * 15 / 100) until (gh * 97 / 100)) for (gx in 0 until gw) {
                val c = px[(gy * st) * w + gx * st]
                val r = (c shr 16) and 255; val g = (c shr 8) and 255; val bl = c and 255
                if (r > 200 && g in 80..185 && bl < 120 && r - bl > 120 && r - g > 45) mark[gy * gw + gx] = true
            }
            val seenArr = BooleanArray(gw * gh)
            val blobs = ArrayList<Rect>()
            val q = IntArray(gw * gh)
            for (i in mark.indices) {
                if (!mark[i] || seenArr[i]) continue
                var head = 0; var tail = 0; q[tail++] = i; seenArr[i] = true
                var x0 = gw; var y0 = gh; var x1 = 0; var y1 = 0; var n = 0
                while (head < tail) {
                    val k = q[head++]; val kx = k % gw; val ky = k / gw; n++
                    if (kx < x0) x0 = kx; if (kx > x1) x1 = kx; if (ky < y0) y0 = ky; if (ky > y1) y1 = ky
                    for (d in intArrayOf(-1, 1, -gw, gw)) {
                        val j = k + d
                        if (j < 0 || j >= mark.size) continue
                        if ((d == -1 && kx == 0) || (d == 1 && kx == gw - 1)) continue
                        if (mark[j] && !seenArr[j]) { seenArr[j] = true; q[tail++] = j }
                    }
                }
                val r = Rect(x0 * st, y0 * st, (x1 + 1) * st, (y1 + 1) * st)
                val fill = n.toFloat() / ((x1 - x0 + 1) * (y1 - y0 + 1))
                if (r.width() >= w * 0.06f && r.height() >= h * 0.018f && r.height() <= h * 0.09f &&
                    r.width() <= w * 0.5f && fill > 0.5f) blobs.add(r)
            }
            var best: Pair<Rect, Rect>? = null
            for (i in blobs.indices) for (j in blobs.indices) {
                if (i == j) continue
                val l = blobs[i]; val rr = blobs[j]
                if (l.centerX() >= rr.centerX()) continue
                if (Math.abs(l.centerY() - rr.centerY()) > l.height() / 2) continue
                if (rr.left - l.right > w * 0.2f) continue
                if (best == null || l.centerY() > best.first.centerY()) best = Pair(l, rr)
            }
            best
        } catch (_: Throwable) { null }
    }

    private fun gestureTap(x: Float, y: Float): Boolean {
        return try {
            val path = Path().apply { moveTo(x, y) }
            val g = GestureDescription.Builder()
                .addStroke(GestureDescription.StrokeDescription(path, 0, 60))
                .build()
            val latch = CountDownLatch(1)
            val ok = AtomicBoolean(false)
            val sent = dispatchGesture(g, object : AccessibilityService.GestureResultCallback() {
                override fun onCompleted(gestureDescription: GestureDescription?) {
                    ok.set(true); latch.countDown()
                }
                override fun onCancelled(gestureDescription: GestureDescription?) {
                    latch.countDown()
                }
            }, null)
            if (!sent) return false
            latch.await(1500, TimeUnit.MILLISECONDS)
            ok.get()
        } catch (_: Exception) { false }
    }

    private fun clickNodeOrAncestor(start: AccessibilityNodeInfo): Boolean {
        var node: AccessibilityNodeInfo? = start
        var depth = 0
        while (node != null && depth < 6) {
            if (node.isClickable) return node.performAction(AccessibilityNodeInfo.ACTION_CLICK)
            node = node.parent
            depth++
        }
        return start.performAction(AccessibilityNodeInfo.ACTION_CLICK)
    }

    private fun setSessionActive(active: Boolean) {
        try {
            automationPrefs().edit()
                .putBoolean(KEY_SESSION_ACTIVE, active)
                .putLong(KEY_SESSION_TS, if (active) System.currentTimeMillis() else 0L)
                .apply()
        } catch (_: Exception) { }
    }

    // ------------------------------------------------------------------
    // Probe helpers (Probe screen)
    // ------------------------------------------------------------------

    private fun dumpClickables(root: AccessibilityNodeInfo): JSONObject {
        val out = JSONObject()
        val nodes = JSONArray()
        walkClickables(root, nodes, 0)
        out.put("clickableCount", nodes.length())
        out.put("nodes", nodes)
        out.put("ts", System.currentTimeMillis())
        return out
    }

    private fun walkClickables(node: AccessibilityNodeInfo, out: JSONArray, depth: Int) {
        if (depth > 25 || out.length() >= 200) return
        if (node.isClickable) {
            val o = JSONObject()
            o.put("text", node.text?.toString() ?: "")
            o.put("contentDesc", node.contentDescription?.toString() ?: "")
            o.put("viewId", node.viewIdResourceName ?: "")
            o.put("className", node.className?.toString() ?: "")
            out.put(o)
        }
        for (i in 0 until node.childCount) {
            val child = node.getChild(i) ?: continue
            walkClickables(child, out, depth + 1)
        }
    }

    /** Probe test-tap: finds [text] by walking the tree, taps it. */
    private fun tapNodeWithText(root: AccessibilityNodeInfo, text: String): Boolean {
        val want = text.trim().lowercase()
        val all = snapshot(root)
        val hit = all.firstOrNull { it.lower == want }
            ?: all.firstOrNull { it.lower.contains(want) && it.lower.length <= want.length + 12 }
            ?: return false
        return tapNode(hit)
    }
}
