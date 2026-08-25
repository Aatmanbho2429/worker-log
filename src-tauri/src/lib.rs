mod barcode;
mod barcode_sheet;
mod commands;
mod db;
mod error;
mod events;
mod models;
mod pdf;
mod report;
mod repo;
mod seed;
mod state;

use chrono::Local;
use tauri::Manager;

/// The current local timestamp, in the `YYYY-MM-DD HH:MM:SS` form every
/// `created_date` / `modified_date` column stores.
///
/// Local rather than UTC on purpose: the shop floor files this sheet by its
/// own calendar day, so an entry logged at 9pm has to land on that day's
/// report.
pub fn now() -> String {
    Local::now().format("%Y-%m-%d %H:%M:%S").to_string()
}

/// A `seed [--force]` invocation, if that is what the binary was launched for.
///
/// The demo register is otherwise only reachable from the Settings screen,
/// which is no help when setting a terminal up over SSH or from a script.
fn seed_request() -> Option<bool> {
    let mut args = std::env::args().skip(1).filter(|arg| arg != "--");
    if args.next().as_deref() != Some("seed") {
        return None;
    }
    Some(args.any(|arg| arg == "--force" || arg == "-f"))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(
            tauri_plugin_log::Builder::new()
                .level(log::LevelFilter::Info)
                .build(),
        )
        .setup(|app| {
            // The database lives beside the app's own data, not in whatever
            // directory the executable happened to be launched from.
            let path = state::database_path(app.handle())?;
            let db = db::open(&path)?;

            // Seeding from the terminal writes the register and leaves,
            // rather than falling through and opening the app.
            if let Some(force) = seed_request() {
                let mut connection =
                    db.lock().expect("a connection opened moments ago cannot be poisoned");
                let code = match seed::run(&mut connection, force) {
                    Ok(summary) => {
                        println!("{summary}");
                        println!("database: {}", path.display());
                        0
                    }
                    Err(error) => {
                        eprintln!("seeding failed: {error}");
                        1
                    }
                };
                // `exit` runs no destructors, so fold the write-ahead log back
                // into the database file by hand before leaving.
                let _ = connection.execute_batch("PRAGMA wal_checkpoint(TRUNCATE);");
                std::process::exit(code);
            }

            log::info!("opened local database at {}", path.display());
            app.manage(state::AppState::new(db, path));

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::app_info,
            commands::list_series,
            commands::create_series,
            commands::update_series,
            commands::delete_series,
            commands::list_reasons,
            commands::create_reason,
            commands::update_reason,
            commands::delete_reason,
            commands::list_workers,
            commands::create_worker,
            commands::update_worker,
            commands::delete_worker,
            commands::worker_delete_impact,
            commands::waste_dashboard,
            commands::waste_logs,
            commands::add_waste_entry,
            commands::undo_waste_entry,
            commands::export_waste_pdf,
            commands::export_waste_csv,
            commands::barcode_sheet,
            commands::record_scan,
            commands::export_barcodes_pdf,
            commands::seed_demo_data,
        ])
        .run(tauri::generate_context!())
        .expect("error while running the waste log application");
}
