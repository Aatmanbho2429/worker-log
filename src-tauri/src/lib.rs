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
            commands::seed_demo_data,
        ])
        .run(tauri::generate_context!())
        .expect("error while running the waste log application");
}
