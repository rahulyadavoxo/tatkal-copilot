package com.tatkalcopilot.app

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.service.quicksettings.Tile
import android.service.quicksettings.TileService
import androidx.annotation.RequiresApi

/**
 * Quick Settings tile for one-tap auto-booking from anywhere on the phone.
 * Tap the tile: if automation is ON and trip data was synced, it opens the
 * IRCTC train-search page in the real browser app, where the fill + tap
 * services take over. The tile reflects the master automation toggle.
 */
@RequiresApi(Build.VERSION_CODES.N)
class TatkalTileService : TileService() {

    override fun onStartListening() {
        super.onStartListening()
        updateTileState(isSessionRunning())
    }

    override fun onClick() {
        super.onClick()
        // Tap = start booking (Chrome opens), unless a booking run is in
        // progress right now, in which case tap = stop. Bright tile means a
        // run is active. This avoids the old pure toggle, where a leftover
        // ON state made the next tap silently switch everything OFF.
        if (isSessionRunning()) {
            setAutomationEnabled(false)
            setSessionActive(false)
            updateTileState(false)
            toast("Auto-booking stopped")
        } else {
            if (!isTapServiceEnabled()) {
                // Nothing can be automated until the accessibility service
                // is on: send the user straight to the switch.
                toast("Turn on 'Tatkal Copilot' in Accessibility first")
                try {
                    launch(Intent(android.provider.Settings.ACTION_ACCESSIBILITY_SETTINGS))
                } catch (_: Exception) { }
                return
            }
            setAutomationEnabled(true)
            markNewRun()
            updateTileState(true)
            toast("Auto-booking ON — opening Chrome")
            openChrome()
        }
    }

    private fun isTapServiceEnabled(): Boolean = try {
        val enabled = android.provider.Settings.Secure.getString(
            contentResolver,
            android.provider.Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES
        ) ?: ""
        enabled.split(':').any {
            it.startsWith("$packageName/") && it.endsWith("TatkalTapService")
        }
    } catch (_: Exception) { true }

    /** Tells the tap service this is a fresh run, so it forgets steps done in an earlier one. */
    private fun markNewRun() {
        try {
            getSharedPreferences(TatkalTapService.PREFS_AUTOMATION, Context.MODE_PRIVATE)
                .edit().putLong(TatkalTapService.KEY_RUN_REQUESTED_TS, System.currentTimeMillis()).apply()
        } catch (_: Exception) { }
    }

    private fun toast(msg: String) {
        try {
            android.widget.Toast.makeText(this, msg, android.widget.Toast.LENGTH_SHORT).show()
        } catch (_: Exception) { }
    }

    /** A run counts as live only if its heartbeat is recent (process deaths leave stale flags). */
    private fun isSessionRunning(): Boolean = try {
        val p = getSharedPreferences(TatkalTapService.PREFS_AUTOMATION, Context.MODE_PRIVATE)
        p.getBoolean(TatkalTapService.KEY_AUTOMATION_ENABLED, false) &&
            p.getBoolean(TatkalTapService.KEY_SESSION_ACTIVE, false) &&
            System.currentTimeMillis() - p.getLong(TatkalTapService.KEY_SESSION_TS, 0L) < 15_000L
    } catch (_: Exception) { false }

    private fun openChrome() {
        val targetPkg = findBrowserPackage()
        if (targetPkg == null) {
            // No browser: open the app so the user sees the guidance.
            val appIntent = packageManager.getLaunchIntentForPackage(packageName)
            if (appIntent != null) {
                launch(appIntent)
            }
            return
        }
        val open = Intent(Intent.ACTION_VIEW, Uri.parse(IRCTC_TRAIN_SEARCH_URL)).apply {
            setPackage(targetPkg)
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        try {
            launch(open)
        } catch (e: Exception) {
            try {
                android.widget.Toast.makeText(this, "Couldn't open browser: ${e.javaClass.simpleName}", android.widget.Toast.LENGTH_LONG).show()
            } catch (_: Exception) { }
        }
    }

    /**
     * Android 14+ (targetSdk 34) throws UnsupportedOperationException for
     * startActivityAndCollapse(Intent); it requires a PendingIntent.
     */
    private fun launch(intent: Intent) {
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        if (Build.VERSION.SDK_INT >= 34) {
            val pi = android.app.PendingIntent.getActivity(
                this, 0, intent,
                android.app.PendingIntent.FLAG_IMMUTABLE or
                    android.app.PendingIntent.FLAG_UPDATE_CURRENT
            )
            startActivityAndCollapse(pi)
        } else {
            @Suppress("DEPRECATION")
            startActivityAndCollapse(intent)
        }
    }

    private fun updateTileState(on: Boolean) {
        val tile = qsTile ?: return
        tile.state = if (on) Tile.STATE_ACTIVE else Tile.STATE_INACTIVE
        tile.label = "Tatkal auto-book"
        tile.updateTile()
    }

    private fun setAutomationEnabled(on: Boolean) {
        try {
            getSharedPreferences(
                TatkalTapService.PREFS_AUTOMATION,
                Context.MODE_PRIVATE
            ).edit().putBoolean(TatkalTapService.KEY_AUTOMATION_ENABLED, on).apply()
        } catch (_: Exception) { }
    }

    private fun setSessionActive(active: Boolean) {
        try {
            getSharedPreferences(
                TatkalTapService.PREFS_AUTOMATION,
                Context.MODE_PRIVATE
            ).edit().putBoolean(TatkalTapService.KEY_SESSION_ACTIVE, active).apply()
        } catch (_: Exception) { }
    }

    private fun isAutomationEnabled(): Boolean = try {
        getSharedPreferences(
            TatkalTapService.PREFS_AUTOMATION,
            Context.MODE_PRIVATE
        ).getBoolean(TatkalTapService.KEY_AUTOMATION_ENABLED, false)
    } catch (_: Exception) { false }

    private fun findBrowserPackage(): String? {
        val pm = packageManager
        val viewIntent = Intent(
            Intent.ACTION_VIEW,
            Uri.parse("https://www.irctc.co.in")
        ).apply { addCategory(Intent.CATEGORY_BROWSABLE) }
        val handlers = try {
            pm.queryIntentActivities(viewIntent, 0)
                .map { it.activityInfo.packageName }
                .distinct()
        } catch (_: Exception) { emptyList() }
        return CHROME_PACKAGES.firstOrNull { it in handlers }
            ?: KNOWN_BROWSERS.firstOrNull { it in handlers }
    }

    companion object {
        const val IRCTC_TRAIN_SEARCH_URL = "https://www.irctc.co.in/nget/train-search"
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
}
