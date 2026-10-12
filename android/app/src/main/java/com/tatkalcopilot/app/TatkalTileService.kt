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
        updateTileState(isAutomationEnabled())
    }

    override fun onClick() {
        super.onClick()
        // The tile is a proper toggle: tap to arm + start, tap again to
        // disarm + halt. This is the one-tap kill switch from anywhere.
        if (isAutomationEnabled()) {
            setAutomationEnabled(false)
            updateTileState(false)
            return
        }
        setAutomationEnabled(true)
        updateTileState(true)
        val targetPkg = findBrowserPackage()
        if (targetPkg == null) {
            // No browser: open the app so the user sees the guidance.
            val launch = packageManager.getLaunchIntentForPackage(packageName)
            if (launch != null) {
                launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                startActivityAndCollapse(launch)
            }
            return
        }
        val open = Intent(Intent.ACTION_VIEW, Uri.parse(IRCTC_TRAIN_SEARCH_URL)).apply {
            setPackage(targetPkg)
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        try {
            startActivityAndCollapse(open)
        } catch (_: Exception) {
            // Fall through: collapse only.
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

    private fun isAutomationEnabled(): Boolean = try {
        getSharedPreferences(
            TatkalTapService.PREFS_AUTOMATION,
            Context.MODE_PRIVATE
        ).getBoolean(TatkalTapService.KEY_AUTOMATION_ENABLED, true)
    } catch (_: Exception) { true }

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
