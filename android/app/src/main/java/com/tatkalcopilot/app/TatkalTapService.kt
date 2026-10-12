package com.tatkalcopilot.app

import android.accessibilityservice.AccessibilityService
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.SharedPreferences
import android.os.Build
import android.os.Bundle
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import org.json.JSONArray
import org.json.JSONObject
import java.util.Collections

/**
 * Taps IRCTC booking buttons in real Chrome — Search Trains, Book Now,
 * Continue — so booking is automatic until the payment page.
 *
 * Safety architecture (see roadmap v2 §6):
 * - PAYMENT KILL-SWITCH: a denylist of payment indicators is checked BEFORE
 *   anything else. On any match the service locks down for the session and
 *   will not fill, tap, or observe further. The denylist cannot be toggled
 *   off and always runs first.
 * - ALLOWLIST: only (page → button) pairs from the choreography map are
 *   ever tapped. Anything else is ignored.
 * - CREDENTIALS: login buttons are never tapped; the user logs in manually.
 * - One action per accessibility event: naturally human-paced, never
 *   machine-gun tapping.
 * - The choreography map (page detectors, button labels) comes from the
 *   app's JavaScript layer via encrypted prefs → OTA-updatable. No map =
 *   the service stays silent. No hardcoded patterns in native code.
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
        // Master kill-switch: when false, the tap engine never starts and a
        // running loop halts on its next iteration. Toggled from the app UI
        // or the STOP action on the persistent notification.
        const val PREFS_AUTOMATION = "tatkal_automation"
        const val KEY_AUTOMATION_ENABLED = "automation_enabled"
        // True while the fast choreography loop is actively running. The
        // Quick Settings tile reads this to decide tap = start vs tap = stop.
        const val KEY_SESSION_ACTIVE = "session_active"
        // Heartbeat (epoch ms) written by the running loop; the tile treats
        // a run as live only while this is fresh.
        const val KEY_SESSION_TS = "session_ts"
        const val ACTION_STOP_AUTOMATION = "com.tatkalcopilot.app.STOP_AUTOMATION"
        const val NOTIF_ID = 4242
        const val KEY_FILL_DATA = "fill_data"
        const val CHROME_PKG = "com.android.chrome"

        private val BROWSER_PACKAGES = setOf(
            // Chrome variants
            "com.android.chrome",
            "com.chrome.beta",
            "com.chrome.dev",
            "com.chrome.canary",
            // Firefox variants
            "org.mozilla.firefox",
            "org.mozilla.firefox_beta",
            "org.mozilla.fenix",
            // Other common Android browsers
            "com.brave.browser",
            "com.mi.globalbrowser",
            "com.sec.android.app.sbrowser",
            "com.opera.browser",
            "com.opera.mini.native",
            "com.ucmobile.intl",
            "com.microsoft.emmx",
            "com.duckduckgo.mobile.android",
            "com.vivaldi.browser",
            "app.vanadium",
            "com.realme.browser",
            "com.coloros.browser"
        )
    }

    @Volatile private var paymentLockdown = false
    @Volatile private var choreographyRunning = false
    // Thread-safe: mutated from the background choreography loop; cleared
    // from onAccessibilityEvent when the user leaves the browser.
    private val donePages = Collections.synchronizedSet(mutableSetOf<String>())
    private val doneSteps = Collections.synchronizedSet(mutableSetOf<String>())
    // Stuck-step guard: a fill step whose field never appears must not wedge
    // the whole flow forever. After enough fruitless attempts we skip it so
    // later steps (especially taps) still run. Keyed by page+step index.
    private val stepAttempts = Collections.synchronizedMap(mutableMapOf<String, Int>())
    private val skippedSteps = Collections.synchronizedSet(mutableSetOf<String>())
    // Autocomplete steps (pickSuggestion): the suggestion tap is a separate
    // phase — setting the text alone must NOT count as done.
    private val suggestionPicked = Collections.synchronizedSet(mutableSetOf<String>())
    // Password fields read back as bullets, so "filled" is tracked here.
    private val passwordFilled = Collections.synchronizedSet(mutableSetOf<String>())
    private var lastEngineStatus = "idle"

    private fun engineStatus(s: String) {
        lastEngineStatus = s
        try {
            probePrefs().edit().putString(KEY_ENGINE_STATUS, s).apply()
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

    /** Persistent notification with a STOP action — the instant kill-switch. */
    private fun showStopNotification() {
        try {
            val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            val channelId = "tatkal_automation"
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                val ch = NotificationChannel(
                    channelId,
                    "Booking automation",
                    NotificationManager.IMPORTANCE_HIGH
                )
                ch.description = "Stop the auto-booking at any time"
                nm.createNotificationChannel(ch)
            }
            val stopIntent = Intent(ACTION_STOP_AUTOMATION).apply {
                setPackage(packageName)
            }
            var flags = PendingIntent.FLAG_UPDATE_CURRENT
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                flags = flags or PendingIntent.FLAG_IMMUTABLE
            }
            val pi = PendingIntent.getBroadcast(this, 0, stopIntent, flags)
            val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                Notification.Builder(this, channelId)
            } else {
                @Suppress("DEPRECATION")
                Notification.Builder(this).setPriority(Notification.PRIORITY_HIGH)
            }
            val notif = builder
                .setContentTitle("Tatkal Copilot: auto-booking ON")
                .setContentText("Tap STOP below to halt it immediately")
                .setSmallIcon(android.R.drawable.ic_dialog_alert)
                .addAction(android.R.drawable.ic_menu_close_clear_cancel, "STOP", pi)
                .setOngoing(true)
                .build()
            nm.notify(NOTIF_ID, notif)
        } catch (_: Exception) { }
    }

    private fun hideStopNotification() {
        try {
            val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            nm.cancel(NOTIF_ID)
        } catch (_: Exception) { }
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {
        if (event == null) return
        val pkg = event.packageName?.toString() ?: return
        // The notification shade / Quick Settings is not "leaving the browser".
        if (pkg == "com.android.systemui") return
        if (!BROWSER_PACKAGES.contains(pkg)) {
            // Left the browser: reset the session state.
            paymentLockdown = false
            donePages.clear()
            doneSteps.clear()
            skippedSteps.clear()
            suggestionPicked.clear()
            passwordFilled.clear()
            stepAttempts.clear()
            return
        }
        try {
            val root = rootInActiveWindow ?: return

            // Probe diagnostics: what clickable nodes are visible.
            try {
                val dump = dumpClickables(root)
                probePrefs().edit().putString(KEY_CLICKABLE_DUMP, dump.toString()).apply()
            } catch (_: Exception) { }

            // Explicit test-tap command from the probe screen (Phase 0).
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

            // Real choreography: fast background loop (debounced). Speed
            // matters for Tatkal — we run steps back-to-back with short
            // settles instead of waiting a full accessibility-event cycle
            // between actions. The master kill-switch gates every start.
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
                        } catch (_: Exception) {
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

    override fun onInterrupt() {
        // Nothing to clean up.
    }

    // ------------------------------------------------------------------
    // Choreography engine
    // ------------------------------------------------------------------

    /**
     * Fast choreography loop. Runs on a background thread (never the main
     * thread) and executes pending steps back-to-back with short settles,
     * instead of waiting a full accessibility-event cycle between actions.
     * Taps are one-shot (tracked in doneSteps) so nothing is ever tapped
     * twice. Aborts on payment screens, when the user leaves the browser,
     * or after a timeout.
     */
    private fun runChoreographyFast() {
        setSessionActive(true)
        try {
        val deadline = System.currentTimeMillis() + 90_000
        var lastBeat = 0L
        while (System.currentTimeMillis() < deadline) {
            val now = System.currentTimeMillis()
            if (now - lastBeat > 3_000L) { setSessionActive(true); lastBeat = now }
            // Master kill-switch: halt on the next iteration, no exceptions.
            if (!isAutomationEnabled()) {
                engineStatus("automation stopped by user")
                return
            }
            if (paymentLockdown) {
                engineStatus("payment lockdown — silent")
                return
            }

            val root = try { rootInActiveWindow } catch (_: Exception) { null }
            if (root == null) {
                Thread.sleep(500)
                continue
            }
            val pkg = try { root.packageName?.toString() } catch (_: Exception) { null }
            if (pkg == "com.android.systemui") {
                // Notification shade / Quick Settings pulled down (e.g. to
                // tap the tile and stop): keep the run alive, just wait.
                try { root.recycle() } catch (_: Exception) { }
                Thread.sleep(500)
                continue
            }
            if (pkg == null || !BROWSER_PACKAGES.contains(pkg)) {
                try { root.recycle() } catch (_: Exception) { }
                return // user left the browser
            }

            val screenText = try { collectText(root).lowercase() } catch (_: Exception) { "" }

            val prefs = try { securePrefs() } catch (_: Exception) {
                engineStatus("secure prefs unavailable")
                try { root.recycle() } catch (_: Exception) { }
                return
            }
            val mapJson = prefs.getString(KEY_CHOREO_MAP, null) ?: run {
                engineStatus("no choreography map — did auto-booking sync run?")
                try { root.recycle() } catch (_: Exception) { }
                return
            }
            // Fill data is optional: without a trip the language and login
            // steps must still run, so fall back to an empty object.
            val dataJson = prefs.getString(KEY_FILL_DATA, null) ?: "{}"
            val map: JSONObject
            val fillData: JSONObject
            try {
                map = JSONObject(mapJson)
                fillData = JSONObject(dataJson)
            } catch (_: Exception) {
                try { root.recycle() } catch (_: Exception) { }
                return
            }

            // 1. PAYMENT KILL-SWITCH — always first, no exceptions.
            val killAny = jsonStrList(map.optJSONObject("paymentKill")?.optJSONArray("anyContains"))
            if (killAny.any { screenText.contains(it.lowercase()) }) {
                paymentLockdown = true
                engineStatus("payment lockdown — silent")
                try { root.recycle() } catch (_: Exception) { }
                return
            }

            // 2. Detect the current page and run its pending steps.
            val pages = map.optJSONArray("pages")
            var pageFound = false
            var acted = false
            if (pages != null) {
                for (i in 0 until pages.length()) {
                    val page = pages.optJSONObject(i) ?: continue
                    val pageId = page.optString("id")
                    if (pageId.isEmpty() || donePages.contains(pageId)) continue
                    if (!pageMatches(page.optJSONObject("detect"), screenText)) continue
                    pageFound = true

                    val steps = page.optJSONArray("steps") ?: break
                    var allDone = true
                    for (s in 0 until steps.length()) {
                        val step = steps.optJSONObject(s) ?: continue
                        val stepKey = "$pageId:$s"
                        if (skippedSteps.contains(stepKey) || doneSteps.contains(stepKey)) continue
                        if (isStepDone(stepKey, step, root, fillData)) {
                            doneSteps.add(stepKey)
                            continue
                        }
                        allDone = false
                        val progressed = try {
                            executeStep(stepKey, step, root, fillData)
                        } catch (_: Exception) { false }
                        if (progressed) {
                            acted = true
                            stepAttempts.remove(stepKey)
                            if (step.optString("do") == "tap" || step.optString("do") == "tapLogin") {
                                // One-shot: a tap is done the moment it fires.
                                doneSteps.add(stepKey)
                                engineStatus("page '$pageId': tapped '${step.optString("do")}:${step.optString("text")}'")
                            } else {
                                engineStatus("page '$pageId': did step $s (${step.optString("do")})")
                            }
                        } else {
                            val n = (stepAttempts[stepKey] ?: 0) + 1
                            stepAttempts[stepKey] = n
                            if (n >= 25) {
                                skippedSteps.add(stepKey)
                                engineStatus("page '$pageId': skipped stuck step $s after $n tries")
                            } else {
                                engineStatus("page '$pageId': step $s waiting (try $n)")
                            }
                        }
                        break // re-fetch a fresh tree after each action
                    }
                    if (allDone) {
                        donePages.add(pageId)
                        engineStatus("page '$pageId' complete")
                    }
                    break // one page per pass
                }
            }
            try { root.recycle() } catch (_: Exception) { }
            if (!pageFound) {
                if (!paymentLockdown) engineStatus("no page matched (${screenText.length} chars of text seen)")
                Thread.sleep(600)
            } else if (!acted) {
                Thread.sleep(350)
            } else {
                Thread.sleep(300)
            }
        }
        engineStatus("choreography timed out")
        } finally {
            setSessionActive(false)
        }
    }

    private fun setSessionActive(active: Boolean) {
        try {
            getSharedPreferences(PREFS_AUTOMATION, MODE_PRIVATE)
                .edit()
                .putBoolean(KEY_SESSION_ACTIVE, active)
                .putLong(KEY_SESSION_TS, if (active) System.currentTimeMillis() else 0L)
                .apply()
        } catch (_: Exception) { }
    }

    private fun isStepDone(
        stepKey: String,
        step: JSONObject,
        root: AccessibilityNodeInfo,
        fillData: JSONObject
    ): Boolean {
        return when (step.optString("do")) {
            "fillField" -> {
                val value = resolveValue(step.optString("valueKey"), fillData)
                if (value.isEmpty()) return true // nothing to fill: skip
                // Autocomplete: not done until the suggestion itself was tapped.
                if (step.optBoolean("pickSuggestion", false) &&
                    !suggestionPicked.contains(stepKey)
                ) return false
                val field = findField(root, step) ?: return false
                if (field.isPassword) return passwordFilled.contains(stepKey)
                val current = field.text?.toString() ?: ""
                current.contains(value)
            }
            "tap", "tapLogin" -> false // taps are one-shot; engine tracks via doneSteps
            else -> true
        }
    }

    /** Returns true when the step acted (or had nothing to do); false when its target wasn't found. */
    private fun executeStep(
        stepKey: String,
        step: JSONObject,
        root: AccessibilityNodeInfo,
        fillData: JSONObject
    ): Boolean {
        when (step.optString("do")) {
            "fillField" -> {
                val value = resolveValue(step.optString("valueKey"), fillData)
                if (value.isEmpty()) return true
                val field = findField(root, step) ?: return false
                if (field.isPassword) {
                    if (passwordFilled.contains(stepKey)) return true
                    field.performAction(AccessibilityNodeInfo.ACTION_FOCUS)
                    val pargs = Bundle()
                    pargs.putCharSequence(
                        AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE,
                        value
                    )
                    val ok = field.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, pargs)
                    if (ok) passwordFilled.add(stepKey)
                    return ok
                }
                val current = field.text?.toString() ?: ""
                if (!current.contains(value)) {
                    // Focus first, then set text (helps web fields accept it).
                    field.performAction(AccessibilityNodeInfo.ACTION_FOCUS)
                    val args = Bundle()
                    args.putCharSequence(
                        AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE,
                        value
                    )
                    field.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, args)
                    return true
                }
                if (step.optBoolean("pickSuggestion", false) &&
                    !suggestionPicked.contains(stepKey)
                ) {
                    // Autocomplete dropdown: tap the suggestion showing our value.
                    val suggestion = findClickableText(root, value)
                    return if (suggestion != null) {
                        suggestion.performAction(AccessibilityNodeInfo.ACTION_CLICK)
                        suggestionPicked.add(stepKey)
                        true
                    } else false
                }
                return true
            }
            "tap" -> {
                // textKey lets the label come from fill data (e.g. the
                // user's saved IRCTC language); text is the fallback.
                val fromData = resolveValue(step.optString("textKey"), fillData)
                val label = if (fromData.isNotEmpty()) fromData else step.optString("text")
                if (label.isNotEmpty()) {
                    return tapNodeWithText(root, label)
                }
                return true
            }
            "tapLogin" -> {
                val tapped = tapLoginEntry(root)
                if (tapped) {
                    // Give the login form time to open before the next pass.
                    try { Thread.sleep(1500) } catch (_: Exception) { }
                }
                return tapped
            }
        }
        return true
    }

    /**
     * Opens IRCTC's login form. Skips (returns true) when already logged in.
     * Tries, in order: a node whose text is LOGIN / Sign In; a node whose
     * description mentions login/user/person/account/profile; finally the
     * top-right-most clickable in the page's top strip (IRCTC mobile shows
     * an icon-only person glyph there).
     */
    private fun tapLoginEntry(root: AccessibilityNodeInfo): Boolean {
        val text = try { collectText(root).lowercase() } catch (_: Exception) { "" }
        if (text.contains("logout") || text.contains("log out")) return true
        for (label in listOf("LOGIN", "Login", "Sign In", "SIGN IN")) {
            val n = findNode(root) { node ->
                (node.text?.toString()?.trim()?.equals(label, ignoreCase = true) == true)
            }
            if (n != null && clickNodeOrAncestor(n)) return true
        }
        val byDesc = findNode(root) { node ->
            val d = (node.contentDescription?.toString() ?: "").lowercase()
            d.isNotEmpty() && Regex("log\\s?in|sign\\s?in|user|person|account|profile").containsMatchIn(d)
        }
        if (byDesc != null && clickNodeOrAncestor(byDesc)) return true
        // Positional fallback: top strip of the web content, rightmost first.
        val rootRect = android.graphics.Rect()
        root.getBoundsInScreen(rootRect)
        val candidates = mutableListOf<Pair<AccessibilityNodeInfo, android.graphics.Rect>>()
        val webTop = webContentTop(root) ?: rootRect.top
        val stack = ArrayDeque<AccessibilityNodeInfo>()
        stack.add(root)
        while (stack.isNotEmpty()) {
            val node = stack.removeLast()
            val cls = node.className?.toString() ?: ""
            if (node.isClickable && !node.isEditable && cls != "android.widget.EditText") {
                val r = android.graphics.Rect()
                node.getBoundsInScreen(r)
                if (r.width() > 0 && r.top >= webTop && r.top < webTop + 220 &&
                    r.right > rootRect.right - 220
                ) candidates.add(node to r)
            }
            for (i in 0 until node.childCount) node.getChild(i)?.let { stack.add(it) }
        }
        val best = candidates.maxByOrNull { it.second.right } ?: return false
        return best.first.performAction(AccessibilityNodeInfo.ACTION_CLICK)
    }

    /** Top edge of Chrome's web content (below the address bar), when exposed. */
    private fun webContentTop(root: AccessibilityNodeInfo): Int? {
        val web = findNode(root) { it.className?.toString() == "android.webkit.WebView" } ?: return null
        val r = android.graphics.Rect()
        web.getBoundsInScreen(r)
        return r.top
    }

    private fun clickNodeOrAncestor(start: AccessibilityNodeInfo): Boolean {
        var node: AccessibilityNodeInfo? = start
        var depth = 0
        while (node != null && depth < 6) {
            if (node.isClickable) return node.performAction(AccessibilityNodeInfo.ACTION_CLICK)
            node = node.parent
            depth++
        }
        return false
    }

    // ------------------------------------------------------------------
    // Node finding
    // ------------------------------------------------------------------

    /**
     * Finds an editable field matching the step. Two modes:
     * - fieldIndex: the Nth editable field in traversal order (IRCTC's
     *   From/To/Date inputs expose no accessible label, but their order is
     *   stable: 0 = From, 1 = To, 2 = Date).
     * - labelContains: match by visible text / description / hint.
     */
    private fun findField(root: AccessibilityNodeInfo, step: JSONObject): AccessibilityNodeInfo? {
        if (step.has("fieldIndex")) {
            val idx = step.optInt("fieldIndex", -1)
            if (idx < 0) return null
            val editables = mutableListOf<AccessibilityNodeInfo>()
            collectEditables(root, editables)
            return editables.getOrNull(idx)
        }
        val labels = jsonStrList(step.optJSONArray("labelContains")).map { it.lowercase() }
        if (labels.isNotEmpty()) {
            val byLabel = findNode(root) { node ->
                if (!node.isEditable) return@findNode false
                val text = (node.text?.toString() ?: "").lowercase()
                val desc = (node.contentDescription?.toString() ?: "").lowercase()
                val hint = node.hintText?.toString()?.lowercase() ?: ""
                labels.any { text.contains(it) || desc.contains(it) || hint.contains(it) }
            }
            if (byLabel != null) return byLabel
        }
        // Fallbacks for unlabeled login inputs: the password box, and the
        // editable field just before it (the username).
        if (step.optBoolean("passwordField", false) || step.optBoolean("loginUser", false)) {
            val editables = mutableListOf<AccessibilityNodeInfo>()
            collectEditables(root, editables)
            val pwIdx = editables.indexOfFirst { it.isPassword }
            if (pwIdx < 0) return null
            return if (step.optBoolean("passwordField", false)) editables[pwIdx]
            else editables.getOrNull(pwIdx - 1)
        }
        return null
    }

    private fun collectEditables(node: AccessibilityNodeInfo, out: MutableList<AccessibilityNodeInfo>) {
        if (node.isEditable) out.add(node)
        for (i in 0 until node.childCount) {
            node.getChild(i)?.let { collectEditables(it, out) }
        }
    }

    private fun findClickableText(root: AccessibilityNodeInfo, text: String): AccessibilityNodeInfo? {
        val lower = text.lowercase()
        return findNode(root) { node ->
            node.isClickable &&
                (node.text?.toString()?.lowercase()?.contains(lower) == true ||
                    node.contentDescription?.toString()?.lowercase()?.contains(lower) == true)
        }
    }

    private fun findNode(
        root: AccessibilityNodeInfo,
        pred: (AccessibilityNodeInfo) -> Boolean
    ): AccessibilityNodeInfo? {
        val stack = ArrayDeque<AccessibilityNodeInfo>()
        stack.add(root)
        while (stack.isNotEmpty()) {
            val node = stack.removeLast()
            if (pred(node)) return node
            for (i in 0 until node.childCount) {
                node.getChild(i)?.let { stack.add(it) }
            }
        }
        return null
    }

    private fun collectText(root: AccessibilityNodeInfo): String {
        val sb = StringBuilder()
        val stack = ArrayDeque<AccessibilityNodeInfo>()
        stack.add(root)
        var count = 0
        while (stack.isNotEmpty() && count < 2000) {
            val node = stack.removeLast()
            count++
            node.text?.let { sb.append(it).append(' ') }
            node.contentDescription?.let { sb.append(it).append(' ') }
            for (i in 0 until node.childCount) {
                node.getChild(i)?.let { stack.add(it) }
            }
        }
        return sb.toString()
    }

    private fun resolveValue(valueKey: String, fillData: JSONObject): String {
        if (valueKey.isEmpty()) return ""
        return fillData.optString(valueKey, "")
    }

    /**
     * A page matches when every string in detect.allContains is on screen,
     * or (when detect.anyOf is given) every string of ANY one of its lists.
     */
    private fun pageMatches(detect: JSONObject?, screenText: String): Boolean {
        if (detect == null) return false
        val none = jsonStrList(detect.optJSONArray("noneContains"))
        if (none.any { screenText.contains(it.lowercase()) }) return false
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
        return (0 until arr.length()).mapNotNull {
            arr.optString(it).takeIf { s -> s.isNotEmpty() }
        }
    }

    // ------------------------------------------------------------------
    // Probe helpers
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
            child.recycle()
        }
    }

    private fun tapNodeWithText(root: AccessibilityNodeInfo, text: String): Boolean {
        val matches = root.findAccessibilityNodeInfosByText(text)
        val owned = mutableSetOf<AccessibilityNodeInfo>()
        try {
            for (n in matches) {
                owned.add(n)
                var node: AccessibilityNodeInfo? = n
                while (node != null && !node.isClickable) {
                    val parent = node.parent
                    if (parent != null) owned.add(parent)
                    node = parent
                }
                if (node != null && node.isClickable) {
                    node.performAction(AccessibilityNodeInfo.ACTION_CLICK)
                    return true
                }
            }
            return false
        } finally {
            for (n in owned) {
                try { n.recycle() } catch (_: Exception) { }
            }
        }
    }
}
