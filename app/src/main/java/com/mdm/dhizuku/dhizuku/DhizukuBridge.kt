package com.mdm.dhizuku.dhizuku

import android.annotation.SuppressLint
import android.app.PendingIntent
import android.app.admin.DevicePolicyManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInstaller
import android.content.pm.PackageManager
import android.os.Build
import android.os.IBinder
import android.os.UserManager
import android.util.Log
import com.mdm.dhizuku.receiver.ApkInstallReceiver
import com.rosan.dhizuku.api.Dhizuku
import com.rosan.dhizuku.api.DhizukuRequestPermissionListener
import org.lsposed.hiddenapibypass.HiddenApiBypass
import java.io.File

/**
 * Wraps Android's DevicePolicyManager and PackageInstaller system binders using Dhizuku
 * so a standard non-root app can execute Device Owner commands without provisioning a custom DPC.
 */
object DhizukuBridge {
    private const val TAG = "DhizukuBridge"
    const val PKG_DHIZUKU = "com.rosan.dhizuku"

    private val restrictionKeyMap = mapOf(
        // DISALLOW_CAMERA ("no_camera") is not exposed by the public Android SDK stubs;
        // setUserRestriction falls back to passing "no_camera" directly.
        "no_usb_file_transfer" to UserManager.DISALLOW_USB_FILE_TRANSFER,
        "no_mount_physical_media" to UserManager.DISALLOW_MOUNT_PHYSICAL_MEDIA,
        "no_safe_boot" to UserManager.DISALLOW_SAFE_BOOT,
        "no_factory_reset" to UserManager.DISALLOW_FACTORY_RESET,
        "no_debugging_features" to UserManager.DISALLOW_DEBUGGING_FEATURES,
        "no_install_unknown_sources" to UserManager.DISALLOW_INSTALL_UNKNOWN_SOURCES,
        "no_add_user" to UserManager.DISALLOW_ADD_USER
    )

    fun init(context: Context): Boolean {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            runCatching { HiddenApiBypass.addHiddenApiExemptions("") }
        }
        return try {
            Dhizuku.init(context)
        } catch (e: Exception) {
            Log.e(TAG, "Dhizuku.init failed", e)
            false
        }
    }

    fun isPermissionGranted(): Boolean {
        return try {
            Dhizuku.isPermissionGranted()
        } catch (e: Exception) {
            false
        }
    }

    fun requestPermission(context: Context, onResult: (Boolean) -> Unit) {
        if (!init(context)) {
            onResult(false)
            return
        }
        if (isPermissionGranted()) {
            onResult(true)
            return
        }
        try {
            Dhizuku.requestPermission(object : DhizukuRequestPermissionListener() {
                override fun onRequestPermission(grantResult: Int) {
                    val granted = grantResult == PackageManager.PERMISSION_GRANTED
                    onResult(granted)
                }
            })
        } catch (e: Exception) {
            Log.e(TAG, "Dhizuku.requestPermission failed", e)
            onResult(false)
        }
    }

    fun openDhizukuApp(context: Context): Boolean {
        val intent = context.packageManager.getLaunchIntentForPackage(PKG_DHIZUKU) ?: return false
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        return runCatching {
            context.startActivity(intent)
            true
        }.getOrDefault(false)
    }

    fun getOwnerComponent(): ComponentName? {
        return try {
            Dhizuku.getOwnerComponent()
        } catch (e: Exception) {
            null
        }
    }

    /**
     * Creates a DevicePolicyManager instance scoped to Dhizuku's package context
     * and replaces its internal mService binder with Dhizuku.binderWrapper(oldBinder).
     */
    @SuppressLint("PrivateApi", "SoonBlockedPrivateApi")
    fun getDevicePolicyManager(appContext: Context): DevicePolicyManager? {
        if (!init(appContext) || !isPermissionGranted()) return null
        return try {
            val ownerComponent = Dhizuku.getOwnerComponent() ?: return null
            val targetContext = runCatching {
                appContext.createPackageContext(
                    ownerComponent.packageName,
                    Context.CONTEXT_IGNORE_SECURITY
                )
            }.getOrDefault(appContext)

            val dpm = targetContext.getSystemService(Context.DEVICE_POLICY_SERVICE) as DevicePolicyManager
            val field = dpm.javaClass.getDeclaredField("mService")
            field.isAccessible = true
            val oldInterface = field.get(dpm) ?: return null

            val asBinder = oldInterface.javaClass.getMethod("asBinder")
            val oldBinder = asBinder.invoke(oldInterface) as IBinder
            val wrappedBinder = Dhizuku.binderWrapper(oldBinder)

            val stubClass = Class.forName("android.app.admin.IDevicePolicyManager\$Stub")
            val asInterface = stubClass.getMethod("asInterface", IBinder::class.java)
            val newInterface = asInterface.invoke(null, wrappedBinder)
            field.set(dpm, newInterface)
            dpm
        } catch (e: Exception) {
            Log.e(TAG, "Failed to wrap DevicePolicyManager binder via Dhizuku", e)
            null
        }
    }

    fun setApplicationHidden(context: Context, packageName: String, hidden: Boolean): Result<Boolean> {
        return runCatching {
            val dpm = getDevicePolicyManager(context)
                ?: error("Dhizuku DevicePolicyManager unavailable")
            val admin = getOwnerComponent()
                ?: error("Dhizuku owner ComponentName unavailable")
            dpm.setApplicationHidden(admin, packageName, hidden)
        }
    }

    fun setUserRestriction(context: Context, keyOrAlias: String, enabled: Boolean): Result<Unit> {
        return runCatching {
            val dpm = getDevicePolicyManager(context)
                ?: error("Dhizuku DevicePolicyManager unavailable")
            val admin = getOwnerComponent()
                ?: error("Dhizuku owner ComponentName unavailable")
            val restriction = restrictionKeyMap[keyOrAlias] ?: keyOrAlias
            if (restriction == "no_camera") {
                runCatching { dpm.setCameraDisabled(admin, enabled) }
            }
            if (enabled) {
                dpm.addUserRestriction(admin, restriction)
            } else {
                dpm.clearUserRestriction(admin, restriction)
            }
        }
    }

    fun configureKioskPolicies(
        context: Context,
        enabled: Boolean,
        packages: List<String>,
        featureNames: List<String>
    ): Result<Unit> {
        return runCatching {
            val dpm = getDevicePolicyManager(context)
                ?: error("Dhizuku DevicePolicyManager unavailable")
            val admin = getOwnerComponent()
                ?: error("Dhizuku owner ComponentName unavailable")

            if (!enabled) {
                dpm.setLockTaskPackages(admin, emptyArray())
                return@runCatching
            }

            dpm.setLockTaskPackages(admin, packages.toTypedArray())

            var flags = DevicePolicyManager.LOCK_TASK_FEATURE_NONE
            featureNames.forEach { feat ->
                when (feat.lowercase()) {
                    "system_info" -> flags = flags or DevicePolicyManager.LOCK_TASK_FEATURE_SYSTEM_INFO
                    "notifications" -> flags = flags or DevicePolicyManager.LOCK_TASK_FEATURE_NOTIFICATIONS
                    "home" -> flags = flags or DevicePolicyManager.LOCK_TASK_FEATURE_HOME
                    "overview" -> flags = flags or DevicePolicyManager.LOCK_TASK_FEATURE_OVERVIEW
                    "global_actions" -> flags = flags or DevicePolicyManager.LOCK_TASK_FEATURE_GLOBAL_ACTIONS
                    "keyguard" -> flags = flags or DevicePolicyManager.LOCK_TASK_FEATURE_KEYGUARD
                }
            }
            dpm.setLockTaskFeatures(admin, flags)
        }
    }

    fun lockNow(context: Context): Result<Unit> {
        return runCatching {
            val dpm = getDevicePolicyManager(context)
                ?: error("Dhizuku DevicePolicyManager unavailable")
            dpm.lockNow()
        }
    }

    fun reboot(context: Context): Result<Unit> {
        return runCatching {
            val dpm = getDevicePolicyManager(context)
                ?: error("Dhizuku DevicePolicyManager unavailable")
            val admin = getOwnerComponent()
                ?: error("Dhizuku owner ComponentName unavailable")
            dpm.reboot(admin)
        }
    }

    /**
     * Silently installs an APK file using PackageInstaller wrapped with Dhizuku's binder proxy.
     */
    @SuppressLint("PrivateApi")
    fun installApkSilently(context: Context, apkFile: File, packageName: String): Result<Unit> {
        return runCatching {
            require(apkFile.exists() && apkFile.length() > 0L) { "APK file missing or empty" }
            val ownerComponent = getOwnerComponent()
                ?: error("Dhizuku owner ComponentName unavailable")
            val dhizukuContext = runCatching {
                context.createPackageContext(ownerComponent.packageName, Context.CONTEXT_IGNORE_SECURITY)
            }.getOrDefault(context)

            val packageInstaller = dhizukuContext.packageManager.packageInstaller
            runCatching {
                val mInstallerField = packageInstaller.javaClass.getDeclaredField("mInstaller")
                mInstallerField.isAccessible = true
                val oldInstaller = mInstallerField.get(packageInstaller)
                if (oldInstaller != null) {
                    val oldBinder = oldInstaller.javaClass.getMethod("asBinder").invoke(oldInstaller) as IBinder
                    val wrappedBinder = Dhizuku.binderWrapper(oldBinder)
                    val stubClass = Class.forName("android.content.pm.IPackageInstaller\$Stub")
                    val newInstaller = stubClass.getMethod("asInterface", IBinder::class.java)
                        .invoke(null, wrappedBinder)
                    mInstallerField.set(packageInstaller, newInstaller)
                }
            }

            val params = PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL)
            params.setAppPackageName(packageName)
            val sessionId = packageInstaller.createSession(params)
            val session = packageInstaller.openSession(sessionId)

            runCatching {
                val mSessionField = session.javaClass.getDeclaredField("mSession")
                mSessionField.isAccessible = true
                val oldSession = mSessionField.get(session)
                if (oldSession != null) {
                    val oldBinder = oldSession.javaClass.getMethod("asBinder").invoke(oldSession) as IBinder
                    val wrappedBinder = Dhizuku.binderWrapper(oldBinder)
                    val stubClass = Class.forName("android.content.pm.IPackageInstallerSession\$Stub")
                    val newSession = stubClass.getMethod("asInterface", IBinder::class.java)
                        .invoke(null, wrappedBinder)
                    mSessionField.set(session, newSession)
                }
            }

            apkFile.inputStream().use { input ->
                session.openWrite("base.apk", 0, apkFile.length()).use { output ->
                    input.copyTo(output)
                    session.fsync(output)
                }
            }

            val intent = Intent(context, ApkInstallReceiver::class.java).apply {
                putExtra("pkg", packageName)
            }
            val flags = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_MUTABLE
            } else {
                PendingIntent.FLAG_UPDATE_CURRENT
            }
            val pendingIntent = PendingIntent.getBroadcast(context, sessionId, intent, flags)
            session.commit(pendingIntent.intentSender)
            session.close()
        }
    }
}
