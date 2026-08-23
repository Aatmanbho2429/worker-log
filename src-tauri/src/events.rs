//! Events the backend pushes to the front end.
//!
//! Every command that writes announces what changed, so any open window
//! refreshes itself rather than relying on the one window that happened to
//! make the call to remember to reload. The front end listens on
//! [`DATA_CHANGED`] and reloads only the screens the scope touches.

use serde::Serialize;
use tauri::{AppHandle, Emitter};

/// Single channel for "something in the register moved".
pub const DATA_CHANGED: &str = "worker-log://data-changed";

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ChangeScope {
    /// A grade button was tapped or undone.
    Waste,
    Workers,
    Series,
    Reasons,
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

pub fn emit_changed(app: &AppHandle, scope: ChangeScope) {
    emit(app, DataChanged { scope, message: None });
}

pub fn emit_changed_with(app: &AppHandle, scope: ChangeScope, message: impl Into<String>) {
    emit(app, DataChanged { scope, message: Some(message.into()) });
}

fn emit(app: &AppHandle, payload: DataChanged) {
    // A failed notification must not fail the write that already succeeded.
    if let Err(error) = app.emit(DATA_CHANGED, payload) {
        log::warn!("could not emit {DATA_CHANGED}: {error}");
    }
}
