use std::sync::MutexGuard;

use rusqlite::Connection;

use crate::db::Db;
use crate::error::{AppError, AppResult};

#[derive(Clone)]
pub struct AppState {
    db: Db,
}

impl AppState {
    pub fn new(db: Db) -> Self {
        AppState { db }
    }

    /// Borrows the connection for the duration of one handler.
    ///
    /// The guard must not be held across an `.await`; every handler does its
    /// database work in one synchronous stretch, which keeps the futures
    /// `Send` and the writes serialised.
    pub fn conn(&self) -> AppResult<MutexGuard<'_, Connection>> {
        self.db.lock().map_err(|_| {
            AppError::Internal("The database connection was poisoned by an earlier panic.".into())
        })
    }
}
