// Hides the console window that would otherwise sit behind the app on Windows.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    worker_log_lib::run()
}
