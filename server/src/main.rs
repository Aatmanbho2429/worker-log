mod db;
mod error;
mod models;
mod pdf;
mod report;
mod repo;
mod routes;
mod state;

use std::net::SocketAddr;
use std::path::PathBuf;

use chrono::Local;
use tracing_subscriber::EnvFilter;

/// The current local timestamp, in the `YYYY-MM-DD HH:MM:SS` form every
/// `created_date` / `modified_date` column stores.
///
/// Local rather than UTC on purpose: the shop floor files this sheet by its
/// own calendar day, so an entry logged at 9pm has to land on that day's
/// report. Set `TZ` on the host if the server is not in the factory's zone.
pub fn now() -> String {
    Local::now().format("%Y-%m-%d %H:%M:%S").to_string()
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_from_env("WORKER_LOG_LOG")
                .unwrap_or_else(|_| EnvFilter::new("worker_log=info,tower_http=warn")),
        )
        .init();

    let database_path = std::env::var("WORKER_LOG_DB")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from("worker-log.db"));

    let port: u16 = std::env::var("WORKER_LOG_PORT")
        .ok()
        .and_then(|value| value.parse().ok())
        .unwrap_or(8080);

    let db = db::open(&database_path)?;
    tracing::info!(path = %database_path.display(), "opened local database");

    let app = routes::router(state::AppState::new(db));
    let addr = SocketAddr::from(([127, 0, 0, 1], port));
    let listener = tokio::net::TcpListener::bind(addr).await?;

    tracing::info!(%addr, "worker-log api listening");
    axum::serve(listener, app).await?;

    Ok(())
}
