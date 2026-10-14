package com.mdm.dhizuku.receiver

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import com.mdm.dhizuku.sync.PolicySyncEngine
import com.mdm.dhizuku.sync.PolicySyncScheduler

class BootSyncReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent?) {
        val action = intent?.action ?: return
        if (action == Intent.ACTION_BOOT_COMPLETED || action == Intent.ACTION_MY_PACKAGE_REPLACED) {
            PolicySyncEngine.appendLog(context, "Boot/Update broadcast received; scheduling WorkManager sync.")
            PolicySyncScheduler.schedulePeriodicSync(context)
            PolicySyncScheduler.triggerImmediateSync(context)
        }
    }
}
