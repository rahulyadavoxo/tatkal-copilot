package com.tatkalcopilot.app

import android.app.assist.AssistStructure
import android.content.SharedPreferences
import android.os.CancellationSignal
import android.service.autofill.AutofillService
import android.service.autofill.Dataset
import android.service.autofill.FillCallback
import android.service.autofill.FillRequest
import android.service.autofill.FillResponse
import android.service.autofill.SaveCallback
import android.service.autofill.SaveRequest
import android.view.autofill.AutofillValue
import android.widget.RemoteViews
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import org.json.JSONArray
import org.json.JSONObject

/**
 * Fills IRCTC booking fields in real Chrome.
 *
 * Design (see roadmap v2):
 * - Scope gate: acts ONLY when the requesting activity is a real browser and
 *   the page's web domain is irctc.co.in. Anywhere else: silent.
 * - Credential boundary: username/password fields are recognized and then
 *   deliberately skipped. No code path can return a credential.
 * - The field map (which pattern = which data key) comes from the app's
 *   JavaScript layer via encrypted prefs, so IRCTC redesigns are fixed with
 *   an OTA update, not a new APK.
 * - Conservative: a field that doesn't clearly match offers nothing.
 */
class TatkalAutofillService : AutofillService() {

    companion object {
        const val PREFS_PROBE = "tatkal_probe"
        const val PREFS_SECURE = "tatkal_autofill"
        const val KEY_FIELD_DUMP = "autofill_field_dump"
        const val KEY_LAST_HOST = "autofill_last_host"
        const val KEY_FIELD_MAP = "field_map"
        const val KEY_FILL_DATA = "fill_data"

        private val BROWSER_PACKAGES = setOf(
            "com.android.chrome",
            "com.chrome.beta",
            "com.chrome.dev",
            "org.mozilla.firefox",
            "com.brave.browser"
        )
        private const val IRCTC_DOMAIN = "irctc.co.in"
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

    override fun onFillRequest(
        request: FillRequest,
        cancellationSignal: CancellationSignal,
        callback: FillCallback
    ) {
        try {
            val context = request.fillContexts.lastOrNull() ?: run {
                callback.onSuccess(null); return
            }
            val structure = context.structure

            // Scope gate: real browser + IRCTC domain, or stay silent.
            val pkg = structure.activityComponent?.packageName ?: ""
            if (!BROWSER_PACKAGES.contains(pkg)) {
                callback.onSuccess(null); return
            }
            val host = findWebDomain(structure) ?: ""
            if (!host.endsWith(IRCTC_DOMAIN)) {
                callback.onSuccess(null); return
            }

            // Probe diagnostics (structure only, never values).
            try {
                val dump = dumpStructure(structure, host)
                probePrefs().edit()
                    .putString(KEY_FIELD_DUMP, dump.toString())
                    .putString(KEY_LAST_HOST, host)
                    .apply()
            } catch (_: Exception) { }

            // Load the OTA-updatable field map and the fill data.
            val prefs = securePrefs()
            val mapJson = prefs.getString(KEY_FIELD_MAP, null) ?: run {
                callback.onSuccess(null); return
            }
            val dataJson = prefs.getString(KEY_FILL_DATA, null) ?: run {
                callback.onSuccess(null); return
            }
            val fieldMap = JSONObject(mapJson)
            val fillData = JSONObject(dataJson)

            val response = buildFillResponse(structure, fieldMap, fillData, pkg)
            callback.onSuccess(response)
        } catch (_: Exception) {
            // Never break the autofill flow; worst case we offer nothing.
            try { callback.onSuccess(null) } catch (_: Exception) { }
        }
    }

    override fun onSaveRequest(request: SaveRequest, callback: SaveCallback) {
        // We never harvest anything from pages. Ever.
        callback.onSuccess()
    }

    // ------------------------------------------------------------------
    // Matching
    // ------------------------------------------------------------------

    private data class FieldRule(
        val dataKey: String,
        val label: String,
        val hints: List<String>,
        val idContains: List<String>,
        val labelContains: List<String>
    )

    private fun parseFieldMap(mapJson: JSONObject): List<FieldRule> {
        val rules = mutableListOf<FieldRule>()
        val arr = mapJson.optJSONArray("fields") ?: return rules
        for (i in 0 until arr.length()) {
            val o = arr.optJSONObject(i) ?: continue
            val key = o.optString("dataKey")
            if (key.isEmpty()) continue
            // Credentials are never fillable, even if a map tried to add them.
            if (key == "credentials.username" || key == "credentials.password") continue
            val match = o.optJSONObject("match") ?: JSONObject()
            rules.add(
                FieldRule(
                    dataKey = key,
                    label = o.optString("label", key),
                    hints = jsonStrList(match.optJSONArray("hints")),
                    idContains = jsonStrList(match.optJSONArray("idContains")),
                    labelContains = jsonStrList(match.optJSONArray("labelContains"))
                )
            )
        }
        return rules
    }

    private fun jsonStrList(arr: JSONArray?): List<String> {
        if (arr == null) return emptyList()
        return (0 until arr.length()).mapNotNull {
            arr.optString(it).takeIf { s -> s.isNotEmpty() }
        }
    }

    private fun buildFillResponse(
        structure: AssistStructure,
        fieldMap: JSONObject,
        fillData: JSONObject,
        pkg: String
    ): FillResponse? {
        val rules = parseFieldMap(fieldMap)
        if (rules.isEmpty()) return null
        val response = FillResponse.Builder()
        var added = 0
        for (i in 0 until structure.windowNodeCount) {
            val root = structure.getWindowNodeAt(i)?.rootViewNode ?: continue
            added += matchNode(root, rules, fillData, response, pkg)
        }
        return if (added > 0) response.build() else null
    }

    private fun matchNode(
        node: AssistStructure.ViewNode,
        rules: List<FieldRule>,
        fillData: JSONObject,
        response: FillResponse.Builder,
        pkg: String
    ): Int {
        var added = 0
        val autofillId = node.autofillId
        if (autofillId != null && node.autofillType != 0) {
            val rule = rules.firstOrNull { ruleMatches(it, node) }
            if (rule != null) {
                val value = fillData.optString(rule.dataKey, "")
                if (value.isNotEmpty()) {
                    val presentation = RemoteViews(packageName, android.R.layout.simple_list_item_1)
                    presentation.setTextViewText(android.R.id.text1, rule.label)
                    val dataset = Dataset.Builder(presentation)
                        .setValue(autofillId, AutofillValue.forText(value))
                        .build()
                    response.addDataset(dataset)
                    added++
                }
            }
        }
        for (i in 0 until node.childCount) {
            added += matchNode(node.getChildAt(i) ?: continue, rules, fillData, response, pkg)
        }
        return added
    }

    private fun ruleMatches(rule: FieldRule, node: AssistStructure.ViewNode): Boolean {
        val hints = (node.autofillHints ?: emptyArray()).map { it.lowercase() }
        val idEntry = (node.idEntry ?: "").lowercase()
        val hint = (node.hint ?: "").lowercase()
        if (rule.hints.any { h -> hints.any { it.contains(h.lowercase()) } }) return true
        if (rule.idContains.any { idEntry.contains(it.lowercase()) }) return true
        if (rule.labelContains.any { hint.contains(it.lowercase()) }) return true
        return false
    }

    // ------------------------------------------------------------------
    // Structure helpers (also feed the probe diagnostics)
    // ------------------------------------------------------------------

    private fun findWebDomain(structure: AssistStructure): String? {
        for (i in 0 until structure.windowNodeCount) {
            val root = structure.getWindowNodeAt(i)?.rootViewNode ?: continue
            val d = findWebDomain(root)
            if (!d.isNullOrEmpty()) return d
        }
        return null
    }

    private fun findWebDomain(node: AssistStructure.ViewNode): String? {
        val d = node.webDomain
        if (!d.isNullOrEmpty()) return d
        for (i in 0 until node.childCount) {
            val found = findWebDomain(node.getChildAt(i) ?: continue)
            if (!found.isNullOrEmpty()) return found
        }
        return null
    }

    private fun dumpStructure(structure: AssistStructure, host: String): JSONObject {
        val out = JSONObject()
        val fields = JSONArray()
        for (i in 0 until structure.windowNodeCount) {
            val root = structure.getWindowNodeAt(i)?.rootViewNode ?: continue
            walkNode(root, fields)
        }
        out.put("host", host)
        out.put("fieldCount", fields.length())
        out.put("fields", fields)
        out.put("ts", System.currentTimeMillis())
        return out
    }

    private fun walkNode(node: AssistStructure.ViewNode, fields: JSONArray) {
        val hints = node.autofillHints
        val idEntry = node.idEntry
        val hint = node.hint
        val className = node.className
        if ((hints != null && hints.isNotEmpty()) ||
            !idEntry.isNullOrEmpty() ||
            node.autofillType != 0 ||
            className?.contains("EditText") == true
        ) {
            val f = JSONObject()
            f.put("hints", JSONArray(hints?.toList() ?: emptyList()))
            f.put("idEntry", idEntry ?: "")
            f.put("hint", hint ?: "")
            f.put("className", className ?: "")
            // Values deliberately never captured.
            fields.put(f)
        }
        for (i in 0 until node.childCount) {
            walkNode(node.getChildAt(i) ?: continue, fields)
        }
    }
}
