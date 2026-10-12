package com.tatkalcopilot.app

import android.app.NotificationManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/**
 * Instant kill-switch for the booking automation. Fired from the STOP
 * action on the persistent "auto-booking running" notification. Turns the
 * master automation toggle OFF and dismisses the notification. The tap
 * service checks the toggle on every loop iteration and halts immediately.
 */
class StopAutomationReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        try {
            context.getSharedPreferences(
                TatkalTapService.PREFS_AUTOMATION,
                Context.MODE_PRIVATE
            ).edit().putBoolean(TatkalTapService.KEY_AUTOMATION_ENABLED, false).apply()
        } catch (_: Exception) { }
        try {
            val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            nm.cancel(TatkalTapService.NOTIF_ID)
        } catch (_: Exception) { }
    }
}
