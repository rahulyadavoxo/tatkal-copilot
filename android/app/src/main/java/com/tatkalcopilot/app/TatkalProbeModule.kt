package com.tatkalcopilot.app

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.provider.Settings
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.ReactPackage
import org.json.JSONArray
import org.json.JSONObject
import com.facebook.react.uimanager.ViewManager

/**
 * Bridge for the Phase 0/1 automation probe: service status, settings
 * deep-links, probe reports, and the test-tap command.
 */
class TatkalProbeModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    override fun getName() = "TatkalProbe"

    private fun prefs() =
        reactContext.getSharedPreferences(TatkalAutofillService.PREFS_PROBE, 0)

    @ReactMethod
    fun isAutofillServiceEnabled(promise: Promise) {
        try {
            val enabled = Settings.Secure.getString(
                reactContext.contentResolver,
                "autofill_service"
            ) ?: ""
            promise.resolve(enabled.contains("com.tatkalcopilot.app"))
        } catch (e: Exception) {
            promise.reject("ERR", e)
        }
    }

    @ReactMethod
    fun isTapServiceEnabled(promise: Promise) {
        try {
            val enabled = Settings.Secure.getString(
                reactContext.contentResolver,
                Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES
            ) ?: ""
            // NOTE: the enabled-services string holds the flattened component
            // name (com.tatkalcopilot.app/com.tatkalcopilot.app.TatkalTapService),
            // never the manifest shorthand (.TatkalTapService) — match the class
            // name so detection works on every device.
            promise.resolve(enabled.contains("TatkalTapService"))
        } catch (e: Exception) {
            promise.reject("ERR", e)
        }
    }

    @ReactMethod
    fun openAutofillSettings() {
        // AutofillService only exists on API 26+.
        if (android.os.Build.VERSION.SDK_INT < android.os.Build.VERSION_CODES.O) {
            return
        }
        val intent = Intent(Settings.ACTION_REQUEST_SET_AUTOFILL_SERVICE).apply {
            data = Uri.parse("package:com.tatkalcopilot.app")
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        reactContext.startActivity(intent)
    }

    @ReactMethod
    fun openAccessibilitySettings() {
        val intent = Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS).apply {
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        reactContext.startActivity(intent)
    }

    /**
     * Opens a URL in a real browser app (not a Custom Tab, not the WebView).
     * Enumerates installed https-handlers via PackageManager (visible through
     * the manifest <queries>), prefers a real Chrome build, then any known
     * browser. Never fires a generic intent, so no app-chooser popup appears.
     * Returns "chrome:<pkg>" / "browser:<pkg>"; rejects with NO_BROWSER when
     * nothing suitable is installed.
     * The automation services gate on real-browser packages, so the full
     * browser app is the only target that guarantees both the fill service
     * and the tap service engage.
     */
    @ReactMethod
    fun openInChromeApp(url: String, promise: Promise) {
        try {
            val targetPkg = findBrowserPackage()
            if (targetPkg == null) {
                promise.reject("NO_BROWSER", "No supported browser installed")
                return
            }
            val explicit = Intent(Intent.ACTION_VIEW, Uri.parse(url)).apply {
                setPackage(targetPkg)
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            reactContext.startActivity(explicit)
            val kind = if (CHROME_PACKAGES.contains(targetPkg)) "chrome" else "browser"
            promise.resolve("$kind:$targetPkg")
        } catch (e: Exception) {
            promise.reject("ERR", e)
        }
    }

    /** Master automation kill-switch: read the toggle. Defaults to ON. */
    @ReactMethod
    fun isAutomationEnabled(promise: Promise) {
        try {
            val p = reactContext.getSharedPreferences(
                TatkalTapService.PREFS_AUTOMATION, Context.MODE_PRIVATE
            )
            promise.resolve(p.getBoolean(TatkalTapService.KEY_AUTOMATION_ENABLED, true))
        } catch (e: Exception) {
            promise.reject("ERR", e)
        }
    }

    /** Master automation kill-switch: set the toggle. */
    @ReactMethod
    fun setAutomationEnabled(on: Boolean, promise: Promise) {
        try {
            reactContext.getSharedPreferences(
                TatkalTapService.PREFS_AUTOMATION, Context.MODE_PRIVATE
            ).edit().putBoolean(TatkalTapService.KEY_AUTOMATION_ENABLED, on).apply()
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("ERR", e)
        }
    }

    /** Probe helper: which https-handlers the app can see (for diagnostics). */
    @ReactMethod
    fun getBrowserInfo(promise: Promise) {
        try {
            val pm = reactContext.packageManager
            val viewIntent = Intent(Intent.ACTION_VIEW, Uri.parse("https://www.irctc.co.in")).apply {
                addCategory(Intent.CATEGORY_BROWSABLE)
            }
            val handlers = pm.queryIntentActivities(viewIntent, 0)
                .map { it.activityInfo.packageName }
                .distinct()
                .sorted()
            val o = JSONObject()
            o.put("handlers", JSONArray(handlers))
            o.put("picked", findBrowserPackage() ?: JSONObject.NULL)
            promise.resolve(o.toString())
        } catch (e: Exception) {
            promise.reject("ERR", e)
        }
    }

    private fun findBrowserPackage(): String? {
        val pm = reactContext.packageManager
        val viewIntent = Intent(Intent.ACTION_VIEW, Uri.parse("https://www.irctc.co.in")).apply {
            addCategory(Intent.CATEGORY_BROWSABLE)
        }
        val handlers = try {
            pm.queryIntentActivities(viewIntent, 0)
                .map { it.activityInfo.packageName }
                .distinct()
        } catch (_: Exception) { emptyList() }
        return CHROME_PACKAGES.firstOrNull { it in handlers }
            ?: KNOWN_BROWSERS.firstOrNull { it in handlers }
    }

    companion object {
        private val CHROME_PACKAGES = listOf(
            "com.android.chrome",
            "com.chrome.beta",
            "com.chrome.dev",
            "com.chrome.canary"
        )
        private val KNOWN_BROWSERS = listOf(
            "com.android.chrome",
            "com.chrome.beta",
            "com.chrome.dev",
            "com.chrome.canary",
            "org.mozilla.firefox",
            "org.mozilla.firefox_beta",
            "org.mozilla.fenix",
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

    @ReactMethod
    fun getProbeReport(promise: Promise) {
        try {
            val p = prefs()
            val o = JSONObject()
            o.put("autofillDump", p.getString(TatkalAutofillService.KEY_FIELD_DUMP, null) ?: "")
            o.put("autofillHost", p.getString(TatkalAutofillService.KEY_LAST_HOST, "") ?: "")
            o.put("fillStatus", p.getString(TatkalAutofillService.KEY_FILL_STATUS, "") ?: "")
            o.put("tapDump", p.getString(TatkalTapService.KEY_CLICKABLE_DUMP, null) ?: "")
            o.put("tapResult", p.getString(TatkalTapService.KEY_TAP_RESULT, "") ?: "")
            o.put("engineStatus", p.getString(TatkalTapService.KEY_ENGINE_STATUS, "") ?: "")
            promise.resolve(o.toString())
        } catch (e: Exception) {
            promise.reject("ERR", e)
        }
    }

    @ReactMethod
    fun requestTap(target: String, promise: Promise) {
        try {
            prefs().edit()
                .putString(TatkalTapService.KEY_TAP_TARGET, target)
                .remove(TatkalTapService.KEY_TAP_RESULT)
                .apply()
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("ERR", e)
        }
    }

    @ReactMethod
    fun clearProbeData(promise: Promise) {
        try {
            prefs().edit().clear().apply()
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("ERR", e)
        }
    }

    /**
     * Writes the OTA-updatable automation data (field map, choreography map,
     * fill values) to encrypted prefs for the native services. Called by the
     * JS layer whenever trip/passenger data changes and on every app start.
     * Never accepts credential keys — they are stripped here as well as in
     * the services themselves (defense in depth).
     */
    @ReactMethod
    fun writeAutofillData(fieldMap: String, choreoMap: String, fillData: String, promise: Promise) {
        try {
            val scrubbed = JSONObject(fillData)
            for (k in listOf("credentials.username", "credentials.password")) {
                scrubbed.remove(k)
            }
            val masterKey = MasterKey.Builder(reactContext)
                .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
                .build()
            val secure = EncryptedSharedPreferences.create(
                reactContext,
                TatkalAutofillService.PREFS_SECURE,
                masterKey,
                EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
                EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
            )
            secure.edit()
                .putString(TatkalAutofillService.KEY_FIELD_MAP, fieldMap)
                .putString(TatkalTapService.KEY_CHOREO_MAP, choreoMap)
                .putString(TatkalAutofillService.KEY_FILL_DATA, scrubbed.toString())
                .apply()
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("ERR", e)
        }
    }
}

class TatkalProbePackage : ReactPackage {
    override fun createNativeModules(
        reactContext: ReactApplicationContext
    ) = listOf(TatkalProbeModule(reactContext))

    override fun createViewManagers(
        reactContext: ReactApplicationContext
    ): List<ViewManager<*, *>> = emptyList()
}
