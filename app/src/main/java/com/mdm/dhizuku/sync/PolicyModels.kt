package com.mdm.dhizuku.sync

import org.json.JSONObject

data class ApkInstallSpec(
    val packageName: String,
    val apkUrl: String,
    val versionCode: Long
)

data class KioskPolicySpec(
    val enabled: Boolean,
    val lockTaskPackages: List<String>,
    val lockTaskFeatures: List<String>
)

data class RemoteCommandSpec(
    val commandId: String,
    val lockNow: Boolean,
    val reboot: Boolean
)

data class MdmPolicyManifest(
    val policyVersion: Int,
    val updatedAt: String,
    val hideApps: List<String>,
    val unhideApps: List<String>,
    val uninstallApps: List<String>,
    val userRestrictions: Map<String, Boolean>,
    val kiosk: KioskPolicySpec,
    val installApks: List<ApkInstallSpec>,
    val remoteCommands: RemoteCommandSpec
) {
    companion object {
        fun fromJson(jsonString: String): MdmPolicyManifest {
            val root = JSONObject(jsonString)
            val version = root.optInt("policy_version", 1)
            val updatedAt = root.optString("updated_at", "")

            val hideApps = mutableListOf<String>()
            val hideArr = root.optJSONArray("hide_apps") ?: root.optJSONArray("hidden_apps")
            if (hideArr != null) {
                for (i in 0 until hideArr.length()) {
                    val pkg = hideArr.optString(i).trim()
                    if (pkg.isNotEmpty()) hideApps.add(pkg)
                }
            }

            val unhideApps = mutableListOf<String>()
            val unhideArr = root.optJSONArray("unhide_apps")
            if (unhideArr != null) {
                for (i in 0 until unhideArr.length()) {
                    val pkg = unhideArr.optString(i).trim()
                    if (pkg.isNotEmpty()) unhideApps.add(pkg)
                }
            }

            val uninstallApps = mutableListOf<String>()
            val uninstallArr = root.optJSONArray("uninstall_apps")
            if (uninstallArr != null) {
                for (i in 0 until uninstallArr.length()) {
                    val pkg = uninstallArr.optString(i).trim()
                    if (pkg.isNotEmpty()) uninstallApps.add(pkg)
                }
            }

            val restrictions = mutableMapOf<String, Boolean>()
            val restObj = root.optJSONObject("user_restrictions")
            if (restObj != null) {
                val keys = restObj.keys()
                while (keys.hasNext()) {
                    val key = keys.next()
                    restrictions[key] = restObj.optBoolean(key, false)
                }
            }

            val kioskObj = root.optJSONObject("kiosk")
            val kioskPackages = mutableListOf<String>()
            val kioskFeatures = mutableListOf<String>()
            var kioskEnabled = false
            if (kioskObj != null) {
                kioskEnabled = kioskObj.optBoolean("enabled", false)
                val pkgArr = kioskObj.optJSONArray("lock_task_packages")
                if (pkgArr != null) {
                    for (i in 0 until pkgArr.length()) {
                        val p = pkgArr.optString(i).trim()
                        if (p.isNotEmpty()) kioskPackages.add(p)
                    }
                }
                val featArr = kioskObj.optJSONArray("lock_task_features")
                if (featArr != null) {
                    for (i in 0 until featArr.length()) {
                        val f = featArr.optString(i).trim()
                        if (f.isNotEmpty()) kioskFeatures.add(f)
                    }
                }
            }

            val apks = mutableListOf<ApkInstallSpec>()
            val apkArr = root.optJSONArray("install_apks")
            if (apkArr != null) {
                for (i in 0 until apkArr.length()) {
                    val obj = apkArr.optJSONObject(i) ?: continue
                    val pkg = obj.optString("package_name").trim()
                    val url = obj.optString("apk_url").trim()
                    val ver = obj.optLong("version_code", 1L)
                    if (pkg.isNotEmpty() && url.isNotEmpty()) {
                        apks.add(ApkInstallSpec(pkg, url, ver))
                    }
                }
            }

            val cmdObj = root.optJSONObject("remote_commands")
            val commandSpec = if (cmdObj != null) {
                RemoteCommandSpec(
                    commandId = cmdObj.optString("command_id", ""),
                    lockNow = cmdObj.optBoolean("lock_now", false),
                    reboot = cmdObj.optBoolean("reboot", false)
                )
            } else {
                RemoteCommandSpec("", false, false)
            }

            return MdmPolicyManifest(
                policyVersion = version,
                updatedAt = updatedAt,
                hideApps = hideApps,
                unhideApps = unhideApps,
                uninstallApps = uninstallApps,
                userRestrictions = restrictions,
                kiosk = KioskPolicySpec(kioskEnabled, kioskPackages, kioskFeatures),
                installApks = apks,
                remoteCommands = commandSpec
            )
        }
    }
}
