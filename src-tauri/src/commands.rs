//! The `invoke` surface. One command per thing the front end can ask for,
//! replacing what used to be HTTP routes.
//!
//! Commands are synchronous: every one is a short local SQLite call, and
//! keeping them sync means the connection guard is taken and released inside
//! a single call with no await points to reason about.

use tauri::{AppHandle, State};

use crate::error::{AppError, AppResult};
use crate::events::{ChangeScope, emit_changed, emit_changed_with};
use crate::models::{
    ApiResponse, AppInfo, BarcodeSheet, Dashboard, Grade, GradeDeleteImpact, GradeUpsert,
    LogEntryRequest, RangeQuery, Reason, ReasonUpsert, ScanReceipt, SeriesOfProduct, SeriesUpsert,
    Worker, WorkerDeleteImpact, WorkerLog, WorkerUpsert,
};
use crate::barcode_sheet;
use crate::report::{ReportContext, to_csv, to_pdf};
use crate::repo::{DateRange, barcodes, grades, logs, reasons, series, workers};
use crate::state::AppState;
use crate::{now, seed};

#[tauri::command]
pub fn app_info(state: State<'_, AppState>) -> ApiResponse<AppInfo> {
    ApiResponse::ok(AppInfo {
        version: env!("CARGO_PKG_VERSION").to_string(),
        database_path: state.database_path().display().to_string(),
    })
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
fn device_id_impl() -> AppResult<String> {
    machine_uid::get().map_err(|err| {
        AppError::Internal(format!("could not read this machine's identifier: {err}"))
    })
}

#[tauri::command]
pub fn device_id() -> ApiResponse<String> {
    device_id_impl().into()
}

// ---------------------------------------------------------------- series ---

fn list_series_impl(state: State<'_, AppState>) -> AppResult<Vec<SeriesOfProduct>> {
    let connection = state.conn()?;
    series::list(&connection)
}

#[tauri::command]
pub fn list_series(state: State<'_, AppState>) -> ApiResponse<Vec<SeriesOfProduct>> {
    list_series_impl(state).into()
}

fn create_series_impl(app: AppHandle, state: State<'_, AppState>, payload: SeriesUpsert,) -> AppResult<SeriesOfProduct> {
    let created = {
        let connection = state.conn()?;
        series::create(&connection, payload)?
    };
    emit_changed(&app, ChangeScope::Series);
    Ok(created)
}

#[tauri::command]
pub fn create_series(app: AppHandle, state: State<'_, AppState>, payload: SeriesUpsert,) -> ApiResponse<SeriesOfProduct> {
    create_series_impl(app, state, payload).into()
}

fn update_series_impl(app: AppHandle, state: State<'_, AppState>, id: i64, payload: SeriesUpsert,) -> AppResult<SeriesOfProduct> {
    let updated = {
        let connection = state.conn()?;
        series::update(&connection, id, payload)?
    };
    emit_changed(&app, ChangeScope::Series);
    Ok(updated)
}

#[tauri::command]
pub fn update_series(app: AppHandle, state: State<'_, AppState>, id: i64, payload: SeriesUpsert,) -> ApiResponse<SeriesOfProduct> {
    update_series_impl(app, state, id, payload).into()
}

fn delete_series_impl(app: AppHandle, state: State<'_, AppState>, id: i64) -> AppResult<()> {
    {
        let connection = state.conn()?;
        series::delete(&connection, id)?;
    }
    emit_changed(&app, ChangeScope::Series);
    Ok(())
}

#[tauri::command]
pub fn delete_series(app: AppHandle, state: State<'_, AppState>, id: i64) -> ApiResponse<()> {
    delete_series_impl(app, state, id).into()
}

// --------------------------------------------------------------- reasons ---

fn list_reasons_impl(state: State<'_, AppState>) -> AppResult<Vec<Reason>> {
    let connection = state.conn()?;
    reasons::list(&connection)
}

#[tauri::command]
pub fn list_reasons(state: State<'_, AppState>) -> ApiResponse<Vec<Reason>> {
    list_reasons_impl(state).into()
}

/// A new reason is a new column of grade buttons for every worker, so it
/// brings a new barcode for each of them.
fn create_reason_impl(app: AppHandle, state: State<'_, AppState>, payload: ReasonUpsert,) -> AppResult<Reason> {
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
pub fn create_reason(app: AppHandle, state: State<'_, AppState>, payload: ReasonUpsert,) -> ApiResponse<Reason> {
    create_reason_impl(app, state, payload).into()
}

fn update_reason_impl(app: AppHandle, state: State<'_, AppState>, id: i64, payload: ReasonUpsert,) -> AppResult<Reason> {
    let updated = {
        let connection = state.conn()?;
        reasons::update(&connection, id, payload)?
    };
    emit_changed(&app, ChangeScope::Reasons);
    Ok(updated)
}

#[tauri::command]
pub fn update_reason(app: AppHandle, state: State<'_, AppState>, id: i64, payload: ReasonUpsert,) -> ApiResponse<Reason> {
    update_reason_impl(app, state, id, payload).into()
}

fn delete_reason_impl(app: AppHandle, state: State<'_, AppState>, id: i64) -> AppResult<()> {
    {
        let connection = state.conn()?;
        reasons::delete(&connection, id)?;
    }
    emit_changed(&app, ChangeScope::Reasons);
    Ok(())
}

#[tauri::command]
pub fn delete_reason(app: AppHandle, state: State<'_, AppState>, id: i64) -> ApiResponse<()> {
    delete_reason_impl(app, state, id).into()
}

// ---------------------------------------------------------------- grades ---

fn list_grades_impl(state: State<'_, AppState>) -> AppResult<Vec<Grade>> {
    let connection = state.conn()?;
    grades::list(&connection)
}

#[tauri::command]
pub fn list_grades(state: State<'_, AppState>) -> ApiResponse<Vec<Grade>> {
    list_grades_impl(state).into()
}

/// A new grade is a new button in every worker's row, under every reason, so
/// it brings a barcode for each of those.
fn create_grade_impl(app: AppHandle, state: State<'_, AppState>, payload: GradeUpsert,) -> AppResult<Grade> {
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
pub fn create_grade(app: AppHandle, state: State<'_, AppState>, payload: GradeUpsert,) -> ApiResponse<Grade> {
    create_grade_impl(app, state, payload).into()
}

fn update_grade_impl(app: AppHandle, state: State<'_, AppState>, id: i64, payload: GradeUpsert,) -> AppResult<Grade> {
    let updated = {
        let connection = state.conn()?;
        grades::update(&connection, id, payload)?
    };
    emit_changed(&app, ChangeScope::Grades);
    Ok(updated)
}

#[tauri::command]
pub fn update_grade(app: AppHandle, state: State<'_, AppState>, id: i64, payload: GradeUpsert,) -> ApiResponse<Grade> {
    update_grade_impl(app, state, id, payload).into()
}

fn grade_delete_impact_impl(state: State<'_, AppState>, id: i64) -> AppResult<GradeDeleteImpact> {
    let connection = state.conn()?;
    Ok(GradeDeleteImpact {
        grade: grades::get(&connection, id)?,
        barcodes: grades::barcode_count(&connection, id)?,
    })
}

#[tauri::command]
pub fn grade_delete_impact(state: State<'_, AppState>, id: i64) -> ApiResponse<GradeDeleteImpact> {
    grade_delete_impact_impl(state, id).into()
}

fn delete_grade_impl(app: AppHandle, state: State<'_, AppState>, id: i64) -> AppResult<()> {
    {
        let connection = state.conn()?;
        grades::delete(&connection, id)?;
    }
    // A column leaves the grid and a barcode leaves the sheet.
    emit_changed(&app, ChangeScope::Everything);
    Ok(())
}

#[tauri::command]
pub fn delete_grade(app: AppHandle, state: State<'_, AppState>, id: i64) -> ApiResponse<()> {
    delete_grade_impl(app, state, id).into()
}

// --------------------------------------------------------------- workers ---

fn list_workers_impl(state: State<'_, AppState>, series_id: Option<i64>,) -> AppResult<Vec<Worker>> {
    let connection = state.conn()?;
    workers::list(&connection, series_id.filter(|id| *id > 0))
}

#[tauri::command]
pub fn list_workers(state: State<'_, AppState>, series_id: Option<i64>,) -> ApiResponse<Vec<Worker>> {
    list_workers_impl(state, series_id).into()
}

/// A new worker gets a barcode for every button they now have — one per
/// reason per grade — so they can be scanned as soon as a sheet is printed.
fn create_worker_impl(app: AppHandle, state: State<'_, AppState>, payload: WorkerUpsert,) -> AppResult<Worker> {
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
pub fn create_worker(app: AppHandle, state: State<'_, AppState>, payload: WorkerUpsert,) -> ApiResponse<Worker> {
    create_worker_impl(app, state, payload).into()
}

fn update_worker_impl(app: AppHandle, state: State<'_, AppState>, id: i64, payload: WorkerUpsert,) -> AppResult<Worker> {
    let updated = {
        let connection = state.conn()?;
        workers::update(&connection, id, payload)?
    };
    emit_changed(&app, ChangeScope::Workers);
    Ok(updated)
}

#[tauri::command]
pub fn update_worker(app: AppHandle, state: State<'_, AppState>, id: i64, payload: WorkerUpsert,) -> ApiResponse<Worker> {
    update_worker_impl(app, state, id, payload).into()
}

/// Lets the confirm dialog warn about history that is about to be lost.
fn worker_delete_impact_impl(state: State<'_, AppState>, id: i64) -> AppResult<WorkerDeleteImpact> {
    let connection = state.conn()?;
    Ok(WorkerDeleteImpact {
        worker: workers::get(&connection, id)?,
        logged_entries: workers::logged_entry_count(&connection, id)?,
    })
}

#[tauri::command]
pub fn worker_delete_impact(state: State<'_, AppState>, id: i64) -> ApiResponse<WorkerDeleteImpact> {
    worker_delete_impact_impl(state, id).into()
}

fn delete_worker_impl(app: AppHandle, state: State<'_, AppState>, id: i64) -> AppResult<()> {
    {
        let connection = state.conn()?;
        workers::delete(&connection, id)?;
    }
    // A worker's entries go with them, so the waste grid is stale too.
    emit_changed(&app, ChangeScope::Everything);
    Ok(())
}

#[tauri::command]
pub fn delete_worker(app: AppHandle, state: State<'_, AppState>, id: i64) -> ApiResponse<()> {
    delete_worker_impl(app, state, id).into()
}

// ----------------------------------------------------------------- waste ---

fn waste_dashboard_impl(state: State<'_, AppState>, range: RangeQuery) -> AppResult<Dashboard> {
    let range = DateRange::resolve(&range)?;
    let connection = state.conn()?;
    logs::dashboard(&connection, &range)
}

#[tauri::command]
pub fn waste_dashboard(state: State<'_, AppState>, range: RangeQuery) -> ApiResponse<Dashboard> {
    waste_dashboard_impl(state, range).into()
}

fn waste_logs_impl(state: State<'_, AppState>, range: RangeQuery, worker_id: Option<i64>,) -> AppResult<Vec<WorkerLog>> {
    let range = DateRange::resolve(&range)?;
    let connection = state.conn()?;
    logs::list(&connection, &range, worker_id.filter(|id| *id > 0))
}

#[tauri::command]
pub fn waste_logs(state: State<'_, AppState>, range: RangeQuery, worker_id: Option<i64>,) -> ApiResponse<Vec<WorkerLog>> {
    waste_logs_impl(state, range, worker_id).into()
}

/// One tap of a grade 3 / grade 4 button.
fn add_waste_entry_impl(app: AppHandle, state: State<'_, AppState>, entry: LogEntryRequest,) -> AppResult<WorkerLog> {
    let added = {
        let connection = state.conn()?;
        logs::add_entry(&connection, &entry)?
    };
    emit_changed(&app, ChangeScope::Waste);
    Ok(added)
}

#[tauri::command]
pub fn add_waste_entry(app: AppHandle, state: State<'_, AppState>, entry: LogEntryRequest,) -> ApiResponse<WorkerLog> {
    add_waste_entry_impl(app, state, entry).into()
}

/// Removes the most recent matching tap — the fix for a mis-click.
fn undo_waste_entry_impl(app: AppHandle, state: State<'_, AppState>, entry: LogEntryRequest, range: RangeQuery,) -> AppResult<WorkerLog> {
    let range = DateRange::resolve(&range)?;
    let removed = {
        let connection = state.conn()?;
        logs::remove_latest_entry(&connection, &range, &entry)?
    };
    emit_changed(&app, ChangeScope::Waste);
    Ok(removed)
}

#[tauri::command]
pub fn undo_waste_entry(app: AppHandle, state: State<'_, AppState>, entry: LogEntryRequest, range: RangeQuery,) -> ApiResponse<WorkerLog> {
    undo_waste_entry_impl(app, state, entry, range).into()
}

// -------------------------------------------------------------- barcodes ---

/// Every barcode the scanning sheet shows: one per worker, and a grade 3 /
/// grade 4 pair per reason.
fn barcode_sheet_impl(state: State<'_, AppState>, series_id: Option<i64>) -> AppResult<BarcodeSheet> {
    let connection = state.conn()?;
    barcode_sheet::build(&connection, series_id)
}

#[tauri::command]
pub fn barcode_sheet(state: State<'_, AppState>, series_id: Option<i64>) -> ApiResponse<BarcodeSheet> {
    barcode_sheet_impl(state, series_id).into()
}

/// Records the entry a scanned barcode stands for.
///
/// The barcode is the grade button, so a scan does exactly what a tap does:
/// one `worker_log` row, one `data-changed` event, the same validation. What
/// the code means is the row it was printed from rather than anything the
/// front end decodes, so the sheet, the PDF and the reader cannot disagree.
fn record_scan_impl(app: AppHandle, state: State<'_, AppState>, code: String,) -> AppResult<ScanReceipt> {
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

#[tauri::command]
pub fn record_scan(app: AppHandle, state: State<'_, AppState>, code: String,) -> ApiResponse<ScanReceipt> {
    record_scan_impl(app, state, code).into()
}

/// Writes the scanning sheet to `path` for printing.
fn export_barcodes_pdf_impl(state: State<'_, AppState>, series_id: Option<i64>, path: String,) -> AppResult<String> {
    let bytes = {
        let connection = state.conn()?;
        barcode_sheet::to_pdf(&barcode_sheet::build(&connection, series_id)?)
    };

    std::fs::write(&path, bytes).map_err(|error| {
        AppError::Internal(format!("Could not write the PDF to {path}: {error}"))
    })?;

    Ok(path)
}

#[tauri::command]
pub fn export_barcodes_pdf(state: State<'_, AppState>, series_id: Option<i64>, path: String,) -> ApiResponse<String> {
    export_barcodes_pdf_impl(state, series_id, path).into()
}

// --------------------------------------------------------------- exports ---

/// Writes the month sheet to `path`, which the front end obtained from the
/// native save dialog. Returns the path so the caller can offer to open it.
fn export_waste_pdf_impl(state: State<'_, AppState>, range: RangeQuery, path: String,) -> AppResult<String> {
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
pub fn export_waste_pdf(state: State<'_, AppState>, range: RangeQuery, path: String,) -> ApiResponse<String> {
    export_waste_pdf_impl(state, range, path).into()
}

fn export_waste_csv_impl(state: State<'_, AppState>, range: RangeQuery, path: String,) -> AppResult<String> {
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

#[tauri::command]
pub fn export_waste_csv(state: State<'_, AppState>, range: RangeQuery, path: String,) -> ApiResponse<String> {
    export_waste_csv_impl(state, range, path).into()
}

// ------------------------------------------------------------------ demo ---

fn seed_demo_data_impl(app: AppHandle, state: State<'_, AppState>, force: bool,) -> AppResult<String> {
    let summary = {
        let mut connection = state.conn()?;
        seed::run(&mut connection, force)?
    };

    emit_changed_with(&app, ChangeScope::Everything, summary.clone());
    Ok(summary)
}

#[tauri::command]
pub fn seed_demo_data(app: AppHandle, state: State<'_, AppState>, force: bool,) -> ApiResponse<String> {
    seed_demo_data_impl(app, state, force).into()
}
