package com.mdm.dhizuku.sync

import android.annotation.SuppressLint
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.ApplicationInfo
import android.content.pm.PackageInfo
import android.content.pm.PackageManager
import android.os.BatteryManager
import android.os.Build
import android.util.Log
import com.mdm.dhizuku.dhizuku.DhizukuBridge
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

object DeviceStateReporter {
    private const val TAG = "DeviceStateReporter"

    suspend fun reportDeviceState(context: Context): Result<Unit> = withContext(Dispatchers.IO) {
        runCatching {
            val prefs = PolicySyncEngine.getPrefs(context)
            val token = (prefs.getString(PolicySyncEngine.KEY_GITHUB_TOKEN, "") ?: "").trim()
            val policyUrl = (prefs.getString(PolicySyncEngine.KEY_POLICY_URL, PolicySyncEngine.DEFAULT_POLICY_URL) ?: "").trim()

            if (token.isEmpty()) {
                Log.d(TAG, "No GitHub PAT configured; skipping device_state.json commit.")
                return@runCatching
            }

            // Extract owner and repo from policyUrl: https://raw.githubusercontent.com/<owner>/<repo>/...
            val match = Regex("githubusercontent\\.com/([^/]+)/([^/]+)/").find(policyUrl)
            val (owner, repo) = if (match != null) {
                Pair(match.groupValues[1], match.groupValues[2])
            } else {
                Pair("benjamin-brinkerhoff", "dhizuku-github-mdm")
            }

            val dpm = DhizukuBridge.getDevicePolicyManager(context)
            val admin = DhizukuBridge.getOwnerComponent()
            val pm = context.packageManager

            val packages = pm.getInstalledPackages(PackageManager.GET_META_DATA)
            val appsArray = JSONArray()

            for (pkg in packages) {
                val appInfo = pkg.applicationInfo ?: continue
                val isSystem = (appInfo.flags and ApplicationInfo.FLAG_SYSTEM) != 0
                val isHidden = if (dpm != null && admin != null) {
                    runCatching { dpm.isApplicationHidden(admin, pkg.packageName) }.getOrDefault(false)
                } else false

                val appObj = JSONObject().apply {
                    put("package_name", pkg.packageName)
                    put("app_name", pm.getApplicationLabel(appInfo).toString())
                    put("version_name", pkg.versionName ?: "")
                    put("version_code", getVersionCode(pkg))
                    put("is_system_app", isSystem)
                    put("is_hidden", isHidden)
                }
                appsArray.put(appObj)
            }

            val batteryIntent = context.registerReceiver(null, IntentFilter(Intent.ACTION_BATTERY_CHANGED))
            val level = batteryIntent?.getIntExtra(BatteryManager.EXTRA_LEVEL, -1) ?: -1
            val scale = batteryIntent?.getIntExtra(BatteryManager.EXTRA_SCALE, -1) ?: -1
            val batteryPct = if (level >= 0 && scale > 0) (level * 100 / scale) else -1
            val status = batteryIntent?.getIntExtra(BatteryManager.EXTRA_STATUS, -1) ?: -1
            val isCharging = status == BatteryManager.BATTERY_STATUS_CHARGING || status == BatteryManager.BATTERY_STATUS_FULL

            val stateJson = JSONObject().apply {
                put("device_model", "${Build.MANUFACTURER} ${Build.MODEL}")
                put("android_version", Build.VERSION.RELEASE)
                put("sdk_int", Build.VERSION.SDK_INT)
                put("last_sync", SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss'Z'", Locale.US).format(Date()))
                put("battery_percent", batteryPct)
                put("is_charging", isCharging)
                put("dhizuku_active", DhizukuBridge.isPermissionGranted())
                put("installed_apps_count", appsArray.length())
                put("installed_apps", appsArray)
            }

            val payloadString = stateJson.toString(2)
            val apiUrl = "https://api.github.com/repos/$owner/$repo/contents/device_state.json"

            // 1. Get existing file SHA if present
            var sha: String? = null
            runCatching {
                val getConn = (URL(apiUrl).openConnection() as HttpURLConnection).apply {
                    requestMethod = "GET"
                    setRequestProperty("Accept", "application/vnd.github+json")
                    setRequestProperty("Authorization", "Bearer $token")
                    connectTimeout = 10_000
                    readTimeout = 10_000
                }
                if (getConn.responseCode in 200..299) {
                    val getBody = getConn.inputStream.bufferedReader().use { it.readText() }
                    sha = JSONObject(getBody).optString("sha", null)
                }
            }

            // 2. Commit updated device_state.json
            val base64Content = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                java.util.Base64.getEncoder().encodeToString(payloadString.toByteArray(Charsets.UTF_8))
            } else {
                android.util.Base64.encodeToString(payloadString.toByteArray(Charsets.UTF_8), android.util.Base64.NO_WRAP)
            }

            val putBody = JSONObject().apply {
                put("message", "telemetry: update device_state.json (${appsArray.length()} apps)")
                put("content", base64Content)
                put("branch", "main")
                if (!sha.isNullOrEmpty()) {
                    put("sha", sha)
                }
            }

            val putConn = (URL(apiUrl).openConnection() as HttpURLConnection).apply {
                requestMethod = "PUT"
                doOutput = true
                setRequestProperty("Accept", "application/vnd.github+json")
                setRequestProperty("Authorization", "Bearer $token")
                setRequestProperty("Content-Type", "application/json")
                connectTimeout = 15_000
                readTimeout = 15_000
            }

            putConn.outputStream.use { os ->
                os.write(putBody.toString().toByteArray(Charsets.UTF_8))
            }

            val code = putConn.responseCode
            if (code in 200..299) {
                PolicySyncEngine.appendLog(context, "Uploaded app list (${appsArray.length()} apps) to device_state.json")
            } else {
                val err = putConn.errorStream?.bufferedReader()?.use { it.readText() } ?: ""
                Log.w(TAG, "Failed to upload device_state.json (HTTP $code): $err")
            }
        }
    }

    private fun getVersionCode(pkg: PackageInfo): Long {
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            pkg.longVersionCode
        } else {
            @Suppress("DEPRECATION")
            pkg.versionCode.toLong()
        }
    }
}
