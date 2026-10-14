package com.mdm.dhizuku.sync

import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import com.mdm.dhizuku.dhizuku.DhizukuBridge
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

object PolicySyncEngine {
    private const val PREFS_NAME = "dhizuku_mdm_prefs"
    const val KEY_POLICY_URL = "policy_url"
    const val KEY_GITHUB_TOKEN = "github_token"
    const val KEY_LAST_CMD_ID = "last_command_id"
    const val KEY_HIDDEN_SET = "previously_hidden_packages"
    const val KEY_AUDIT_LOG = "audit_log"

    const val DEFAULT_POLICY_URL =
        "https://raw.githubusercontent.com/benjamin-brinkerhoff/dhizuku-github-mdm/main/policy.json"

    fun getPrefs(context: Context) =
        context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

    fun appendLog(context: Context, message: String) {
        val prefs = getPrefs(context)
        val ts = SimpleDateFormat("HH:mm:ss", Locale.US).format(Date())
        val existing = prefs.getString(KEY_AUDIT_LOG, "") ?: ""
        val lines = (listOf("[$ts] $message") + existing.lines().filter { it.isNotBlank() }).take(40)
        prefs.edit().putString(KEY_AUDIT_LOG, lines.joinToString("\n")).apply()
    }

    suspend fun syncNow(context: Context): Result<MdmPolicyManifest> = withContext(Dispatchers.IO) {
        runCatching {
            val prefs = getPrefs(context)
            val baseUrl = (prefs.getString(KEY_POLICY_URL, DEFAULT_POLICY_URL) ?: DEFAULT_POLICY_URL).trim()
            val token = (prefs.getString(KEY_GITHUB_TOKEN, "") ?: "").trim()

            val sep = if (baseUrl.contains("?")) "&" else "?"
            val requestUrl = "$baseUrl${sep}t=${System.currentTimeMillis()}"

            val conn = (URL(requestUrl).openConnection() as HttpURLConnection).apply {
                requestMethod = "GET"
                connectTimeout = 12_000
                readTimeout = 12_000
                setRequestProperty("Cache-Control", "no-cache")
                if (token.isNotEmpty()) {
                    setRequestProperty("Authorization", "Bearer $token")
                }
            }

            val code = conn.responseCode
            if (code !in 200..299) {
                error("HTTP $code fetching policy manifest")
            }

            val body = conn.inputStream.bufferedReader().use { it.readText() }
            val manifest = MdmPolicyManifest.fromJson(body)

            if (!DhizukuBridge.init(context) || !DhizukuBridge.isPermissionGranted()) {
                appendLog(context, "Fetched policy v${manifest.policyVersion}, but Dhizuku permission is not granted yet.")
                return@runCatching manifest
            }

            val previousHidden = (prefs.getStringSet(KEY_HIDDEN_SET, emptySet()) ?: emptySet()).toMutableSet()
            val targetHidden = manifest.hideApps.toSet()

            for (pkg in targetHidden) {
                DhizukuBridge.setApplicationHidden(context, pkg, true)
                    .onSuccess { changed ->
                        if (changed || pkg !in previousHidden) {
                            appendLog(context, "Hid package: $pkg")
                        }
                    }
                    .onFailure { appendLog(context, "Failed to hide $pkg: ${it.message}") }
            }

            val toUnhide = (previousHidden - targetHidden) union manifest.unhideApps.toSet()
            for (pkg in toUnhide) {
                DhizukuBridge.setApplicationHidden(context, pkg, false)
                    .onSuccess { changed ->
                        if (changed) appendLog(context, "Unhid package: $pkg")
                    }
                    .onFailure { appendLog(context, "Failed to unhide $pkg: ${it.message}") }
            }
            prefs.edit().putStringSet(KEY_HIDDEN_SET, targetHidden).apply()

            for ((key, enabled) in manifest.userRestrictions) {
                DhizukuBridge.setUserRestriction(context, key, enabled)
                    .onFailure { appendLog(context, "Restriction $key error: ${it.message}") }
            }

            DhizukuBridge.configureKioskPolicies(
                context = context,
                enabled = manifest.kiosk.enabled,
                packages = manifest.kiosk.lockTaskPackages,
                featureNames = manifest.kiosk.lockTaskFeatures
            ).onFailure {
                appendLog(context, "Kiosk config error: ${it.message}")
            }

            // Check & execute silent APK installs
            for (apkSpec in manifest.installApks) {
                val installedVer = getInstalledVersionCode(context, apkSpec.packageName)
                if (installedVer < apkSpec.versionCode) {
                    appendLog(context, "Downloading APK ${apkSpec.packageName} v${apkSpec.versionCode}...")
                    runCatching {
                        val tempApk = File(context.cacheDir, "${apkSpec.packageName}.apk")
                        val apkConn = (URL(apkSpec.apkUrl).openConnection() as HttpURLConnection).apply {
                            connectTimeout = 20_000
                            readTimeout = 30_000
                            if (token.isNotEmpty()) {
                                setRequestProperty("Authorization", "Bearer $token")
                            }
                        }
                        apkConn.inputStream.use { input ->
                            tempApk.outputStream().use { output -> input.copyTo(output) }
                        }
                        DhizukuBridge.installApkSilently(context, tempApk, apkSpec.packageName).getOrThrow()
                        appendLog(context, "Committed silent install for ${apkSpec.packageName}")
                    }.onFailure {
                        appendLog(context, "Silent install failed for ${apkSpec.packageName}: ${it.message}")
                    }
                }
            }

            // Check & execute silent app uninstalls
            for (pkg in manifest.uninstallApps) {
                if (getInstalledVersionCode(context, pkg) >= 0L) {
                    DhizukuBridge.uninstallPackageSilently(context, pkg)
                        .onSuccess { appendLog(context, "Committed silent uninstall for $pkg") }
                        .onFailure { appendLog(context, "Silent uninstall failed for $pkg: ${it.message}") }
                }
            }

            val lastCmdId = prefs.getString(KEY_LAST_CMD_ID, "") ?: ""
            val cmd = manifest.remoteCommands
            if (cmd.commandId.isNotEmpty() && cmd.commandId != lastCmdId) {
                prefs.edit().putString(KEY_LAST_CMD_ID, cmd.commandId).apply()
                if (cmd.lockNow) {
                    appendLog(context, "Executing remote lockNow (${cmd.commandId})")
                    DhizukuBridge.lockNow(context)
                }
                if (cmd.reboot) {
                    appendLog(context, "Executing remote reboot (${cmd.commandId})")
                    DhizukuBridge.reboot(context)
                }
            }

            appendLog(
                context,
                "Synced policy v${manifest.policyVersion} (${targetHidden.size} hidden, ${manifest.uninstallApps.size} uninstalls, ${manifest.installApks.size} installs)"
            )
            manifest
        }.onFailure {
            appendLog(context, "Sync failed: ${it.message}")
        }
    }

    private fun getInstalledVersionCode(context: Context, packageName: String): Long {
        return try {
            val info = context.packageManager.getPackageInfo(packageName, 0)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                info.longVersionCode
            } else {
                @Suppress("DEPRECATION")
                info.versionCode.toLong()
            }
        } catch (_: PackageManager.NameNotFoundException) {
            -1L
        }
    }
}
