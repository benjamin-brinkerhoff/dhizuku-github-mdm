package com.mdm.dhizuku.receiver

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInstaller
import com.mdm.dhizuku.sync.PolicySyncEngine

class ApkInstallReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent?) {
        if (intent == null) return
        val status = intent.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE)
        val pkg = intent.getStringExtra("pkg") ?: "unknown"
        val msg = intent.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE) ?: ""
        if (status == PackageInstaller.STATUS_SUCCESS) {
            PolicySyncEngine.appendLog(context, "Silent install succeeded: $pkg")
        } else {
            PolicySyncEngine.appendLog(context, "Silent install status $status for $pkg: $msg")
        }
    }
}
