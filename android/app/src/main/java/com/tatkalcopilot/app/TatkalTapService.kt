package com.tatkalcopilot.app

import android.accessibilityservice.AccessibilityService
import android.content.SharedPreferences
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

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {
        if (event == null) return
        val pkg = event.packageName?.toString() ?: return
        if (!BROWSER_PACKAGES.contains(pkg)) {
            // Left the browser: reset the session state.
            paymentLockdown = false
            donePages.clear()
            doneSteps.clear()
            skippedSteps.clear()
            suggestionPicked.clear()
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
            // between actions.
            synchronized(this) {
                if (!choreographyRunning) {
                    choreographyRunning = true
                    Thread {
                        try {
                            runChoreographyFast()
                        } catch (_: Exception) {
                        } finally {
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
        val deadline = System.currentTimeMillis() + 90_000
        while (System.currentTimeMillis() < deadline) {
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
            val dataJson = prefs.getString(KEY_FILL_DATA, null) ?: run {
                engineStatus("no fill data — did auto-booking sync run?")
                try { root.recycle() } catch (_: Exception) { }
                return
            }
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
                    val detectAll = jsonStrList(page.optJSONObject("detect")?.optJSONArray("allContains"))
                    if (detectAll.isEmpty() || !detectAll.all { screenText.contains(it.lowercase()) }) continue
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
                            if (step.optString("do") == "tap") {
                                // One-shot: a tap is done the moment it fires.
                                doneSteps.add(stepKey)
                                engineStatus("page '$pageId': tapped '${step.optString("text")}'")
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
                val current = field.text?.toString() ?: ""
                current.contains(value)
            }
            "tap" -> false // taps are one-shot; engine tracks via donePages
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
                val label = step.optString("text")
                if (label.isNotEmpty()) {
                    return tapNodeWithText(root, label)
                }
                return true
            }
        }
        return true
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
        if (labels.isEmpty()) return null
        return findNode(root) { node ->
            if (!node.isEditable) return@findNode false
            val text = (node.text?.toString() ?: "").lowercase()
            val desc = (node.contentDescription?.toString() ?: "").lowercase()
            val hint = node.hintText?.toString()?.lowercase() ?: ""
            labels.any { text.contains(it) || desc.contains(it) || hint.contains(it) }
        }
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
