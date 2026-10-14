const DEFAULT_POLICY = {
  policy_version: 1,
  updated_at: new Date().toISOString(),
  hide_apps: [],
  unhide_apps: [],
  uninstall_apps: [],
  user_restrictions: {
    no_camera: false,
    no_usb_file_transfer: false,
    no_mount_physical_media: false,
    no_safe_boot: true,
    no_factory_reset: true,
    no_debugging_features: false,
    no_install_unknown_sources: false,
    no_add_user: true
  },
  kiosk: {
    enabled: false,
    lock_task_packages: ["com.mdm.dhizuku", "org.lds.ldssa"],
    lock_task_features: ["system_info", "notifications", "home", "global_actions"]
  },
  install_apks: [],
  remote_commands: {
    command_id: "init-001",
    lock_now: false,
    reboot: false
  }
};

const VAULT_STORAGE_KEY = "dhizuku_mdm_encrypted_vault";
let state = structuredClone(DEFAULT_POLICY);
let installedApps = [];

const elOwner = document.getElementById("ghOwner");
const elRepo = document.getElementById("ghRepo");
const elBranch = document.getElementById("ghBranch");
const elToken = document.getElementById("ghToken");
const elStatus = document.getElementById("statusBanner");
const elJson = document.getElementById("jsonPreview");

const lockOverlay = document.getElementById("lockScreenOverlay");
const consoleWrapper = document.getElementById("consoleWrapper");
const lockOwner = document.getElementById("lockOwner");
const lockRepo = document.getElementById("lockRepo");
const lockPassword = document.getElementById("lockPassword");
const lockPat = document.getElementById("lockPat");
const patSetupRow = document.getElementById("patSetupRow");
const lockError = document.getElementById("lockError");

function setStatus(msg, isError = false) {
  elStatus.textContent = msg;
  elStatus.style.borderLeftColor = isError ? "#ef4444" : "#38bdf8";
}

function showLockError(msg) {
  if (!lockError) return;
  lockError.textContent = msg;
  lockError.classList.remove("hidden");
}

function clearLockError() {
  if (!lockError) return;
  lockError.textContent = "";
  lockError.classList.add("hidden");
}

// Web Crypto AES-GCM helpers to encrypt the GitHub PAT with the user's Console Password
async function deriveKey(password, saltBytes) {
  const enc = new TextEncoder();
  const baseKey = await crypto.subtle.importKey(
    "raw",
    enc.encode(password),
    "PBKDF2",
    false,
    ["deriveKey"]
  );
  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: saltBytes,
      iterations: 100000,
      hash: "SHA-256"
    },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

async function encryptTokenWithPassword(token, password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(password, salt);
  const enc = new TextEncoder();
  const cipherBuf = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    enc.encode(token)
  );
  return JSON.stringify({
    salt: arrayBufferToBase64(salt.buffer),
    iv: arrayBufferToBase64(iv.buffer),
    cipher: arrayBufferToBase64(cipherBuf)
  });
}

async function decryptTokenWithPassword(vaultJson, password) {
  const vault = JSON.parse(vaultJson);
  const salt = base64ToUint8Array(vault.salt);
  const iv = base64ToUint8Array(vault.iv);
  const cipher = base64ToUint8Array(vault.cipher);
  const key = await deriveKey(password, salt);
  const plainBuf = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    key,
    cipher
  );
  return new TextDecoder().decode(plainBuf);
}

function base64ToUint8Array(b64) {
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) {
    arr[i] = bin.charCodeAt(i);
  }
  return arr;
}

async function verifyGitHubWriteAccess(owner, repo, token) {
  const res = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`
    }
  });
  if (!res.ok) {
    throw new Error(`GitHub authentication failed (HTTP ${res.status}). Check your token.`);
  }
  const data = await res.json();
  if (!data.permissions || !data.permissions.push) {
    throw new Error(`Access Denied: This token does not have write/push permissions on ${owner}/${repo}.`);
  }
  return true;
}

function updateLockScreenVaultMode() {
  localStorage.removeItem("dhizuku_mdm_pat"); // purge any legacy plaintext token
  const savedOwner = localStorage.getItem("dhizuku_mdm_owner");
  const savedRepo = localStorage.getItem("dhizuku_mdm_repo");
  if (savedOwner && lockOwner) lockOwner.value = savedOwner;
  if (savedRepo && lockRepo) lockRepo.value = savedRepo;

  const hasEncryptedVault = Boolean(localStorage.getItem(VAULT_STORAGE_KEY));
  if (patSetupRow) {
    if (hasEncryptedVault) {
      patSetupRow.classList.add("hidden");
    } else {
      patSetupRow.classList.remove("hidden");
    }
  }
}

document.getElementById("btnUnlockConsole")?.addEventListener("click", async () => {
  clearLockError();
  const owner = (lockOwner?.value || "benjamin-brinkerhoff").trim();
  const repo = (lockRepo?.value || "dhizuku-github-mdm").trim();
  const password = (lockPassword?.value || "").trim();
  const newPat = (lockPat?.value || "").trim();
  const existingVault = localStorage.getItem(VAULT_STORAGE_KEY);

  const btn = document.getElementById("btnUnlockConsole");
  btn.disabled = true;
  btn.textContent = "Verifying Admin Credentials...";

  try {
    let resolvedToken = "";
    if (newPat) {
      resolvedToken = newPat;
      await verifyGitHubWriteAccess(owner, repo, resolvedToken);
      if (password) {
        const encryptedVault = await encryptTokenWithPassword(resolvedToken, password);
        localStorage.setItem(VAULT_STORAGE_KEY, encryptedVault);
      }
    } else if (existingVault) {
      if (!password) {
        throw new Error("Enter your Console Password to unlock your saved GitHub token.");
      }
      try {
        resolvedToken = await decryptTokenWithPassword(existingVault, password);
      } catch (_) {
        throw new Error("Incorrect Console Password.");
      }
      await verifyGitHubWriteAccess(owner, repo, resolvedToken);
    } else {
      throw new Error("Enter your GitHub Personal Access Token (and a Console Password to encrypt it).");
    }

    localStorage.setItem("dhizuku_mdm_owner", owner);
    localStorage.setItem("dhizuku_mdm_repo", repo);

    elOwner.value = owner;
    elRepo.value = repo;
    elToken.value = resolvedToken;

    lockPassword.value = "";
    lockPat.value = "";

    lockOverlay?.classList.add("hidden");
    consoleWrapper?.classList.remove("hidden");

    await fetchPolicyFromGitHub();
  } catch (err) {
    showLockError(err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = "Verify Admin Access & Unlock Console";
  }
});

document.getElementById("btnClearSavedVault")?.addEventListener("click", () => {
  localStorage.removeItem(VAULT_STORAGE_KEY);
  localStorage.removeItem("dhizuku_mdm_pat");
  if (patSetupRow) patSetupRow.classList.remove("hidden");
  clearLockError();
});

document.getElementById("btnLockConsole")?.addEventListener("click", () => {
  elToken.value = "";
  consoleWrapper?.classList.add("hidden");
  lockOverlay?.classList.remove("hidden");
  updateLockScreenVaultMode();
});

function saveAuth() {
  localStorage.setItem("dhizuku_mdm_owner", elOwner.value.trim());
  localStorage.setItem("dhizuku_mdm_repo", elRepo.value.trim());
}

function renderStateToUI() {
  document.querySelectorAll("[data-restriction]").forEach((cb) => {
    const key = cb.getAttribute("data-restriction");
    cb.checked = Boolean(state.user_restrictions && state.user_restrictions[key]);
  });

  const hiddenList = document.getElementById("hiddenAppsList");
  hiddenList.innerHTML = "";
  (state.hide_apps || []).forEach((pkg) => {
    const li = document.createElement("li");
    li.className = "tag-item";
    li.innerHTML = `<span>${pkg}</span><button data-unhide="${pkg}">Unhide</button>`;
    hiddenList.appendChild(li);
  });

  const unhiddenList = document.getElementById("unhiddenAppsList");
  unhiddenList.innerHTML = "";
  (state.unhide_apps || []).forEach((pkg) => {
    const li = document.createElement("li");
    li.className = "tag-item";
    li.innerHTML = `<span>${pkg}</span><button data-remove-unhide="${pkg}">Remove</button>`;
    unhiddenList.appendChild(li);
  });

  const uninstallList = document.getElementById("uninstallAppsList");
  if (uninstallList) {
    uninstallList.innerHTML = "";
    (state.uninstall_apps || []).forEach((pkg) => {
      const li = document.createElement("li");
      li.className = "tag-item";
      li.innerHTML = `<span>${pkg}</span><button data-remove-uninstall="${pkg}">Cancel</button>`;
      uninstallList.appendChild(li);
    });
  }

  document.getElementById("kioskEnabled").checked = Boolean(state.kiosk && state.kiosk.enabled);
  document.getElementById("kioskPackages").value = ((state.kiosk && state.kiosk.lock_task_packages) || []).join(", ");
  const feats = new Set((state.kiosk && state.kiosk.lock_task_features) || []);
  document.querySelectorAll(".kiosk-feat").forEach((cb) => {
    cb.checked = feats.has(cb.value);
  });

  const apkList = document.getElementById("apkQueueList");
  apkList.innerHTML = "";
  (state.install_apks || []).forEach((item, idx) => {
    const li = document.createElement("li");
    li.className = "tag-item";
    const chunkBadge = item.apk_urls && item.apk_urls.length > 1 ? ` · ${item.apk_urls.length} parts` : "";
    li.innerHTML = `<span>${item.package_name} (v${item.version_code}${chunkBadge})</span><button data-remove-apk="${idx}">Remove</button>`;
    apkList.appendChild(li);
  });

  elJson.value = JSON.stringify(state, null, 2);
  renderInstalledAppsTable();
}

function syncControlsToState() {
  state.updated_at = new Date().toISOString();
  state.user_restrictions = state.user_restrictions || {};
  document.querySelectorAll("[data-restriction]").forEach((cb) => {
    state.user_restrictions[cb.getAttribute("data-restriction")] = cb.checked;
  });
  state.kiosk = state.kiosk || {};
  state.kiosk.enabled = document.getElementById("kioskEnabled").checked;
  state.kiosk.lock_task_packages = document
    .getElementById("kioskPackages")
    .value.split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  state.kiosk.lock_task_features = Array.from(document.querySelectorAll(".kiosk-feat:checked")).map((cb) => cb.value);
  elJson.value = JSON.stringify(state, null, 2);
  renderInstalledAppsTable();
}

document.querySelectorAll("[data-restriction], #kioskEnabled, #kioskPackages, .kiosk-feat").forEach((el) => {
  el.addEventListener("change", syncControlsToState);
  el.addEventListener("input", syncControlsToState);
});

function hidePackage(pkg) {
  const clean = pkg.trim();
  if (!clean) return;
  state.hide_apps = Array.from(new Set([...(state.hide_apps || []), clean]));
  state.unhide_apps = (state.unhide_apps || []).filter((p) => p !== clean);
  syncControlsToState();
  renderStateToUI();
}

function unhidePackage(pkg) {
  const clean = pkg.trim();
  if (!clean) return;
  state.hide_apps = (state.hide_apps || []).filter((p) => p !== clean);
  state.unhide_apps = Array.from(new Set([...(state.unhide_apps || []), clean]));
  syncControlsToState();
  renderStateToUI();
}

function queueUninstallPackage(pkg) {
  const clean = pkg.trim();
  if (!clean) return;
  state.uninstall_apps = Array.from(new Set([...(state.uninstall_apps || []), clean]));
  syncControlsToState();
  renderStateToUI();
}

function addKioskPackage(pkg) {
  const clean = pkg.trim();
  if (!clean) return;
  const current = (state.kiosk && state.kiosk.lock_task_packages) || [];
  state.kiosk = state.kiosk || {};
  state.kiosk.lock_task_packages = Array.from(new Set([...current, clean]));
  syncControlsToState();
  renderStateToUI();
}

document.getElementById("btnAddHiddenPkg").addEventListener("click", () => {
  const input = document.getElementById("pkgInput");
  hidePackage(input.value);
  input.value = "";
});

document.getElementById("btnAddUninstallPkg").addEventListener("click", () => {
  const input = document.getElementById("pkgInput");
  queueUninstallPackage(input.value);
  input.value = "";
});

document.querySelectorAll(".chip").forEach((btn) => {
  btn.addEventListener("click", () => hidePackage(btn.getAttribute("data-pkg")));
});

document.addEventListener("click", (e) => {
  const unhidePkg = e.target.getAttribute("data-unhide");
  if (unhidePkg) unhidePackage(unhidePkg);

  const remUnhide = e.target.getAttribute("data-remove-unhide");
  if (remUnhide) {
    state.unhide_apps = (state.unhide_apps || []).filter((p) => p !== remUnhide);
    syncControlsToState();
    renderStateToUI();
  }

  const remUninstall = e.target.getAttribute("data-remove-uninstall");
  if (remUninstall) {
    state.uninstall_apps = (state.uninstall_apps || []).filter((p) => p !== remUninstall);
    syncControlsToState();
    renderStateToUI();
  }

  const remApk = e.target.getAttribute("data-remove-apk");
  if (remApk !== null && remApk !== undefined) {
    state.install_apks.splice(Number(remApk), 1);
    syncControlsToState();
    renderStateToUI();
  }

  const actionHide = e.target.getAttribute("data-action-hide");
  if (actionHide) hidePackage(actionHide);

  const actionUnhide = e.target.getAttribute("data-action-unhide");
  if (actionUnhide) unhidePackage(actionUnhide);

  const actionUninstall = e.target.getAttribute("data-action-uninstall");
  if (actionUninstall) queueUninstallPackage(actionUninstall);

  const actionKiosk = e.target.getAttribute("data-action-kiosk");
  if (actionKiosk) addKioskPackage(actionKiosk);
});

document.getElementById("btnAddApk").addEventListener("click", () => {
  const pkg = document.getElementById("apkPkg").value.trim();
  const url = document.getElementById("apkUrl").value.trim();
  const ver = Number(document.getElementById("apkVer").value || 1);
  if (!pkg || !url) {
    setStatus("Enter both package name and APK URL to queue a silent install.", true);
    return;
  }
  state.install_apks = (state.install_apks || []).filter((x) => x.package_name !== pkg);
  state.install_apks.push({ package_name: pkg, apk_url: url, version_code: ver });
  document.getElementById("apkPkg").value = "";
  document.getElementById("apkUrl").value = "";
  syncControlsToState();
  renderStateToUI();
});

function arrayBufferToBase64(buffer) {
  let binary = "";
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

async function getApksDirShaMap(owner, repo, branch, token) {
  const shaMap = {};
  try {
    const res = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/contents/apks?ref=${encodeURIComponent(branch)}&t=${Date.now()}`,
      {
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${token}`
        }
      }
    );
    if (res.ok) {
      const items = await res.json();
      if (Array.isArray(items)) {
        items.forEach((item) => {
          if (item && item.path && item.sha) shaMap[item.path] = item.sha;
        });
      }
    }
  } catch (_) {}
  return shaMap;
}

document.getElementById("btnUploadApkFile").addEventListener("click", async () => {
  saveAuth();
  const owner = elOwner.value.trim();
  const repo = elRepo.value.trim();
  const branch = elBranch.value.trim() || "main";
  const token = elToken.value.trim();
  const pkg = document.getElementById("apkPkg").value.trim();
  const ver = Number(document.getElementById("apkVer").value || 1);
  const fileInput = document.getElementById("apkFileInput");
  const file = fileInput.files && fileInput.files[0];

  if (!token) {
    setStatus("Unlock the console with your GitHub PAT first.", true);
    return;
  }
  if (!pkg) {
    setStatus("Enter the Android package name (e.g. com.example.app) before uploading the .apk.", true);
    return;
  }
  if (!file) {
    setStatus("Select a .apk file from your computer first.", true);
    return;
  }

  const safeFileName = `${pkg.replace(/[^a-zA-Z0-9._-]/g, "_")}-v${ver}.apk`;
  const CHUNK_SIZE = 12 * 1024 * 1024; // 12 MB per chunk to stay well below GitHub Contents API limits

  try {
    const totalMb = (file.size / (1024 * 1024)).toFixed(2);
    const shaMap = await getApksDirShaMap(owner, repo, branch, token);

    if (file.size <= CHUNK_SIZE) {
      const repoPath = `apks/${safeFileName}`;
      setStatus(`Reading ${file.name} (${totalMb} MB)...`);
      const buffer = await file.arrayBuffer();
      const base64Content = arrayBufferToBase64(buffer);

      setStatus(`Uploading ${repoPath} (${totalMb} MB) to ${owner}/${repo}@${branch}...`);
      await commitBase64ToGitHub(
        owner,
        repo,
        branch,
        repoPath,
        token,
        base64Content,
        `feat(apk): upload ${safeFileName} for OTA silent install`,
        shaMap[repoPath]
      );

      const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${repoPath}`;
      document.getElementById("apkUrl").value = rawUrl;
      state.install_apks = (state.install_apks || []).filter((x) => x.package_name !== pkg);
      state.install_apks.push({ package_name: pkg, apk_url: rawUrl, version_code: ver });
      syncControlsToState();
      renderStateToUI();
      setStatus(`Uploaded ${repoPath} and added to install_apks! Click "Commit & Push Policy" to dispatch to the phone.`);
    } else {
      const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
      const partUrls = [];

      for (let i = 0; i < totalChunks; i++) {
        const start = i * CHUNK_SIZE;
        const end = Math.min(start + CHUNK_SIZE, file.size);
        const partNum = String(i + 1).padStart(3, "0");
        const partFileName = `${safeFileName}.part${partNum}`;
        const partPath = `apks/${partFileName}`;
        const chunkMb = ((end - start) / (1024 * 1024)).toFixed(2);

        setStatus(`Uploading large APK (${totalMb} MB): chunk ${i + 1} of ${totalChunks} (${chunkMb} MB)...`);
        const sliceBuffer = await file.slice(start, end).arrayBuffer();
        const base64Chunk = arrayBufferToBase64(sliceBuffer);

        await commitBase64ToGitHub(
          owner,
          repo,
          branch,
          partPath,
          token,
          base64Chunk,
          `feat(apk): upload ${partFileName} (${i + 1}/${totalChunks}) for OTA silent install`,
          shaMap[partPath]
        );

        partUrls.push(`https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${partPath}`);
      }

      document.getElementById("apkUrl").value = partUrls[0];
      state.install_apks = (state.install_apks || []).filter((x) => x.package_name !== pkg);
      state.install_apks.push({
        package_name: pkg,
        apk_url: partUrls[0],
        apk_urls: partUrls,
        version_code: ver
      });
      syncControlsToState();
      renderStateToUI();
      setStatus(`Uploaded ${totalChunks} chunks (${totalMb} MB total) and queued ${pkg}! Click "Commit & Push Policy" to dispatch to the phone.`);
    }
  } catch (err) {
    setStatus(`APK upload failed: ${err.message}`, true);
  }
});

function renderInstalledAppsTable() {
  const tbody = document.getElementById("installedAppsBody");
  if (!tbody) return;

  const query = (document.getElementById("appSearchInput")?.value || "").toLowerCase().trim();
  const showSystem = Boolean(document.getElementById("checkShowSystemApps")?.checked);
  const onlyHidden = Boolean(document.getElementById("checkOnlyHiddenApps")?.checked);

  const hiddenSet = new Set(state.hide_apps || []);
  const uninstallSet = new Set(state.uninstall_apps || []);
  const kioskSet = new Set((state.kiosk && state.kiosk.lock_task_packages) || []);

  const filtered = installedApps.filter((app) => {
    if (!showSystem && app.is_system_app) return false;
    const isCurrentlyHidden = hiddenSet.has(app.package_name) || app.is_hidden;
    if (onlyHidden && !isCurrentlyHidden) return false;

    if (!query) return true;
    return (
      app.package_name.toLowerCase().includes(query) ||
      (app.app_name && app.app_name.toLowerCase().includes(query))
    );
  });

  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="4" class="empty-state">${
      installedApps.length === 0
        ? "No apps reported yet by device. Ensure the phone has completed a sync with GitHub PAT configured."
        : "No apps matched your search/filter criteria."
    }</td></tr>`;
    return;
  }

  tbody.innerHTML = filtered
    .map((app) => {
      const isHidden = hiddenSet.has(app.package_name);
      const isQueuedUninstall = uninstallSet.has(app.package_name);
      const isKiosk = kioskSet.has(app.package_name);

      return `<tr>
        <td>
          <div class="app-info">
            <span class="app-icon-badge">${(app.app_name || app.package_name)[0].toUpperCase()}</span>
            <div>
              <strong class="app-title">${escapeHtml(app.app_name || app.package_name)}</strong>
              <small class="app-pkg">${escapeHtml(app.package_name)}</small>
            </div>
          </div>
        </td>
        <td>
          <span class="app-ver">${escapeHtml(app.version_name || "v" + app.version_code)}</span>
        </td>
        <td>
          <span class="pill ${app.is_system_app ? "pill-system" : "pill-user"}">${app.is_system_app ? "System" : "User"}</span>
          <span class="pill ${isHidden ? "pill-hidden" : "pill-visible"}">${isHidden ? "Hidden / Frozen" : "Visible"}</span>
          ${isQueuedUninstall ? '<span class="pill pill-danger">Uninstall Pending</span>' : ""}
          ${isKiosk ? '<span class="pill pill-accent">In Kiosk</span>' : ""}
        </td>
        <td style="text-align: right;">
          <div class="row-actions">
            ${
              isHidden
                ? `<button class="btn-xs btn-secondary" data-action-unhide="${escapeHtml(app.package_name)}">Unhide</button>`
                : `<button class="btn-xs btn-secondary" data-action-hide="${escapeHtml(app.package_name)}">Hide</button>`
            }
            <button class="btn-xs btn-danger" data-action-uninstall="${escapeHtml(app.package_name)}">Uninstall</button>
            <button class="btn-xs btn-secondary" data-action-kiosk="${escapeHtml(app.package_name)}">+ Kiosk</button>
          </div>
        </td>
      </tr>`;
    })
    .join("");
}

function escapeHtml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

document.getElementById("appSearchInput")?.addEventListener("input", renderInstalledAppsTable);
document.getElementById("checkShowSystemApps")?.addEventListener("change", renderInstalledAppsTable);
document.getElementById("checkOnlyHiddenApps")?.addEventListener("change", renderInstalledAppsTable);

async function fetchDeviceStateFromGitHub() {
  const owner = elOwner.value.trim();
  const repo = elRepo.value.trim();
  const branch = elBranch.value.trim() || "main";
  const token = elToken.value.trim();
  const headers = { Accept: "application/vnd.github+json" };
  if (token) headers.Authorization = `Bearer ${token}`;

  try {
    const res = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/contents/device_state.json?ref=${encodeURIComponent(branch)}&t=${Date.now()}`,
      { headers }
    );
    if (!res.ok) return;
    const data = await res.json();
    const decoded = atob(data.content.replace(/\n/g, ""));
    const stateObj = JSON.parse(decoded);

    installedApps = Array.isArray(stateObj.installed_apps) ? stateObj.installed_apps : [];

    const badgeDev = document.getElementById("badgeDevice");
    if (badgeDev && stateObj.device_model) {
      badgeDev.textContent = `Device: ${stateObj.device_model} (Android ${stateObj.android_version || ""})`;
    }
    const badgeBat = document.getElementById("badgeBattery");
    if (badgeBat && stateObj.battery_percent !== undefined && stateObj.battery_percent >= 0) {
      badgeBat.textContent = `Battery: ${stateObj.battery_percent}%${stateObj.is_charging ? " ⚡" : ""}`;
    }
    const badgeSync = document.getElementById("badgeSync");
    if (badgeSync && stateObj.last_sync) {
      badgeSync.textContent = `Last Check-in: ${new Date(stateObj.last_sync).toLocaleTimeString()}`;
    }

    renderInstalledAppsTable();
  } catch (err) {
    console.warn("device_state.json not available yet:", err);
  }
}

async function fetchPolicyFromGitHub() {
  saveAuth();
  const owner = elOwner.value.trim();
  const repo = elRepo.value.trim();
  const branch = elBranch.value.trim() || "main";
  const token = elToken.value.trim();
  setStatus(`Fetching policy.json and device_state.json from ${owner}/${repo}@${branch}...`);
  const headers = { Accept: "application/vnd.github+json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  try {
    const res = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/contents/policy.json?ref=${encodeURIComponent(branch)}&t=${Date.now()}`,
      { headers }
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
    const data = await res.json();
    const decoded = atob(data.content.replace(/\n/g, ""));
    state = { ...structuredClone(DEFAULT_POLICY), ...JSON.parse(decoded) };
    renderStateToUI();
    setStatus(`Loaded policy.json (version ${state.policy_version || 1}, SHA ${data.sha.slice(0, 7)}).`);

    await fetchDeviceStateFromGitHub();
  } catch (err) {
    setStatus(`Failed to load policy.json: ${err.message}`, true);
  }
}

async function commitBase64ToGitHub(owner, repo, branch, path, token, base64Content, message, knownSha) {
  const headers = {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json"
  };
  let sha = knownSha;
  if (!sha) {
    const getRes = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/contents/${path}?ref=${encodeURIComponent(branch)}&t=${Date.now()}`,
      { headers }
    );
    if (getRes.ok) {
      const existing = await getRes.json();
      sha = existing.sha;
    }
  }
  const putRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/${path}`, {
    method: "PUT",
    headers,
    body: JSON.stringify({
      message,
      content: base64Content,
      branch,
      ...(sha ? { sha } : {})
    })
  });
  if (!putRes.ok) {
    throw new Error(`HTTP ${putRes.status} on ${path}: ${await putRes.text()}`);
  }
  return await putRes.json();
}

async function commitFileToGitHub(owner, repo, branch, path, token, contentString, message) {
  const encoded = btoa(unescape(encodeURIComponent(contentString)));
  return commitBase64ToGitHub(owner, repo, branch, path, token, encoded, message);
}

async function commitPolicyToGitHub() {
  saveAuth();
  const owner = elOwner.value.trim();
  const repo = elRepo.value.trim();
  const branch = elBranch.value.trim() || "main";
  const token = elToken.value.trim();
  if (!token) {
    setStatus("Please unlock the console with your GitHub PAT to commit changes.", true);
    return;
  }
  try {
    state = JSON.parse(elJson.value);
    state.policy_version = (Number(state.policy_version) || 0) + 1;
    state.updated_at = new Date().toISOString();
    renderStateToUI();
    const payload = JSON.stringify(state, null, 2) + "\n";
    const msg = `chore(policy): update MDM policy v${state.policy_version} via Web Console`;
    setStatus(`Committing policy v${state.policy_version} to ${owner}/${repo}...`);
    await commitFileToGitHub(owner, repo, branch, "policy.json", token, payload, msg);
    await commitFileToGitHub(owner, repo, branch, "config.json", token, payload, msg);
    setStatus(`Committed policy v${state.policy_version} to policy.json & config.json on ${owner}/${repo}@${branch}.`);
  } catch (err) {
    setStatus(`Commit failed: ${err.message}`, true);
  }
}

document.getElementById("btnLoadPolicy").addEventListener("click", fetchPolicyFromGitHub);
document.getElementById("btnCommitPolicy").addEventListener("click", commitPolicyToGitHub);
updateLockScreenVaultMode();
