const DEFAULT_POLICY = {
  policy_version: 1,
  updated_at: new Date().toISOString(),
  hide_apps: [],
  unhide_apps: [],
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
document.getElementById("btnAddHiddenPkg").addEventListener("click", () => {
  const input = document.getElementById("pkgInput");
  hidePackage(input.value);
  input.value = "";
});
document.querySelectorAll(".chip").forEach((btn) => {
  btn.addEventListener("click", () => hidePackage(btn.getAttribute("data-pkg")));
});
document.addEventListener("click", (e) => {
  const unhidePkg = e.target.getAttribute("data-unhide");
  if (unhidePkg) {
    state.hide_apps = (state.hide_apps || []).filter((p) => p !== unhidePkg);
    state.unhide_apps = Array.from(new Set([...(state.unhide_apps || []), unhidePkg]));
    syncControlsToState();
    renderStateToUI();
  }
  const remUnhide = e.target.getAttribute("data-remove-unhide");
  if (remUnhide) {
    state.unhide_apps = (state.unhide_apps || []).filter((p) => p !== remUnhide);
    syncControlsToState();
    renderStateToUI();
  }
  const remApk = e.target.getAttribute("data-remove-apk");
  if (remApk !== null && remApk !== undefined) {
    state.install_apks.splice(Number(remApk), 1);
    syncControlsToState();
    renderStateToUI();
  }
});
document.getElementById("btnAddApk").addEventListener("click", () => {
  const pkg = document.getElementById("apkPkg").value.trim();
  const url = document.getElementById("apkUrl").value.trim();
  const ver = Number(document.getElementById("apkVer").value || 1);
  if (!pkg || !url) {
    setStatus("Enter both package name and APK URL to queue a silent install.", true);
    return;
  }
  state.install_apks = state.install_apks || [];
  state.install_apks.push({ package_name: pkg, apk_url: url, version_code: ver });
  document.getElementById("apkPkg").value = "";
  document.getElementById("apkUrl").value = "";
  syncControlsToState();
  renderStateToUI();
});
document.getElementById("btnLockNow").addEventListener("click", () => {
  state.remote_commands = {
    command_id: "cmd-lock-" + Date.now(),
    lock_now: true,
    reboot: false
  };
  syncControlsToState();
  setStatus("Queued one-shot lockNow command (" + state.remote_commands.command_id + "). Click Commit & Push Policy to dispatch.");
});
document.getElementById("btnReboot").addEventListener("click", () => {
  state.remote_commands = {
    command_id: "cmd-reboot-" + Date.now(),
    lock_now: false,
    reboot: true
  };
  syncControlsToState();
  setStatus("Queued one-shot reboot command (" + state.remote_commands.command_id + "). Click Commit & Push Policy to dispatch.");
});
document.getElementById("btnClearCmds").addEventListener("click", () => {
  state.remote_commands = {
    command_id: "cmd-clear-" + Date.now(),
    lock_now: false,
    reboot: false
  };
  syncControlsToState();
});
elJson.addEventListener("input", () => {
  try {
    state = JSON.parse(elJson.value);
  } catch (_) {}
});
async function fetchPolicyFromGitHub() {
  saveAuth();
  const owner = elOwner.value.trim();
  const repo = elRepo.value.trim();
  const branch = elBranch.value.trim() || "main";
  const token = elToken.value.trim();
  setStatus(`Fetching policy.json from ${owner}/${repo}@${branch}...`);
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
    state = JSON.parse(decoded);
    renderStateToUI();
    setStatus(`Loaded policy.json (version ${state.policy_version || 1}, SHA ${data.sha.slice(0, 7)}).`);
  } catch (err) {
    setStatus(`Failed to load policy.json: ${err.message}`, true);
  }
}
async function commitFileToGitHub(owner, repo, branch, path, token, contentString, message) {
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
  const encoded = btoa(unescape(encodeURIComponent(contentString)));
  const putRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/${path}`, {
    method: "PUT",
    headers,
    body: JSON.stringify({
      message,
      content: encoded,
      branch,
      ...(sha ? { sha } : {})
    })
  });
  if (!putRes.ok) {
    throw new Error(`HTTP ${putRes.status} on ${path}: ${await putRes.text()}`);
  }
  return await putRes.json();
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
