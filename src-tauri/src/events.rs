//! Events the backend pushes to the front end.
//!
//! Every command that writes announces what changed, so any open window
//! refreshes itself rather than relying on the one window that happened to
//! make the call to remember to reload. The front end listens on
//! [`DATA_CHANGED`] and reloads only the screens the scope touches.
//!
//! [`UPDATE_PROGRESS`] streams download/install progress the same way, since
//! the command it belongs to is a single in-flight call and the UI needs many
//! updates over its lifetime. [`UPDATE_AVAILABLE`] is pushed by the
//! background poll (`updater::start_background_checks`) — the two-hourly
//! check has no command of its own to answer, so it has to announce itself.

use serde::Serialize;
use tauri::{AppHandle, Emitter};

use crate::models::UpdateInfo;

/// Single channel for "something in the register moved".
pub const DATA_CHANGED: &str = "worker-log://data-changed";

/// Download/install progress for an in-progress update install.
pub const UPDATE_PROGRESS: &str = "worker-log://update-progress";

/// A newer version was found by the background poll.
pub const UPDATE_AVAILABLE: &str = "worker-log://update-available";

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ChangeScope {
    /// A grade button was tapped or undone.
    Waste,
    Workers,
    Series,
    Reasons,
    Grades,
    /// A reseed replaced effectively everything.
    Everything,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DataChanged {
    pub scope: ChangeScope,
    /// Short, already-phrased for a toast; `None` when the caller shows its
    /// own confirmation and a second message would just be noise.
    pub message: Option<String>,
}

/// Which stretch of `update_install` a progress event describes. The
/// download reports real bytes; the plugin gives no callback at all for
/// signature verification, extraction and the bundle swap that follow, so
/// that whole stretch is reported as one indeterminate `Installing` phase
/// rather than leaving the bar parked at 100% looking hung.
#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum UpdatePhase {
    Downloading,
    Installing,
}

/// Mirrors `web/src/app/models/events.ts`'s `UpdateProgress`.
#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateProgress {
    pub downloaded: u64,
    /// `None` when the response carried no `Content-Length` — the UI then
    /// shows an indeterminate bar rather than a percentage stuck at 0.
    pub total: Option<u64>,
    pub phase: UpdatePhase,
}

pub fn emit_changed(app: &AppHandle, scope: ChangeScope) {
    emit(app, DATA_CHANGED, DataChanged { scope, message: None });
}

pub fn emit_changed_with(app: &AppHandle, scope: ChangeScope, message: impl Into<String>) {
    emit(app, DATA_CHANGED, DataChanged { scope, message: Some(message.into()) });
}

pub fn emit_update_progress(app: &AppHandle, progress: UpdateProgress) {
    emit(app, UPDATE_PROGRESS, progress);
}

/// Pushed by the 2-hourly background poll when it finds a newer version.
pub fn emit_update_available(app: &AppHandle, info: UpdateInfo) {
    emit(app, UPDATE_AVAILABLE, info);
}

fn emit<T: Serialize + Clone>(app: &AppHandle, event: &str, payload: T) {
    // A failed notification must not fail the write (or download) that
    // already succeeded.
    if let Err(error) = app.emit(event, payload) {
        log::warn!("could not emit {event}: {error}");
    }
}
