# Dhizuku + GitHub Pages Serverless Android MDM

A complete, serverless Android Mobile Device Management (MDM) control plane and Android client that borrows **Device Owner** privileges from **[Dhizuku](https://github.com/iamr0s/Dhizuku)** (`io.github.iamr0s:Dhizuku-API`) and uses **GitHub (`policy.json`) + GitHub Pages** as a GitOps state store.

```text
[ GitHub Pages Web UI (/docs) ]
              │
     (Commits policy.json via GitHub REST API)
              ▼
[ GitHub Repo: policy.json / config.json ]
              ▲
     (WorkManager / Foreground Polling)
              │
[ Android Client App (com.mdm.dhizuku) ]
              │ (Dhizuku Binder Wrapper IPC)
              ▼
      [ Dhizuku App ]  <──(Active Device Owner)──>  [ Android System / DPM ]
```

## Key Features

1. **Zero Factory-Reset Provisioning via Dhizuku**:
   - Instead of registering a standalone `DeviceAdminReceiver` and wiping the phone, the Android client initializes `Dhizuku.init(context)`, requests delegated permission via `Dhizuku.requestPermission(...)`, and wraps `DevicePolicyManager` and `PackageInstaller` system binders using `Dhizuku.binderWrapper(...)` + `HiddenApiBypass`.
2. **GitOps Policy State (`policy.json` & `config.json`)**:
   - Hosted directly in the repository root and polled by the Android client (`https://raw.githubusercontent.com/benjamin-brinkerhoff/dhizuku-github-mdm/main/policy.json`).
   - Supports **App Hiding / Freezing** (`setApplicationHidden`), **UserManager System Restrictions** (`addUserRestriction` / `clearUserRestriction`), **Kiosk / Lock Task Mode** (`setLockTaskPackages` + `setLockTaskFeatures`), **Silent APK Installation** (`PackageInstaller` session via Dhizuku binder wrapper), and **One-Shot Remote Commands** (`lockNow`, `reboot`).
3. **Static GitHub Pages Web Console (`docs/`)**:
   - Hosted at `https://benjamin-brinkerhoff.github.io/dhizuku-github-mdm/`.
   - Authenticates against the GitHub REST API using a fine-grained Personal Access Token (PAT) stored only in your browser's `localStorage`.
   - Provides interactive toggle switches for restrictions, package freeze/unfreeze lists, Kiosk allowlist configuration, silent APK deployment queue, and a live JSON editor.
4. **Automated APK Builds via GitHub Actions**:
   - Every code push to `main` automatically builds a signed `app-debug.apk` and publishes it to GitHub Releases.
