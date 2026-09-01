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
    Dashboard, Grade, GradeUpsert, LogEntryRequest, RangeQuery, Reason, ReasonUpsert,
    SeriesOfProduct, SeriesUpsert,
    Worker, WorkerLog, WorkerUpsert,
};
use crate::barcode_sheet::{self, Sheet};
use crate::report::{ReportContext, to_csv, to_pdf};
use crate::repo::{DateRange, barcodes, grades, logs, reasons, series, workers};
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

/// A stable identifier for this PC, used to bind an account to one machine.
///
/// `machine_uid` reads what the operating system already keeps — the
/// `IOPlatformUUID` on macOS, `MachineGuid` in the registry on Windows,
/// `/etc/machine-id` on Linux. It survives reinstalling the app and clearing
/// its data, which is the whole point: a licence that could be moved by
/// deleting a file would not be a licence.
///
/// It is deliberately not something the front end can supply. The value is
/// read here and travels to the account backend from the Rust side, so a
/// tampered-with front end cannot claim to be a different machine.
#[tauri::command]
pub fn device_id() -> AppResult<String> {
    machine_uid::get().map_err(|err| {
        AppError::Internal(format!("could not read this machine's identifier: {err}"))
    })
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

/// A new reason is a new column of grade buttons for every worker, so it
/// brings a new barcode for each of them.
#[tauri::command]
pub fn create_reason(
    app: AppHandle,
    state: State<'_, AppState>,
    payload: ReasonUpsert,
) -> AppResult<Reason> {
    let created = {
        let connection = state.conn()?;
        let created = reasons::create(&connection, payload)?;
        barcodes::sync(&connection)?;
        created
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

// ---------------------------------------------------------------- grades ---

#[tauri::command]
pub fn list_grades(state: State<'_, AppState>) -> AppResult<Vec<Grade>> {
    let connection = state.conn()?;
    grades::list(&connection)
}

/// A new grade is a new button in every worker's row, under every reason, so
/// it brings a barcode for each of those.
#[tauri::command]
pub fn create_grade(
    app: AppHandle,
    state: State<'_, AppState>,
    payload: GradeUpsert,
) -> AppResult<Grade> {
    let created = {
        let connection = state.conn()?;
        let created = grades::create(&connection, payload)?;
        barcodes::sync(&connection)?;
        created
    };
    emit_changed(&app, ChangeScope::Grades);
    Ok(created)
}

#[tauri::command]
pub fn update_grade(
    app: AppHandle,
    state: State<'_, AppState>,
    id: i64,
    payload: GradeUpsert,
) -> AppResult<Grade> {
    let updated = {
        let connection = state.conn()?;
        grades::update(&connection, id, payload)?
    };
    emit_changed(&app, ChangeScope::Grades);
    Ok(updated)
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GradeDeleteImpact {
    pub grade: Grade,
    /// Printed barcodes that would stop working, so the confirm dialog can say
    /// that a fresh sheet is needed.
    pub barcodes: i64,
}

#[tauri::command]
pub fn grade_delete_impact(state: State<'_, AppState>, id: i64) -> AppResult<GradeDeleteImpact> {
    let connection = state.conn()?;
    Ok(GradeDeleteImpact {
        grade: grades::get(&connection, id)?,
        barcodes: grades::barcode_count(&connection, id)?,
    })
}

#[tauri::command]
pub fn delete_grade(app: AppHandle, state: State<'_, AppState>, id: i64) -> AppResult<()> {
    {
        let connection = state.conn()?;
        grades::delete(&connection, id)?;
    }
    // A column leaves the grid and a barcode leaves the sheet.
    emit_changed(&app, ChangeScope::Everything);
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

/// A new worker gets a barcode for every button they now have — one per
/// reason per grade — so they can be scanned as soon as a sheet is printed.
#[tauri::command]
pub fn create_worker(
    app: AppHandle,
    state: State<'_, AppState>,
    payload: WorkerUpsert,
) -> AppResult<Worker> {
    let created = {
        let connection = state.conn()?;
        let created = workers::create(&connection, payload)?;
        barcodes::sync(&connection)?;
        created
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
/// one `worker_log` row, one `data-changed` event, the same validation. What
/// the code means is the row it was printed from rather than anything the
/// front end decodes, so the sheet, the PDF and the reader cannot disagree.
#[tauri::command]
pub fn record_scan(
    app: AppHandle,
    state: State<'_, AppState>,
    code: String,
) -> AppResult<ScanReceipt> {
    let entry = {
        let connection = state.conn()?;
        let button = barcodes::find(&connection, &code)?;

        logs::add_entry(
            &connection,
            &LogEntryRequest {
                worker_id: button.worker_id,
                reason_id: button.reason_id,
                grade_id: button.grade_id,
            },
        )?
    };

    emit_changed(&app, ChangeScope::Waste);

    // `WorkerLog` already carries the worker, reason and grade names the
    // confirmation shows, so the receipt is the entry plus nothing.
    Ok(ScanReceipt { entry })
}

/// What the scanning screen shows back after a successful scan.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanReceipt {
    pub entry: WorkerLog,
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
