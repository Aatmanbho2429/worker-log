//! In-app updates. Checks GitHub's signed `latest.json`, and — only once the
//! operator clicks "Install & restart" in the banner — downloads, verifies
//! and installs the new version.
//!
//! This is a click-to-install banner, not a forced overlay: a shop-floor
//! terminal must never be locked out of logging waste by an update. Three
//! commands: [`update_check`] (also used for the Settings screen's manual
//! "Check for updates"), [`update_install`], and
//! [`update_open_releases_page`] — the escape hatch for when the in-app
//! installer itself is broken (bad signature, missing platform artifact, a
//! malformed `latest.json`). See `.claude/plans/auto-update.md`.

use std::sync::atomic::{AtomicBool, Ordering};

use tauri::{AppHandle, Manager};
use tauri_plugin_opener::OpenerExt;
use tauri_plugin_updater::UpdaterExt;

use crate::error::{AppError, AppResult};
use crate::events::{self, UpdateProgress};
use crate::models::{ApiResponse, UpdateInfo};
use crate::state::AppState;

/// Guards against a double click starting a second download while the first
/// is still in flight. Process-lifetime, not per-window: there is exactly
/// one window in this app.
static INSTALLING: AtomicBool = AtomicBool::new(false);

const RELEASES_URL: &str = "https://github.com/Aatmanbho2429/worker-log/releases/latest";

// ------------------------------------------------------------------ check --

/// `None` means the app is already current. A failed check (offline, GitHub
/// unreachable, a corporate proxy) is reported as an error here too — it is
/// the *caller* that decides what to do with that: the background poll in
/// `core/updates.service.ts` swallows it so an offline terminal shows
/// nothing, while the Settings screen's manual button surfaces it.
async fn update_check_impl(app: AppHandle) -> AppResult<Option<UpdateInfo>> {
    let updater = app
        .updater()
        .map_err(|err| AppError::Internal(format!("updater unavailable: {err}")))?;

    match updater.check().await {
        Ok(Some(update)) => Ok(Some(UpdateInfo {
            version: update.version,
            current_version: update.current_version,
            notes: update.body.unwrap_or_default(),
        })),
        Ok(None) => Ok(None),
        Err(err) => {
            log::warn!("[updater] check failed: {err}");
            Err(AppError::Internal(err.to_string()))
        }
    }
}

#[tauri::command]
pub async fn update_check(app: AppHandle) -> ApiResponse<Option<UpdateInfo>> {
    update_check_impl(app).await.into()
}

// ---------------------------------------------------------------- install --

async fn update_install_impl(app: AppHandle) -> AppResult<()> {
    if INSTALLING.swap(true, Ordering::SeqCst) {
        return Err(AppError::Conflict("An update is already downloading.".to_string()));
    }

    let result = install(&app).await;
    INSTALLING.store(false, Ordering::SeqCst);
    result
}

async fn install(app: &AppHandle) -> AppResult<()> {
    // This is a *second* `check()` — `update_check` already ran one to raise
    // the banner, and the offer could be hours old by the time "Install &
    // restart" is clicked. `on_before_exit` runs just before the Windows
    // installer takes over and the process exits; it flushes SQLite's WAL
    // back into the database file first (best-effort — see
    // `checkpoint_before_install`), then still runs the plugin's own
    // `cleanup_before_exit()` so nothing else regresses.
    let app_for_exit = app.clone();
    let updater = app
        .updater_builder()
        .on_before_exit(move || {
            checkpoint_before_install(&app_for_exit);
            app_for_exit.cleanup_before_exit();
        })
        .build()
        .map_err(|err| AppError::Internal(format!("updater unavailable: {err}")))?;

    let update = match updater.check().await {
        Ok(Some(update)) => update,
        Ok(None) => {
            // The UI is already showing its downloading state by the time
            // this runs, so silence here would read as a bar stuck at 0%
            // forever. Report it as a real, actionable error instead.
            log::warn!("[updater] install requested but re-check reports no update available");
            return Err(AppError::Conflict(
                "This update is no longer offered. Check for updates again.".to_string(),
            ));
        }
        Err(err) => {
            log::warn!("[updater] re-check before install failed: {err}");
            return Err(AppError::Internal(err.to_string()));
        }
    };

    log::info!("[updater] starting download of v{}", update.version);

    let app_for_progress = app.clone();
    // `download_and_install`'s callback receives *this chunk's* length, not
    // a running total — accumulate here so `downloaded` means what its name
    // says.
    let mut downloaded: u64 = 0;
    // Only emit when the whole-number percentage actually changes. A 200MB
    // download is tens of thousands of chunks; one IPC message per chunk
    // would flood the webview for a bar that can only render 100 distinct
    // states.
    let mut last_pct: Option<u64> = None;

    let outcome = update
        .download_and_install(
            move |chunk_len, total| {
                downloaded = downloaded.saturating_add(chunk_len as u64);
                let pct = progress_percent(downloaded, total);

                if pct.is_some() && pct == last_pct {
                    return;
                }
                last_pct = pct;

                events::emit_update_progress(
                    &app_for_progress,
                    UpdateProgress { downloaded, total },
                );
            },
            || {},
        )
        .await;

    match outcome {
        // On macOS this swaps the `.app` in place and `restart()` relaunches
        // it. On Windows the process has already exited inside `install`
        // (right after `on_before_exit`, above) and the NSIS installer
        // relaunches the app once it finishes — either way `restart()`
        // (or the exit that preceded it) means this command never actually
        // returns success to the webview, and that is expected.
        Ok(_) => app.restart(),
        Err(err) => {
            log::warn!("[updater] download/install failed: {err}");
            Err(AppError::Internal(err.to_string()))
        }
    }
}

#[tauri::command]
pub async fn update_install(app: AppHandle) -> ApiResponse<()> {
    update_install_impl(app).await.into()
}

/// Percentage of `total` that `downloaded` represents, or `None` when there
/// is no `Content-Length` to compute one against — the UI then shows an
/// indeterminate bar instead of a percentage stuck at 0.
fn progress_percent(downloaded: u64, total: Option<u64>) -> Option<u64> {
    total.filter(|t| *t > 0).map(|t| (downloaded.saturating_mul(100) / t).min(100))
}

/// Flushes the write-ahead log back into the database file before the
/// platform installer runs. WAL commits are already durable on their own —
/// this is tidiness, so a hard exit does not leave a `-wal`/`-shm` file
/// behind for someone inspecting the register by hand — not a correctness
/// fix, which is why it uses `try_conn` rather than blocking.
///
/// `try_conn`, not `conn`: this runs from wherever the updater plugin decides
/// to call `on_before_exit`, and must never wait on a lock a command might be
/// mid-write against right at the moment the installer is about to take over.
fn checkpoint_before_install(app: &AppHandle) {
    let state = app.state::<AppState>();
    match state.try_conn() {
        Some(Ok(connection)) => {
            if let Err(err) = connection.execute_batch("PRAGMA wal_checkpoint(TRUNCATE);") {
                log::warn!("[updater] WAL checkpoint before install failed: {err}");
            }
        }
        Some(Err(err)) => log::warn!("[updater] could not checkpoint before install: {err}"),
        None => log::warn!("[updater] database busy — skipped WAL checkpoint before install"),
    }
}

// ------------------------------------------------------- manual fallback --

/// Opens the GitHub releases page in the system browser — the escape hatch
/// for when the in-app installer itself is broken. The URL is a constant,
/// never accepted from the webview: never give the front end an "open any
/// URL" primitive.
fn update_open_releases_page_impl(app: AppHandle) -> AppResult<()> {
    app.opener()
        .open_url(RELEASES_URL, None::<&str>)
        .map_err(|err| AppError::Internal(format!("could not open the releases page: {err}")))
}

#[tauri::command]
pub fn update_open_releases_page(app: AppHandle) -> ApiResponse<()> {
    update_open_releases_page_impl(app).into()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn no_content_length_is_indeterminate() {
        assert_eq!(progress_percent(0, None), None);
    }

    #[test]
    fn a_zero_total_is_indeterminate_too() {
        assert_eq!(progress_percent(500, Some(0)), None);
    }

    #[test]
    fn halfway_is_fifty_percent() {
        assert_eq!(progress_percent(50, Some(100)), Some(50));
    }

    #[test]
    fn overshoot_clamps_to_a_hundred() {
        // `download_and_install` calling back with a running total that
        // briefly exceeds `total` (a server sending a couple of extra bytes)
        // must never show more than 100%.
        assert_eq!(progress_percent(150, Some(100)), Some(100));
    }

    #[test]
    fn very_large_values_neither_overflow_nor_panic() {
        let huge = u64::MAX / 2;
        let pct = progress_percent(huge, Some(huge));
        assert!(pct.is_some_and(|p| p <= 100));
    }
}
