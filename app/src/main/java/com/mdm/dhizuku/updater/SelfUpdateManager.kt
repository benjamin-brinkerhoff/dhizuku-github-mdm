package com.mdm.dhizuku.updater

import android.content.Context
import android.content.pm.PackageInfo
import android.content.pm.PackageManager
import android.os.Build
import android.util.Log
import com.mdm.dhizuku.dhizuku.DhizukuBridge
import com.mdm.dhizuku.sync.PolicySyncEngine
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.io.File
import java.net.HttpURLConnection
import java.net.URL

object SelfUpdateManager {
    private const val TAG = "SelfUpdateManager"

    suspend fun checkForSelfUpdate(context: Context): Result<Boolean> = withContext(Dispatchers.IO) {
        runCatching {
            val prefs = PolicySyncEngine.getPrefs(context)
            val policyUrl = (prefs.getString(PolicySyncEngine.KEY_POLICY_URL, PolicySyncEngine.DEFAULT_POLICY_URL) ?: "").trim()
            val token = (prefs.getString(PolicySyncEngine.KEY_GITHUB_TOKEN, "") ?: "").trim()

            // Extract owner and repo from policyUrl
            val match = Regex("githubusercontent\\.com/([^/]+)/([^/]+)/").find(policyUrl)
            val (owner, repo) = if (match != null) {
                Pair(match.groupValues[1], match.groupValues[2])
            } else {
                Pair("benjamin-brinkerhoff", "dhizuku-github-mdm")
            }

            val currentVerCode = getCurrentVersionCode(context)
            val releasesUrl = "https://api.github.com/repos/$owner/$repo/releases/latest"

            val conn = (URL(releasesUrl).openConnection() as HttpURLConnection).apply {
                requestMethod = "GET"
                setRequestProperty("Accept", "application/vnd.github+json")
                if (token.isNotEmpty()) {
                    setRequestProperty("Authorization", "Bearer $token")
                }
                connectTimeout = 12_000
                readTimeout = 12_000
            }

            val code = conn.responseCode
            if (code !in 200..299) {
                Log.d(TAG, "No releases found or HTTP $code from GitHub Releases API")
                return@runCatching false
            }

            val body = conn.inputStream.bufferedReader().use { it.readText() }
            val releaseObj = JSONObject(body)
            val tagName = releaseObj.optString("tag_name", "")

            // Parse version number from tag (e.g. "v1.0.14" -> 14)
            val remoteRunNumber = tagName.substringAfterLast(".").toLongOrNull() ?: -1L
            if (remoteRunNumber <= currentVerCode) {
                Log.d(TAG, "App is up to date (current: $currentVerCode, remote tag: $tagName)")
                return@runCatching false
            }

            // Find the APK asset
            val assets = releaseObj.optJSONArray("assets") ?: return@runCatching false
            var downloadUrl: String? = null
            var assetName = "app-debug.apk"

            for (i in 0 until assets.length()) {
                val asset = assets.optJSONObject(i) ?: continue
                val name = asset.optString("name", "")
                if (name.endsWith(".apk")) {
                    assetName = name
                    downloadUrl = asset.optString("browser_download_url", "")
                    break
                }
            }

            if (downloadUrl.isNullOrEmpty()) {
                Log.w(TAG, "Release $tagName has no .apk asset attached")
                return@runCatching false
            }

            PolicySyncEngine.appendLog(
                context,
                "New MDM build available: $tagName (current build is $currentVerCode). Downloading $assetName..."
            )

            val tempApk = File(context.cacheDir, "self_update.apk")
            val dlConn = (URL(downloadUrl).openConnection() as HttpURLConnection).apply {
                connectTimeout = 25_000
                readTimeout = 40_000
                if (token.isNotEmpty()) {
                    setRequestProperty("Authorization", "Bearer $token")
                }
            }

            dlConn.inputStream.use { input ->
                tempApk.outputStream().use { output -> input.copyTo(output) }
            }

            PolicySyncEngine.appendLog(context, "Downloaded $tagName (${tempApk.length() / 1024} KB). Committing silent self-update...")

            // Commit silent self-update via Dhizuku wrapped PackageInstaller
            DhizukuBridge.installApkSilently(context, tempApk, context.packageName).getOrThrow()
            PolicySyncEngine.appendLog(context, "Silent self-update committed for $tagName. Android is updating the app.")
            true
        }
    }

    fun getCurrentVersionCode(context: Context): Long {
        return try {
            val pInfo = context.packageManager.getPackageInfo(context.packageName, 0)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                pInfo.longVersionCode
            } else {
                @Suppress("DEPRECATION")
                pInfo.versionCode.toLong()
            }
        } catch (_: PackageManager.NameNotFoundException) {
            1L
        }
    }

    fun getCurrentVersionName(context: Context): String {
        return try {
            context.packageManager.getPackageInfo(context.packageName, 0).versionName ?: "1.0.0"
        } catch (_: PackageManager.NameNotFoundException) {
            "1.0.0"
        }
    }
}
