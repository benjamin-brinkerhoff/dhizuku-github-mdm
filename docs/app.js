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

let state = structuredClone(DEFAULT_POLICY);
let installedApps = [];

const elOwner = document.getElementById("ghOwner");
const elRepo = document.getElementById("ghRepo");
const elBranch = document.getElementById("ghBranch");
const elToken = document.getElementById("ghToken");
const elStatus = document.getElementById("statusBanner");
const elJson = document.getElementById("jsonPreview");

function setStatus(msg, isError = false) {
  elStatus.textContent = msg;
  elStatus.style.borderLeftColor = isError ? "#ef4444" : "#38bdf8";
}

function loadSavedAuth() {
  const savedToken = localStorage.getItem("dhizuku_mdm_pat");
  const savedOwner = localStorage.getItem("dhizuku_mdm_owner");
  const savedRepo = localStorage.getItem("dhizuku_mdm_repo");
  if (savedToken) elToken.value = savedToken;
  if (savedOwner) elOwner.value = savedOwner;
  if (savedRepo) elRepo.value = savedRepo;
}

function saveAuth() {
  localStorage.setItem("dhizuku_mdm_pat", elToken.value.trim());
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
    li.innerHTML = `<span>${item.package_name} (v${item.version_code})</span><button data-remove-apk="${idx}">Remove</button>`;
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
    setStatus("Enter your GitHub PAT first so the browser can upload the .apk file to your repository.", true);
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
  const repoPath = `apks/${safeFileName}`;

  try {
    setStatus(`Reading ${file.name} (${(file.size / (1024 * 1024)).toFixed(2)} MB)...`);
    const buffer = await file.arrayBuffer();
    const base64Content = arrayBufferToBase64(buffer);

    setStatus(`Uploading ${repoPath} to ${owner}/${repo}@${branch}...`);
    await commitBase64ToGitHub(
      owner,
      repo,
      branch,
      repoPath,
      token,
      base64Content,
      `feat(apk): upload ${safeFileName} for OTA silent install`
    );

    const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${repoPath}`;
    document.getElementById("apkUrl").value = rawUrl;
    state.install_apks = (state.install_apks || []).filter((x) => x.package_name !== pkg);
    state.install_apks.push({ package_name: pkg, apk_url: rawUrl, version_code: ver });
    syncControlsToState();
    renderStateToUI();
    setStatus(`Uploaded ${repoPath} and added to install_apks! Click "Commit & Push Policy" to dispatch to the phone.`);
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

async function commitBase64ToGitHub(owner, repo, branch, path, token, base64Content, message) {
  const headers = {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json"
  };
  let sha = undefined;
  const getRes = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/contents/${path}?ref=${encodeURIComponent(branch)}&t=${Date.now()}`,
    { headers }
  );
  if (getRes.ok) {
    const existing = await getRes.json();
    sha = existing.sha;
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
    setStatus("Please enter a GitHub Personal Access Token (PAT) with Contents Read/Write permission to commit changes.", true);
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
loadSavedAuth();
renderStateToUI();
fetchPolicyFromGitHub();
