use std::path::{Path, PathBuf};
use std::sync::MutexGuard;

use rusqlite::Connection;
use tauri::{AppHandle, Manager};

use crate::db::Db;
use crate::error::{AppError, AppResult};

pub struct AppState {
    db: Db,
    database_path: PathBuf,
}

impl AppState {
    pub fn new(db: Db, database_path: PathBuf) -> Self {
        AppState { db, database_path }
    }

    /// Borrows the connection for the duration of one command.
    ///
    /// Commands are synchronous, so the guard is taken and dropped inside a
    /// single call and writes stay serialised. The queries here are local
    /// SQLite reads and writes on one shop-floor machine, well under a frame.
    pub fn conn(&self) -> AppResult<MutexGuard<'_, Connection>> {
        self.db.lock().map_err(|_| {
            AppError::Internal("The database connection was poisoned by an earlier panic.".into())
        })
    }

    pub fn database_path(&self) -> &Path {
        &self.database_path
    }
}

/// Where the register is kept.
///
/// `WORKER_LOG_DB` overrides it, which is what the dev workflow and the tests
/// use; otherwise it is the per-user app data directory the OS gives us, so
/// the data survives reinstalls and does not depend on the working directory
/// the app was launched from.
pub fn database_path(app: &AppHandle) -> Result<PathBuf, Box<dyn std::error::Error>> {
    if let Ok(override_path) = std::env::var("WORKER_LOG_DB") {
        let path = PathBuf::from(override_path);
        if let Some(parent) = path.parent() {
            if !parent.as_os_str().is_empty() {
                std::fs::create_dir_all(parent)?;
            }
        }
        return Ok(path);
    }

    let directory = app.path().app_data_dir()?;
    std::fs::create_dir_all(&directory)?;
    Ok(directory.join("worker-log.db"))
}
