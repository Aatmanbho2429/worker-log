//! The `invoke` surface. One command per thing the front end can ask for,
//! replacing what used to be HTTP routes.
//!
//! Commands are synchronous: every one is a short local SQLite call, and
//! keeping them sync means the connection guard is taken and released inside
//! a single call with no await points to reason about.

use serde::Serialize;
use tauri::{AppHandle, State};

use crate::error::{AppError, AppResult};
use crate::events::{ChangeScope, emit_changed, emit_changed_with};
use crate::models::{
    Dashboard, Grade, LogEntryRequest, RangeQuery, Reason, ReasonUpsert, SeriesOfProduct,
    SeriesUpsert,
    Worker, WorkerLog, WorkerUpsert,
};
use crate::barcode::Scan;
use crate::barcode_sheet::{self, Sheet};
use crate::report::{ReportContext, to_csv, to_pdf};
use crate::repo::{DateRange, logs, reasons, series, workers};
use crate::state::AppState;
use crate::{now, seed};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppInfo {
    pub version: String,
    pub database_path: String,
}

#[tauri::command]
pub fn app_info(state: State<'_, AppState>) -> AppInfo {
    AppInfo {
        version: env!("CARGO_PKG_VERSION").to_string(),
        database_path: state.database_path().display().to_string(),
    }
}

// ---------------------------------------------------------------- series ---

#[tauri::command]
pub fn list_series(state: State<'_, AppState>) -> AppResult<Vec<SeriesOfProduct>> {
    let connection = state.conn()?;
    series::list(&connection)
}

#[tauri::command]
pub fn create_series(
    app: AppHandle,
    state: State<'_, AppState>,
    payload: SeriesUpsert,
) -> AppResult<SeriesOfProduct> {
    let created = {
        let connection = state.conn()?;
        series::create(&connection, payload)?
    };
    emit_changed(&app, ChangeScope::Series);
    Ok(created)
}

#[tauri::command]
pub fn update_series(
    app: AppHandle,
    state: State<'_, AppState>,
    id: i64,
    payload: SeriesUpsert,
) -> AppResult<SeriesOfProduct> {
    let updated = {
        let connection = state.conn()?;
        series::update(&connection, id, payload)?
    };
    emit_changed(&app, ChangeScope::Series);
    Ok(updated)
}

#[tauri::command]
pub fn delete_series(app: AppHandle, state: State<'_, AppState>, id: i64) -> AppResult<()> {
    {
        let connection = state.conn()?;
        series::delete(&connection, id)?;
    }
    emit_changed(&app, ChangeScope::Series);
    Ok(())
}

// --------------------------------------------------------------- reasons ---

#[tauri::command]
pub fn list_reasons(state: State<'_, AppState>) -> AppResult<Vec<Reason>> {
    let connection = state.conn()?;
    reasons::list(&connection)
}

#[tauri::command]
pub fn create_reason(
    app: AppHandle,
    state: State<'_, AppState>,
    payload: ReasonUpsert,
) -> AppResult<Reason> {
    let created = {
        let connection = state.conn()?;
        reasons::create(&connection, payload)?
    };
    emit_changed(&app, ChangeScope::Reasons);
    Ok(created)
}

#[tauri::command]
pub fn update_reason(
    app: AppHandle,
    state: State<'_, AppState>,
    id: i64,
    payload: ReasonUpsert,
) -> AppResult<Reason> {
    let updated = {
        let connection = state.conn()?;
        reasons::update(&connection, id, payload)?
    };
    emit_changed(&app, ChangeScope::Reasons);
    Ok(updated)
}

#[tauri::command]
pub fn delete_reason(app: AppHandle, state: State<'_, AppState>, id: i64) -> AppResult<()> {
    {
        let connection = state.conn()?;
        reasons::delete(&connection, id)?;
    }
    emit_changed(&app, ChangeScope::Reasons);
    Ok(())
}

// --------------------------------------------------------------- workers ---

#[tauri::command]
pub fn list_workers(
    state: State<'_, AppState>,
    series_id: Option<i64>,
) -> AppResult<Vec<Worker>> {
    let connection = state.conn()?;
    workers::list(&connection, series_id.filter(|id| *id > 0))
}

#[tauri::command]
pub fn create_worker(
    app: AppHandle,
    state: State<'_, AppState>,
    payload: WorkerUpsert,
) -> AppResult<Worker> {
    let created = {
        let connection = state.conn()?;
        workers::create(&connection, payload)?
    };
    emit_changed(&app, ChangeScope::Workers);
    Ok(created)
}

#[tauri::command]
pub fn update_worker(
    app: AppHandle,
    state: State<'_, AppState>,
    id: i64,
    payload: WorkerUpsert,
) -> AppResult<Worker> {
    let updated = {
        let connection = state.conn()?;
        workers::update(&connection, id, payload)?
    };
    emit_changed(&app, ChangeScope::Workers);
    Ok(updated)
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteImpact {
    pub worker: Worker,
    /// Waste entries that would be removed along with the worker.
    pub logged_entries: i64,
}

/// Lets the confirm dialog warn about history that is about to be lost.
#[tauri::command]
pub fn worker_delete_impact(state: State<'_, AppState>, id: i64) -> AppResult<DeleteImpact> {
    let connection = state.conn()?;
    Ok(DeleteImpact {
        worker: workers::get(&connection, id)?,
        logged_entries: workers::logged_entry_count(&connection, id)?,
    })
}

#[tauri::command]
pub fn delete_worker(app: AppHandle, state: State<'_, AppState>, id: i64) -> AppResult<()> {
    {
        let connection = state.conn()?;
        workers::delete(&connection, id)?;
    }
    // A worker's entries go with them, so the waste grid is stale too.
    emit_changed(&app, ChangeScope::Everything);
    Ok(())
}

// ----------------------------------------------------------------- waste ---

#[tauri::command]
pub fn waste_dashboard(state: State<'_, AppState>, range: RangeQuery) -> AppResult<Dashboard> {
    let range = DateRange::resolve(&range)?;
    let connection = state.conn()?;
    logs::dashboard(&connection, &range)
}

#[tauri::command]
pub fn waste_logs(
    state: State<'_, AppState>,
    range: RangeQuery,
    worker_id: Option<i64>,
) -> AppResult<Vec<WorkerLog>> {
    let range = DateRange::resolve(&range)?;
    let connection = state.conn()?;
    logs::list(&connection, &range, worker_id.filter(|id| *id > 0))
}

/// One tap of a grade 3 / grade 4 button.
#[tauri::command]
pub fn add_waste_entry(
    app: AppHandle,
    state: State<'_, AppState>,
    entry: LogEntryRequest,
) -> AppResult<WorkerLog> {
    let added = {
        let connection = state.conn()?;
        logs::add_entry(&connection, &entry)?
    };
    emit_changed(&app, ChangeScope::Waste);
    Ok(added)
}

/// Removes the most recent matching tap — the fix for a mis-click.
#[tauri::command]
pub fn undo_waste_entry(
    app: AppHandle,
    state: State<'_, AppState>,
    entry: LogEntryRequest,
    range: RangeQuery,
) -> AppResult<WorkerLog> {
    let range = DateRange::resolve(&range)?;
    let removed = {
        let connection = state.conn()?;
        logs::remove_latest_entry(&connection, &range, &entry)?
    };
    emit_changed(&app, ChangeScope::Waste);
    Ok(removed)
}

// -------------------------------------------------------------- barcodes ---

/// Every barcode the scanning sheet shows: one per worker, and a grade 3 /
/// grade 4 pair per reason.
#[tauri::command]
pub fn barcode_sheet(state: State<'_, AppState>, series_id: Option<i64>) -> AppResult<Sheet> {
    let connection = state.conn()?;
    barcode_sheet::build(&connection, series_id)
}

/// Records the entry a scanned barcode stands for.
///
/// The barcode is the grade button, so a scan does exactly what a tap does:
/// one `worker_log` row, one `data-changed` event, the same validation. The
/// decode lives in Rust so the screen, the printed sheet and the reader can
/// never disagree about what a code means.
#[tauri::command]
pub fn record_scan(
    app: AppHandle,
    state: State<'_, AppState>,
    code: String,
) -> AppResult<ScanReceipt> {
    let scan = Scan::parse(&code)?;

    let (entry, worker, reason) = {
        let connection = state.conn()?;

        // Resolve both sides first, so a sheet printed before a worker was
        // removed fails with something the operator can act on rather than a
        // foreign key error.
        let worker = workers::get(&connection, scan.worker_id).map_err(|error| match error {
            AppError::NotFound(_) => AppError::NotFound(
                "That barcode is for a worker who is no longer on the register. \
                 Print a fresh sheet."
                    .to_string(),
            ),
            other => other,
        })?;
        let reason = reasons::get(&connection, scan.reason_id).map_err(|error| match error {
            AppError::NotFound(_) => AppError::NotFound(
                "That barcode is for a reason that has since been deleted. \
                 Print a fresh sheet."
                    .to_string(),
            ),
            other => other,
        })?;

        let entry = logs::add_entry(
            &connection,
            &LogEntryRequest {
                worker_id: scan.worker_id,
                reason_id: scan.reason_id,
                grade: scan.grade,
            },
        )?;
        (entry, worker, reason)
    };

    emit_changed(&app, ChangeScope::Waste);

    Ok(ScanReceipt {
        entry,
        worker_name: format!("{} {}", worker.first_name, worker.last_name).trim().to_string(),
        reason_name: reason.name,
        grade: scan.grade,
    })
}

/// What the scanning screen shows back after a successful scan.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanReceipt {
    pub entry: WorkerLog,
    pub worker_name: String,
    pub reason_name: String,
    pub grade: Grade,
}

/// Writes the scanning sheet to `path` for printing.
#[tauri::command]
pub fn export_barcodes_pdf(
    state: State<'_, AppState>,
    series_id: Option<i64>,
    path: String,
) -> AppResult<String> {
    let bytes = {
        let connection = state.conn()?;
        barcode_sheet::to_pdf(&barcode_sheet::build(&connection, series_id)?)
    };

    std::fs::write(&path, bytes).map_err(|error| {
        AppError::Internal(format!("Could not write the PDF to {path}: {error}"))
    })?;

    Ok(path)
}

// --------------------------------------------------------------- exports ---

/// Writes the month sheet to `path`, which the front end obtained from the
/// native save dialog. Returns the path so the caller can offer to open it.
#[tauri::command]
pub fn export_waste_pdf(
    state: State<'_, AppState>,
    range: RangeQuery,
    path: String,
) -> AppResult<String> {
    let bytes = {
        let range = DateRange::resolve(&range)?;
        let connection = state.conn()?;
        let dashboard = logs::dashboard(&connection, &range)?;
        let series_name = match range.series_id {
            Some(id) => Some(series::get(&connection, id)?.name),
            None => None,
        };

        to_pdf(&ReportContext {
            dashboard: &dashboard,
            range: &range,
            series_name: series_name.as_deref(),
            generated_at: now(),
        })
    };

    std::fs::write(&path, bytes).map_err(|error| {
        AppError::Internal(format!("Could not write the PDF to {path}: {error}"))
    })?;

    Ok(path)
}

#[tauri::command]
pub fn export_waste_csv(
    state: State<'_, AppState>,
    range: RangeQuery,
    path: String,
) -> AppResult<String> {
    let body = {
        let range = DateRange::resolve(&range)?;
        let connection = state.conn()?;
        let dashboard = logs::dashboard(&connection, &range)?;
        let series_name = match range.series_id {
            Some(id) => Some(series::get(&connection, id)?.name),
            None => None,
        };

        to_csv(&ReportContext {
            dashboard: &dashboard,
            range: &range,
            series_name: series_name.as_deref(),
            generated_at: now(),
        })
    };

    std::fs::write(&path, body).map_err(|error| {
        AppError::Internal(format!("Could not write the CSV to {path}: {error}"))
    })?;

    Ok(path)
}

// ------------------------------------------------------------------ demo ---

#[tauri::command]
pub fn seed_demo_data(
    app: AppHandle,
    state: State<'_, AppState>,
    force: bool,
) -> AppResult<String> {
    let summary = {
        let mut connection = state.conn()?;
        seed::run(&mut connection, force)?
    };

    emit_changed_with(&app, ChangeScope::Everything, summary.clone());
    Ok(summary)
}
