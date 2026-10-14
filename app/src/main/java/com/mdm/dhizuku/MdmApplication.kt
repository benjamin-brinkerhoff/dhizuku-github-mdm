package com.mdm.dhizuku

import android.app.Application
import android.os.Build
import android.util.Log
import com.mdm.dhizuku.dhizuku.DhizukuBridge
import com.mdm.dhizuku.sync.PolicySyncScheduler
import org.lsposed.hiddenapibypass.HiddenApiBypass

class MdmApplication : Application() {
    override fun onCreate() {
        super.onCreate()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            runCatching {
                HiddenApiBypass.addHiddenApiExemptions("")
            }.onFailure {
                Log.w("MdmApplication", "HiddenApiBypass init warning: ${it.message}")
            }
        }
        DhizukuBridge.init(this)
        PolicySyncScheduler.schedulePeriodicSync(this)
    }
}
