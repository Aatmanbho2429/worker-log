# Versioned releases + in-app updates: implementation plan

> **Status:** Phases 0–3 implemented 2026-09-18 by Sonnet 5, on branch
> `auto-update`. Every fact in the tables below was checked against the code
> on 2026-09-15 (Phase 0 facts re-verified 2026-09-18), so don't re-derive
> them — but re-check anything Phase 4 touches, since the branch has moved on.
>
> - [x] Phase 0: **Done 2026-09-18** — keypair generated, all 8 secrets set and verified
> - [x] Phase 1: **Done 2026-09-18** — `.github/workflows/release.yml`, `tauri.conf.json`, `Cargo.toml`
> - [x] Phase 2: **Done 2026-09-18** — `src-tauri/src/updater.rs` + supporting models/events
> - [x] Phase 3: **Done 2026-09-18** — banner, `core/updates.service.ts`, Settings button
> - [ ] Phase 4: Local checks done (§4.1); §4.2 (CI dry run) and §4.3 (real two-release walk) still
>       need a tag pushed to GitHub — that publishes a (pre)release on a public repo and spends
>       Actions minutes, so it needs the user's go-ahead first, not something to do on its own.
> - [ ] Phase 5: Fold into a `release` skill, update rules, delete this plan — do this only once
>       Phase 4 has actually shipped a working update to a real install.
>
> Phases 1–3 shipped together, on branch `auto-update`, not yet merged or pushed.

---

## What is being built

1. **Pushing a tag `vX.Y.Z` ships a release.** GitHub Actions builds signed
   installers for Windows (x64) and macOS (Apple Silicon + Intel). It uploads
   them to a GitHub Release on `Aatmanbho2429/worker-log` together with a
   signed `latest.json` manifest.
2. **The installed app finds out on its own.** At launch, and every 6 hours
   after that, Rust fetches
   `https://github.com/Aatmanbho2429/worker-log/releases/latest/download/latest.json`.
   It compares that version with its own and verifies the signature.
3. **The operator chooses when to install.** A slim banner appears in the
   shell: *"Version X.Y.Z is ready"* with **What's new**, **Install &
   restart** and dismiss. The download starts only after the click. The app
   then shows progress, installs, and relaunches on the new version.

**Decided with the user:** banner plus one click. It is **not** a forced
overlay like Pictoria's. A shop-floor terminal must never be locked out of
logging by an update. Don't port `force-update` from Visara.

**Out of scope, don't build:** forced/mandatory updates, Linux builds,
Windows Authenticode signing, a Supabase `minVersion` kill switch,
auto-download without a click, and delta updates.

---

## Reference implementation: how Pictoria (Visara-Tauri) does it

Path: `~/Desktop/Coding playground/Visara-tauri/Visara-Tauri`. It is proven in
production: v1.1.40's live `latest.json` carries `darwin-aarch64`,
`darwin-x86_64`, `windows-x86_64` (+ `-nsis`, `-msi`) entries.

| Piece | Pictoria | Take / change for worker-log |
|---|---|---|
| Trigger | `on: push: tags: ['v*']` | **Take** |
| Release creation | `create-release` job makes a **published** release first, then the matrix uploads into it | **Change → draft**, published only after every leg succeeds and `latest.json` is verified (see §1.4) |
| Build | `tauri-apps/tauri-action@v0` with `releaseId`, `includeUpdaterJson: true`, `updaterJsonPreferNsis: true` | **Take** |
| Matrix | windows-latest x64; macos-latest arm64; macos-latest cross-compiled x86_64 (non-blocking because of its Python sidecar) | **Take**, but Intel is **blocking**: worker-log is pure Rust and cross-compiles trivially |
| Sidecar / LFS / model / PyInstaller steps | ~250 lines | **Drop all of it**; worker-log has no sidecar |
| `entitlements.plist` | Exists only for the PyInstaller sidecar | **Drop**; the Rust app needs no entitlements |
| Update signing | `TAURI_SIGNING_PRIVATE_KEY` + `_PASSWORD` secrets, `pubkey` in `tauri.conf.json` | **Take**, with a **new** keypair (§0.1) |
| Apple signing / notarization | 6 `APPLE_*` secrets passed to tauri-action | **Take**; secrets must be re-added to this repo (§0.2) |
| Config | `bundle.createUpdaterArtifacts: true`, `plugins.updater.endpoints = [.../releases/latest/download/latest.json]` | **Take**. Also has `"dialog": false`, a Tauri v1 key that v2 ignores, so **don't copy it** |
| Rust | `commands/update_commands.rs`: `update_check` / `update_install` **emit events** carrying `ApiResponse` payloads | **Change shape** to this repo's convention: commands *return* `ApiResponse`, and only progress is an event (§2) |
| Progress | Accumulates `chunk_len` into a running total, emits only when the whole % changes | **Take exactly**; the comments there explain the bug it fixed |
| Install re-check | `update_install` calls `check()` again and reports `Ok(None)` as an error rather than hanging at 0% | **Take** |
| Manual-download fallback | `update_open_releases_page`, URL hardcoded in Rust, shells out to `open`/`cmd start` | **Take the idea**, but call `tauri-plugin-opener`'s `open_url`, which is already a dependency here |
| Angular | Root `UpdateService` of signals, started at app boot, 6-hour interval; a banner in `master.html` | **Take the state shape**; the banner goes in `shell.html` |
| Failed background check | Logs only, emits nothing (fail-open) | **Take**: an offline terminal must show nothing |

Pictoria's version lives in three places. Here we cut that to **one**
(§1.2).

---

## Facts about worker-log (verified, don't re-derive)

| Fact | Where | Consequence |
|---|---|---|
| Repo `Aatmanbho2429/worker-log` is **public** | `gh repo view` | `releases/latest/download/latest.json` is fetchable without auth. If the repo ever goes private, updates silently stop. |
| No `.github/`, no tags. All 8 secrets **are set** (2026-09-18) | `gh secret list` | Phase 0 is done; Apple certificate is Pictoria's, valid to 2031-06-15, team `48267PTA8U` |
| Version `0.1.0` in `tauri.conf.json`, `src-tauri/Cargo.toml` and `web/package.json` | | §1.2 makes `Cargo.toml` the single source |
| `app_info` reports `env!("CARGO_PKG_VERSION")` | `commands.rs:23` | The Settings screen already shows the Cargo version |
| `bundle.targets` = `deb, appimage, msi, nsis, dmg` | `tauri.conf.json` | Change to `nsis, app, dmg` (§1.3) |
| Deps: `tauri-plugin-opener 2.5.4`, `tauri-plugin-dialog`, `tauri-plugin-log`, `reqwest` (rustls). **No updater plugin.** | `Cargo.toml` | Add `tauri-plugin-updater = "2"` (Visara resolves 2.10.1) |
| Capabilities list plugin perms only; app commands need none | `capabilities/default.json`, `rules/tauri-ipc.md` | All updater calls happen **in Rust**, so add **no** `updater:*` permission and **no** `@tauri-apps/plugin-updater` npm package |
| CSP `connect-src` has no GitHub | `tauri.conf.json` | Fine: the HTTP request is made by Rust, not the webview. **Don't touch the CSP.** |
| Supabase URL/anon key fall back to compiled-in values | `supabase.rs:34-47` | CI needs **no** Supabase secrets |
| Commands return `ApiResponse<T>` via `<name>_impl -> AppResult<T>` + `.into()`; `ZoneWrapperService.invoke()` resolves `data` or throws `{kind, message}` | `rules/api-response-format.md`, `zone-wrapper.service.ts` | Update commands follow this. Unlike Visara, they don't emit their result as an event. |
| Events are `worker-log://<name>` constants in `events.rs` with plain typed payloads (no envelope), mirrored in `TAURI_EVENTS` | `events.rs`, `tauri-events.const.ts`, `models/events.ts` | Progress becomes `worker-log://update-progress` |
| Angular runs **with zone.js** (NgZone); the wrapper re-enters the zone | `zone-wrapper.service.ts` | Signals are still the state primitive, as everywhere else |
| No tray; closing the window quits (no `on_window_event`) | `lib.rs` | No "Quit" command needed |
| SQLite in **WAL** mode, one mutex-guarded connection | `db.rs:40`, `state.rs` | Committed data survives a hard exit. Still checkpoint before the Windows installer kills the process (§2.4), as `seed` already does. |
| Settings screen shows Version and is routed at `/settings`, but its **nav item is commented out** | `shell.ts:64` | Manual "Check for updates" goes there. See Open question 1. |
| `UpdaterBuilder::on_before_exit(Fn() + Send + Sync + 'static)` runs before the Windows installer starts and `std::process::exit(0)` | tauri-plugin-updater 2.10.1 `updater.rs:289` | Hook for the WAL checkpoint; reach it via `app.updater_builder()` |
| Windows `installMode` default is `passive` (progress bar only) | plugin `config.rs` | Keep the default |
| Node locally `v20.20.2`; both `package-lock.json` and `web/package-lock.json` exist | | CI uses Node 20 + `npm ci` twice |
| Branches: `Development` → `UAT` → `main`; GitHub default is `claude/ceramic-waste-logging-uvo59l` | `git branch -a` | Tag releases from `main`. The trigger is the tag, not the branch, but the tagged commit must contain the workflow file. |

---

## Phase 0: One-time setup — COMPLETE (2026-09-18)

Kept as the record of what exists. Nothing here is left to do; §0.3 is still
pending because it only happens at the first release.

### 0.1 Generate the update-signing keypair

```bash
npx tauri signer generate -w ~/.tauri/worker-log.key
```

- Use a **new** key, not Pictoria's. A leaked key would otherwise let
  someone push a fake update to both apps.
- **Done on 2026-09-18.** The key is at `~/.tauri/worker-log.key`, and its
  public half is already written into `plugins.updater.pubkey` in §1.3 below.
  The public key is safe to commit.
- The private key and its password go into a password manager **and** the
  GitHub secrets below. **If the private key is lost, installed copies can
  never be updated again.** Every user would have to reinstall by hand.

### 0.2 Repository secrets on `Aatmanbho2429/worker-log`

Secrets are per-repo. Visara's values can't be read back from GitHub, so
enter them from the originals.

| Secret | Value |
|---|---|
| `TAURI_SIGNING_PRIVATE_KEY` | contents of `~/.tauri/worker-log.key` |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | the password chosen in 0.1 |
| `APPLE_CERTIFICATE` | base64 of the Developer ID Application `.p12` (same one Pictoria uses) |
| `APPLE_CERTIFICATE_PASSWORD` | `.p12` password |
| `APPLE_SIGNING_IDENTITY` | e.g. `Developer ID Application: … (TEAMID)` |
| `APPLE_ID` | Apple ID email |
| `APPLE_PASSWORD` | app-specific password (not the Apple ID password) |
| `APPLE_TEAM_ID` | team id |

```bash
gh secret set TAURI_SIGNING_PRIVATE_KEY -R Aatmanbho2429/worker-log < ~/.tauri/worker-log.key
```

(Repeat for the others; `gh secret set NAME -R … ` prompts for the value.)

### 0.3 The first updatable release must be installed by hand

Copies running `0.1.0` have no updater. Whichever version first ships
Phases 2–3 (suggested `0.2.0`) has to be installed manually on every terminal.
Automatic updates start from that version on.

---

## Phase 1: Release pipeline

### 1.1 Dependencies

- `src-tauri/Cargo.toml`: add `tauri-plugin-updater = "2"`.
- Don't add `tauri-plugin-process`. `AppHandle::restart()` is core Tauri.
- Don't add any npm package.

### 1.2 One version source: `Cargo.toml`

- **Delete** the `"version"` key from `src-tauri/tauri.conf.json`. In Tauri 2,
  an absent `version` falls back to the Cargo package version. That is what
  the bundle filenames, the updater's current-version comparison and
  `app_info` then all read.
- `web/package.json`'s `version` is not used by anything; leave it alone.
- To release: edit `version = "X.Y.Z"` in `src-tauri/Cargo.toml`, then run
  `cargo check --manifest-path src-tauri/Cargo.toml` so `Cargo.lock` picks it
  up. Commit both.
- CI refuses a tag that doesn't match (§1.4, `prepare`), so a mismatch fails
  in the first 10 seconds rather than shipping a `0.1.0` build labelled
  `v0.2.0`. A mislabelled build would make the updater offer the same update
  in a loop.

### 1.3 `src-tauri/tauri.conf.json`

```jsonc
"bundle": {
  "active": true,
  "targets": ["nsis", "app", "dmg"],   // was deb, appimage, msi, nsis, dmg
  "createUpdaterArtifacts": true,
  // icon / category / descriptions unchanged
},
"plugins": {
  "updater": {
    "pubkey": "dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IDE1NDMxRDZBNjZDMUNGRDYKUldUV3o4Rm1haDFERlkwY2ZocDVVM1dhZFl2R1MvOS9TeTBwQTVCblZKSFBxcHA3V1RlZUhMWngK",
    "endpoints": [
      "https://github.com/Aatmanbho2429/worker-log/releases/latest/download/latest.json"
    ]
  }
}
```

Why these targets:
- **NSIS only on Windows, no MSI.** If a machine gets both, they register as
  two separate installs. NSIS installs per-user by default, so an update needs
  no admin rights or UAC prompt. MSI would also pull in WiX on the runner.
  **Don't set `nsis.installMode` to `perMachine`:** every update would then
  raise UAC on a shop-floor PC.
- **`app` is what `createUpdaterArtifacts` turns into `*.app.tar.gz` + `.sig`**,
  the macOS update payload. `dmg` is for first installs.
- `deb`/`appimage` are removed because the app targets Windows and macOS only.
  Tauri filters targets per OS anyway; this just stops Linux intent from being
  implied.

### 1.4 `.github/workflows/release.yml`

Write it exactly as below. Keep the comments: they explain the choices that
differ from Pictoria.

```yaml
name: Release

on:
  push:
    tags:
      - 'v*'

permissions:
  contents: write

# Two pushes of the same tag must never build into one release concurrently.
concurrency:
  group: release-${{ github.ref }}
  cancel-in-progress: false

jobs:
  # Checks the tag against Cargo.toml, reads the release notes from the
  # annotated tag, and creates a DRAFT release for the build legs to upload
  # into. Draft, unlike Pictoria's published-up-front release: while a release
  # is a draft, `releases/latest` still points at the previous version. So an
  # installed app never fetches a latest.json that is half-uploaded or missing
  # a platform because one leg failed.
  prepare:
    runs-on: ubuntu-latest
    outputs:
      release_id: ${{ steps.create.outputs.result }}
      notes: ${{ steps.notes.outputs.notes }}
      prerelease: ${{ steps.version.outputs.prerelease }}
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Tag must match Cargo.toml version
        id: version
        shell: bash
        run: |
          set -euo pipefail
          TAG="${GITHUB_REF_NAME}"
          CARGO_VERSION="$(grep -m1 '^version' src-tauri/Cargo.toml | sed -E 's/version *= *"([^"]+)"/\1/')"
          if [ "v${CARGO_VERSION}" != "${TAG}" ]; then
            echo "::error::tag ${TAG} does not match src-tauri/Cargo.toml version ${CARGO_VERSION}"
            echo "::error::bump Cargo.toml, commit, then re-tag."
            exit 1
          fi
          # A hyphen (v0.3.0-rc.1) marks a prerelease. `releases/latest` never
          # points at a prerelease, so an rc tag exercises the whole pipeline
          # without offering anything to installed apps.
          if [[ "${TAG}" == *-* ]]; then echo "prerelease=true" >> "$GITHUB_OUTPUT"; else echo "prerelease=false" >> "$GITHUB_OUTPUT"; fi

      # actions/checkout rewrites annotated tags as lightweight ones, so fetch
      # the real tag object before reading its message.
      - name: Release notes from the annotated tag
        id: notes
        shell: bash
        run: |
          set -euo pipefail
          git fetch --force origin "refs/tags/${GITHUB_REF_NAME}:refs/tags/${GITHUB_REF_NAME}"
          NOTES="$(git tag -l --format='%(contents)' "${GITHUB_REF_NAME}" | sed '/-----BEGIN PGP SIGNATURE-----/,$d')"
          if [ -z "${NOTES//[[:space:]]/}" ]; then
            NOTES="Bug fixes and improvements."
          fi
          {
            echo "notes<<__NOTES_EOF__"
            echo "$NOTES"
            echo "__NOTES_EOF__"
          } >> "$GITHUB_OUTPUT"

      - name: Create draft release
        id: create
        uses: actions/github-script@v7
        env:
          NOTES: ${{ steps.notes.outputs.notes }}
          PRERELEASE: ${{ steps.version.outputs.prerelease }}
        with:
          result-encoding: string
          script: |
            const tag = context.ref.replace('refs/tags/', '');
            const { data } = await github.rest.repos.createRelease({
              owner: context.repo.owner,
              repo: context.repo.repo,
              tag_name: tag,
              name: `Ceramic Waste Log ${tag}`,
              body: process.env.NOTES,
              draft: true,
              prerelease: process.env.PRERELEASE === 'true',
            });
            return String(data.id);

  build:
    needs: prepare
    strategy:
      fail-fast: false
      matrix:
        include:
          - os: windows-latest
            target: x86_64-pc-windows-msvc
          - os: macos-latest
            target: aarch64-apple-darwin
          # Intel is cross-compiled on the Apple Silicon runner. Unlike
          # Pictoria there is no Python sidecar, so this is a plain
          # `--target` and it stays blocking.
          - os: macos-latest
            target: x86_64-apple-darwin
    runs-on: ${{ matrix.os }}
    # Apple's notarization queue has no SLA.
    timeout-minutes: 180

    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup Node 20
        uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
          cache-dependency-path: |
            package-lock.json
            web/package-lock.json

      - name: Setup Rust stable
        uses: dtolnay/rust-toolchain@stable
        with:
          targets: ${{ matrix.target }}

      - name: Rust cache
        uses: swatinem/rust-cache@v2
        with:
          workspaces: src-tauri
          key: ${{ matrix.target }}

      # Root installs the Tauri CLI; web/ holds Angular. tauri.conf.json's
      # beforeBuildCommand runs `npm --prefix web run build`, which needs both.
      - name: Install dependencies
        shell: bash
        run: |
          npm ci
          npm ci --prefix web

      # Without this a missing secret surfaces deep inside the bundler as a
      # vague "failed to sign" error, or (worse) as an update that verifies
      # against nothing.
      - name: Verify signing secrets are present
        shell: bash
        env:
          TAURI_KEY: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY }}
          TAURI_PASS: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY_PASSWORD }}
          APPLE_CERT: ${{ secrets.APPLE_CERTIFICATE }}
          APPLE_ID: ${{ secrets.APPLE_ID }}
        run: |
          missing=0
          [ -n "$TAURI_KEY" ]  || { echo "::error::TAURI_SIGNING_PRIVATE_KEY not set"; missing=1; }
          [ -n "$TAURI_PASS" ] || { echo "::error::TAURI_SIGNING_PRIVATE_KEY_PASSWORD not set"; missing=1; }
          if [ "${{ runner.os }}" = "macOS" ]; then
            [ -n "$APPLE_CERT" ] || { echo "::error::APPLE_CERTIFICATE not set"; missing=1; }
            [ -n "$APPLE_ID" ]   || { echo "::error::APPLE_ID not set"; missing=1; }
          fi
          exit $missing

      - name: Build, sign and upload
        uses: tauri-apps/tauri-action@v0
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          TAURI_SIGNING_PRIVATE_KEY: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY }}
          TAURI_SIGNING_PRIVATE_KEY_PASSWORD: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY_PASSWORD }}
          APPLE_CERTIFICATE: ${{ secrets.APPLE_CERTIFICATE }}
          APPLE_CERTIFICATE_PASSWORD: ${{ secrets.APPLE_CERTIFICATE_PASSWORD }}
          APPLE_SIGNING_IDENTITY: ${{ secrets.APPLE_SIGNING_IDENTITY }}
          APPLE_ID: ${{ secrets.APPLE_ID }}
          APPLE_PASSWORD: ${{ secrets.APPLE_PASSWORD }}
          APPLE_TEAM_ID: ${{ secrets.APPLE_TEAM_ID }}
        with:
          releaseId: ${{ needs.prepare.outputs.release_id }}
          releaseBody: ${{ needs.prepare.outputs.notes }}
          includeUpdaterJson: true
          # latest.json's plain `windows-x86_64` entry points at the NSIS
          # installer; there is no MSI to prefer anyway, but be explicit.
          updaterJsonPreferNsis: true
          args: --target ${{ matrix.target }}

  # Only runs if every leg succeeded. Checks the draft's latest.json covers all
  # three platforms before flipping the release public. The legs merge
  # latest.json by download-modify-upload, so a race or a silent upload failure
  # could drop a platform. Publishing that would give those users an
  # updater error on every check.
  publish:
    needs: [prepare, build]
    runs-on: ubuntu-latest
    steps:
      - name: Verify latest.json in the draft
        shell: bash
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: |
          set -euo pipefail
          gh release download "${GITHUB_REF_NAME}" -R "${GITHUB_REPOSITORY}" -p latest.json -D .
          VERSION="${GITHUB_REF_NAME#v}"
          jq -e --arg v "$VERSION" '.version == $v' latest.json >/dev/null \
            || { echo "::error::latest.json version is not $VERSION"; cat latest.json; exit 1; }
          for p in windows-x86_64 darwin-aarch64 darwin-x86_64; do
            jq -e --arg p "$p" '.platforms[$p].url and .platforms[$p].signature' latest.json >/dev/null \
              || { echo "::error::latest.json is missing platform $p"; cat latest.json; exit 1; }
          done
          echo "latest.json OK"

      - name: Publish release
        uses: actions/github-script@v7
        env:
          RELEASE_ID: ${{ needs.prepare.outputs.release_id }}
          PRERELEASE: ${{ needs.prepare.outputs.prerelease }}
        with:
          script: |
            await github.rest.repos.updateRelease({
              owner: context.repo.owner,
              repo: context.repo.repo,
              release_id: Number(process.env.RELEASE_ID),
              draft: false,
              make_latest: process.env.PRERELEASE === 'true' ? 'false' : 'true',
            });
```

**Recovery when a leg fails:** the release stays a draft, so users are
unaffected. Fix the cause and **re-run all jobs** from the Actions page. If the
fix needs a code change, delete the draft release and the tag, then bump and
re-tag. Never hand-edit `latest.json` on a published release.

---

## Phase 2: Rust updater commands

### 2.1 Module layout

New module **`src-tauri/src/updater.rs`**, declared in `lib.rs`. It is kept
out of `commands.rs` for the same reason `auth.rs` is: it has nothing to do
with the register. Three commands, written the `<name>_impl -> AppResult<T>`
+ one-line `#[tauri::command]` wrapper way (`rules/api-response-format.md`).

New models, one struct per file (`rules/models.md`):

- `src-tauri/src/models/response/update_info.rs`:
  ```rust
  #[derive(Debug, Clone, Serialize)]
  #[serde(rename_all = "camelCase")]
  pub struct UpdateInfo {
      pub version: String,          // the offered version, e.g. "0.3.0"
      pub current_version: String,  // what's running now
      pub notes: String,            // release body; "" when absent
  }
  ```
- `src-tauri/src/models/response/update_progress.rs`:
  `UpdateProgress { downloaded: u64, total: Option<u64> }`.
- Register both in `models/response/mod.rs`.

Event: in `events.rs` add
`pub const UPDATE_PROGRESS: &str = "worker-log://update-progress";`.

### 2.2 `update_check() -> ApiResponse<Option<UpdateInfo>>`

- `app.updater()?.check().await`:
  - `Ok(Some(u))` → `Some(UpdateInfo { version: u.version, current_version: u.current_version, notes: u.body.unwrap_or_default() })`
  - `Ok(None)` → `None`
  - `Err(e)` → `log::warn!("[updater] check failed: {e}")` and return the
    500-class `AppError` (see `error.rs` for the variant). Angular's
    **background** check swallows it; the **manual** check shows it.
- Map updater errors to `AppError` with a message an operator can read, and
  keep the plugin's error text in it. "Signature verification failed" is what
  makes a support call solvable.

### 2.3 `update_install() -> ApiResponse<()>`

Port Pictoria's `update_install` (`UI/src-tauri/src/commands/update_commands.rs:39-129`)
with these differences:

- Build the updater with the exit hook:
  `app.updater_builder().on_before_exit(<checkpoint>).build()?` (§2.4).
- **Re-check** before downloading. `Ok(None)` → a 409-class error:
  *"This update is no longer offered. Check for updates again."* Never
  return silently: the UI is already in its downloading state.
- Progress: copy Pictoria's accumulator and "emit only when the whole percent
  changes" logic. Pull the percentage maths into a pure
  `fn progress_percent(downloaded: u64, total: Option<u64>) -> Option<u64>`
  so it can be unit-tested (§4.1). Emit `UpdateProgress` on
  `events::UPDATE_PROGRESS`; a failed emit is `log::warn!` only.
- On success: `app.restart()`. On macOS, `download_and_install` swaps the
  `.app` in place and `restart()` relaunches it. On Windows the process has
  already exited inside `install` (after `on_before_exit`), and the NSIS
  installer relaunches the app. Either way this command never returns
  success to the webview, and that is expected.
- On error: return the `AppError`. The Angular promise rejects and the banner
  shows its error state.
- Guard against double clicks with an `AtomicBool` "installing" flag in
  managed state or a `static`. A second call while one is running returns a
  409-class error rather than starting a second download.

### 2.4 Checkpoint SQLite before the Windows installer runs

`on_before_exit` closure (`Fn + Send + Sync + 'static`):
- Capture an `AppHandle` clone and read `app.state::<AppState>()` inside.
- Use **`try_lock`**, not `lock`. If a command holds the connection at that
  moment, skip the checkpoint rather than deadlock the installer. WAL commits
  are already durable, so this is tidiness, not correctness.
- Run `PRAGMA wal_checkpoint(TRUNCATE);`, the same statement `lib.rs` runs
  before the `seed` exit. Log the outcome.

### 2.5 `update_open_releases_page() -> ApiResponse<()>`

- `const RELEASES_URL: &str = "https://github.com/Aatmanbho2429/worker-log/releases/latest";`
  is hardcoded in Rust. **Never accept a URL from the webview**, so the front
  end never gets an "open any URL" primitive.
- `use tauri_plugin_opener::OpenerExt; app.opener().open_url(RELEASES_URL, None::<&str>)`.
  This is called from Rust, so it needs no `opener:allow-open-url`
  capability.

### 2.6 Wiring in `lib.rs`

- `.plugin(tauri_plugin_updater::Builder::new().build())` next to the other
  plugins.
- Add `updater::update_check`, `updater::update_install` and
  `updater::update_open_releases_page` to `generate_handler![]`.
- **No change** to `capabilities/default.json`.

---

## Phase 3: Angular

### 3.1 Registries and models

- `core/tauri/tauri-commands.const.ts`: add an `// updates` section with
  `updateCheck`, `updateInstall`, `updateOpenReleasesPage`.
- `core/tauri/tauri-events.const.ts`: add
  `updateProgress: 'worker-log://update-progress'`.
- `models/response/updateInfo.ts` (`UpdateInfo { version; currentVersion; notes }`)
  and `models/updateProgress.ts` or next to `events.ts`, matching where
  `DataChanged` lives: `UpdateProgress { downloaded: number; total: number | null }`.
  Export both from the `index.ts` barrels.

### 3.2 `services/update/update.service.ts`: the Tauri-calling service

This is the one-per-entity service that injects `ZoneWrapperService`:

```ts
check(): Promise<UpdateInfo | null>
install(): Promise<void>
openReleasesPage(): Promise<void>
progress(): Observable<UpdateProgress>   // zoneWrapper.listen(TAURI_EVENTS.updateProgress)
```

### 3.3 `core/updates.service.ts`: app-wide state (root, signals, no UI)

This is cross-cutting state, so it lives in `core/`, like `data-changes.service.ts`.

```ts
readonly available  = signal<UpdateInfo | null>(null);
readonly installing = signal(false);
readonly percent    = signal<number | null>(0);  // null = indeterminate (no Content-Length)
readonly error      = signal<string | null>(null);
readonly checking   = signal(false);             // for the manual button
private  dismissedVersion = signal<string | null>(null);

readonly bannerVisible = computed(() => {
  const info = this.available();
  return !!info && (this.installing() || !!this.error() || info.version !== this.dismissedVersion());
});

start(): void          // idempotent; subscribe to progress FIRST, then check, then setInterval 6h
checkInBackground()    // errors → console.warn only, never a toast (offline terminal = silence)
checkNow(): Promise<'available' | 'upToDate'>   // manual; errors propagate to the caller
install(): Promise<void>  // sets installing/percent/error; on rejection installing=false, error=message
dismiss(): void        // dismissedVersion = available()?.version. In memory: a relaunch or a NEWER version re-shows it
openReleasesPage(): void
```

Rules:
- Subscribe to the progress listener **before** the first `install()` can run.
  Pictoria documents that an event fired before `listen()` resolves is lost.
- **Background checks only in a real build:** `start()` skips the automatic
  check and the interval when `isDevMode()`. Otherwise every `npm run dev`
  session with an older local version would raise the banner. `checkNow()`
  still works in dev, which is how the banner gets tested.
- Call `start()` from the `App` constructor, so the check runs at boot and the
  answer is ready by the time the shell mounts after sign-in.

### 3.4 `shared/update-banner/`: the banner component

- `update-banner.ts` + `update-banner.html`, **no stylesheet**. Imports
  `PrimengComponentsModule`; if `ProgressBar` is missing from that module,
  add it there, not in the component.
- Mount it in `layout/shell/shell.html` as the first child of
  `<main class="shell__main">`, above `<router-outlet>`. It renders nothing
  unless `updates.bannerVisible()`.
- States:

  | State | Shows |
  |---|---|
  | offered | icon · "Version {{version}} is ready" · **What's new** (text button, only when `notes` is non-empty) · **Install & restart** (primary) · dismiss (text, icon-only, `size="small"`) |
  | downloading | "Downloading version {{version}}…" · `p-progressbar` at `percent()`, or `mode="indeterminate"` when `percent() === null`. No buttons: there is nothing safe to cancel. |
  | failed | the **real** error text · **Retry** (primary) · **Download manually** (secondary → `openReleasesPage()`) · dismiss |

- **Install & restart** first asks through `ConfirmationService`, the same
  pattern as the shell's sign-out. Suggested copy: *"The register closes for
  about a minute while version X installs, then reopens. Nothing you've
  logged is lost."* Buttons: *Install now* / *Not now*.
- **What's new** opens a `p-dialog` with `notes` as pre-wrapped text. Take its
  width from `DIALOG_WIDTH` in `models/constants.ts` (add an entry if none
  fits).
- The **update itself** never raises a toast. The banner is the only signal.

### 3.5 Styles

- `web/src/assets/styles/shared/_update-banner.scss`, registered in
  `main.scss` under the shared group. BEM block `update-banner`
  (`__icon`, `__text`, `__title`, `__error`, `__actions`, `__progress`;
  modifiers `--failed`, `--installing`).
- Look: modelled on `components/_device-notice.scss`, which uses
  `$accent-soft` ground, `$radius-md` and `$space-md $space-lg` padding. The
  failed state uses the danger *text* token, not a red fill. Tokens only;
  follow `rules/ui-design-system.md` and `rules/theming.md`, including the
  one-solid-button-per-region rule and the 1024×640 check.

### 3.6 Settings screen: version + manual check

In `views/settings/settings.html`'s Application card, next to Version:
- A **Check for updates** secondary button, `[loading]="updates.checking()"`.
- Result: `available` → `notify.info(...)` ("Version X is ready. Use the
  banner to install."), and the banner is already showing. `upToDate` →
  `notify.success(...)` ("You're on the latest version."). Error →
  `notify.fromCommand(error, translate.instant('update.checkFailed'))`.

### 3.7 Copy

All strings go in `assets/i18n/en.json` under a new top-level `update`
namespace (the `extract-static-text` skill):
`ready`, `whatsNew`, `install`, `retry`, `downloadManually`, `dismiss`,
`downloading`, `confirmHeader`, `confirmMessage`, `confirmAccept`,
`confirmReject`, `notesTitle`, `checkNow`, `checkFailed`, `upToDate`,
`availableToast`, `failedTitle`.

---

## Phase 4: Verification

### 4.1 Automated

- **Rust:** `#[cfg(test)]` in `updater.rs` for `progress_percent`: `total`
  `None` → `None`; `Some(0)` → `None`; halfway → `50`; overshoot clamps to
  `100`; big numbers don't overflow (`saturating_mul`).
- **Angular:** `core/updates.service.spec.ts` with `UpdateService` mocked:
  - background-check error → no `error()`, banner hidden;
  - `available` → `bannerVisible()` true;
  - `dismiss()` hides it; the same version re-offered stays hidden; a newer version shows again;
  - `install()` rejection → `installing()` false, `error()` set, banner visible even though dismissed;
  - progress with `total: null` → `percent()` null.
- Run `cargo test --manifest-path src-tauri/Cargo.toml` and, from `web/`,
  `npm test -- --watch=false`. Both suites must pass.
- Run `npx prettier --write` on the touched Angular files (from `web/`).
- Local release build with signing to prove the config is valid before
  spending CI minutes:
  ```bash
  TAURI_SIGNING_PRIVATE_KEY="$(cat ~/.tauri/worker-log.key)" TAURI_SIGNING_PRIVATE_KEY_PASSWORD='…' npm run build
  ```
  Expect `.app.tar.gz` + `.app.tar.gz.sig` under
  `src-tauri/target/release/bundle/macos/`.

### 4.2 CI dry run, with nothing offered to users

Bump `Cargo.toml` to `0.2.0-rc.1`, commit, then run
`git tag -a v0.2.0-rc.1 -m "pipeline test" && git push origin v0.2.0-rc.1`.
Expect all three legs green, the `publish` check passing, and a
**prerelease** that `releases/latest` does not point at. Then delete that
prerelease and its tag.

### 4.3 Real two-release walkthrough, on one Windows PC and one Mac

1. Release `v0.2.0` (the first updatable build) and install it by hand from
   the `.dmg` / `-setup.exe`. Settings shows 0.2.0.
2. Release `v0.2.1` with an annotated tag carrying real notes.
3. Relaunch 0.2.0 → the banner appears within seconds of sign-in; **What's
   new** shows the tag notes.
4. Dismiss → hidden; Settings → **Check for updates** → the info toast; the
   banner stays hidden for 0.2.1 (as designed).
5. Relaunch → the banner is back → **Install & restart** → confirm → the
   progress bar moves → the app relaunches → Settings shows **0.2.1**, and the
   waste entries logged before the update are all present.
6. Windows: no UAC prompt during the update (per-user NSIS).
7. **Offline:** turn Wi-Fi off and relaunch → no banner, no toast, the app is
   fully usable. The manual check shows the error toast.
8. Mac: a copy in `/Applications` owned by another admin → install fails →
   the banner shows the real error + **Download manually** opens the
   releases page in the browser.

---

## Phase 5: Documentation (once it ships)

Follow `CLAUDE.md`'s own rule: fold this plan into the skill and rules that
own the area, then **delete this file**. Don't grow `CLAUDE.md`.

- **New skill `.claude/skills/release/SKILL.md`** covering the release
  procedure: bump `Cargo.toml` → `cargo check` → commit → annotated tag
  (notes in the message) → push the tag → watch Actions → the draft is
  published automatically. It also covers rc tags for dry runs, recovery when
  a leg fails, the secret list, and *"losing the signing key means no more
  updates"*. Add it to `.claude/skills/README.md`.
- **`rules/tauri-ipc.md`:** commands live in `commands.rs`, `auth.rs` **or
  `updater.rs`**. Events are now `data-changed` **and** `update-progress`.
  Add `src-tauri/src/updater.rs` to its `paths:`.
- **`rules/testing.md`:** add `core/updates.service.spec.ts` to the coverage
  list and `updater.rs` to the Rust test modules (and to `paths:`).
- **`CLAUDE.md`:** one bullet for `updater.rs` in the Rust list, and one row
  in the "Where the detail lives" table pointing at `skills/release/`.
  Nothing else.

---

## Things that will bite

- **Don't copy Pictoria's event-emitting command shape.** Here commands
  *return* `ApiResponse`; only progress is an event. A `update_available`
  event would be a second, unregistered IPC style.
- **`releases/latest` ignores drafts and prereleases.** That is what makes the
  draft-then-publish flow and rc dry runs safe. Don't "simplify" to publishing
  up front.
- **The tag must match `Cargo.toml`.** If a build reports an older version
  than its `latest.json`, the updater offers the same update forever.
- **Don't reuse Pictoria's signing key** or its `pubkey`.
- **Don't add `updater:*` or `opener:allow-open-url` capabilities** or the
  `@tauri-apps/plugin-updater` npm package. Everything runs in Rust.
- **Don't touch the CSP.** The webview never talks to GitHub.
- **Don't auto-download.** The user explicitly chose click-to-install for a
  shop-floor terminal.
- **The banner lives in the shell,** so the login screen never shows it. That
  is acceptable: an update that fixes sign-in is reached through
  **Download manually** or a reinstall. Don't move it to `app.html` without
  asking.
- **An unsigned or un-notarized mac build still produces a valid updater
  signature,** but Gatekeeper blocks the first manual install. The secrets
  check in CI exists so this can't ship by accident.
- **Windows isn't Authenticode-signed** (neither is Pictoria), so SmartScreen
  warns on the *first manual* install. In-app updates are unaffected. That is
  out of scope here, but tell the user.

---

## Open questions for the user (don't block the implementation on them)

1. The Settings nav item is commented out (`shell.ts:64`), so the manual
   **Check for updates** button is reachable only by URL. Unhide Settings, or
   put the button on Profile instead? *Default if unanswered: Settings, and
   flag it in the PR.*
2. Is the Apple Developer ID account used for Pictoria still active and
   usable for this app's bundle id `com.aatman.ceramicwastelog`? The macOS
   legs can't go green without it.
