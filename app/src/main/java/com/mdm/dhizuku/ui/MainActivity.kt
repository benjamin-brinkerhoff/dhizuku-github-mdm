package com.mdm.dhizuku.ui

import android.os.Bundle
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import com.mdm.dhizuku.databinding.ActivityMainBinding
import com.mdm.dhizuku.dhizuku.DhizukuBridge
import com.mdm.dhizuku.sync.PolicySyncEngine
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch

class MainActivity : AppCompatActivity() {
    private lateinit var binding: ActivityMainBinding
    private var fastPollJob: Job? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityMainBinding.inflate(layoutInflater)
        setContentView(binding.root)

        val prefs = PolicySyncEngine.getPrefs(this)
        binding.inputPolicyUrl.setText(
            prefs.getString(PolicySyncEngine.KEY_POLICY_URL, PolicySyncEngine.DEFAULT_POLICY_URL)
        )
        binding.inputGithubToken.setText(
            prefs.getString(PolicySyncEngine.KEY_GITHUB_TOKEN, "")
        )

        binding.btnRequestDhizuku.setOnClickListener {
            DhizukuBridge.requestPermission(this) { granted ->
                runOnUiThread {
                    PolicySyncEngine.appendLog(this, "Dhizuku permission result: $granted")
                    refreshUiState()
                }
            }
        }

        binding.btnOpenDhizuku.setOnClickListener {
            if (!DhizukuBridge.openDhizukuApp(this)) {
                PolicySyncEngine.appendLog(this, "Dhizuku app (com.rosan.dhizuku) is not installed.")
                refreshUiState()
            }
        }

        binding.btnSaveAndSync.setOnClickListener {
            prefs.edit()
                .putString(PolicySyncEngine.KEY_POLICY_URL, binding.inputPolicyUrl.text.toString().trim())
                .putString(PolicySyncEngine.KEY_GITHUB_TOKEN, binding.inputGithubToken.text.toString().trim())
                .apply()
            triggerSync()
        }

        binding.switchFastPoll.setOnCheckedChangeListener { _, isChecked ->
            if (isChecked) {
                startFastPolling()
            } else {
                fastPollJob?.cancel()
                fastPollJob = null
            }
        }

        refreshUiState()
    }

    override fun onResume() {
        super.onResume()
        refreshUiState()
    }

    private fun triggerSync() {
        binding.btnSaveAndSync.isEnabled = false
        lifecycleScope.launch {
            PolicySyncEngine.syncNow(this@MainActivity)
            binding.btnSaveAndSync.isEnabled = true
            refreshUiState()
        }
    }

    private fun startFastPolling() {
        fastPollJob?.cancel()
        fastPollJob = lifecycleScope.launch {
            while (isActive) {
                PolicySyncEngine.syncNow(this@MainActivity)
                refreshUiState()
                delay(15_000L)
            }
        }
    }

    private fun refreshUiState() {
        val inited = DhizukuBridge.init(this)
        val granted = inited && DhizukuBridge.isPermissionGranted()
        val owner = if (granted) DhizukuBridge.getOwnerComponent()?.flattenToShortString() else null

        binding.txtDhizukuStatus.text = when {
            granted -> "Dhizuku Connected • Device Owner Delegated ($owner)"
            inited -> "Dhizuku Active • Permission Not Granted Yet"
            else -> "Dhizuku Not Initialized / Not Installed"
        }

        val prefs = PolicySyncEngine.getPrefs(this)
        binding.txtAuditLog.text = prefs.getString(
            PolicySyncEngine.KEY_AUDIT_LOG,
            "No policy sync events yet. Grant Dhizuku permission and tap Sync Policy Now."
        )
    }
}
