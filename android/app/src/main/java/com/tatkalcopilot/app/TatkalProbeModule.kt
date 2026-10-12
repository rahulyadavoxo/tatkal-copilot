package com.tatkalcopilot.app

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
import com.facebook.react.uimanager.ViewManager
import org.json.JSONObject

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
            promise.resolve(enabled.contains("com.tatkalcopilot.app/.TatkalTapService"))
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

    @ReactMethod
    fun getProbeReport(promise: Promise) {
        try {
            val p = prefs()
            val o = JSONObject()
            o.put("autofillDump", p.getString(TatkalAutofillService.KEY_FIELD_DUMP, null) ?: "")
            o.put("autofillHost", p.getString(TatkalAutofillService.KEY_LAST_HOST, "") ?: "")
            o.put("tapDump", p.getString(TatkalTapService.KEY_CLICKABLE_DUMP, null) ?: "")
            o.put("tapResult", p.getString(TatkalTapService.KEY_TAP_RESULT, "") ?: "")
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
                TatkalAutofillService.PREFS_SECURE,
                masterKey,
                reactContext,
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
