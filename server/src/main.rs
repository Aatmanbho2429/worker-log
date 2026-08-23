mod db;
mod error;
mod models;
mod pdf;
mod report;
mod repo;
mod routes;
mod seed;
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

enum Command {
    Serve,
    Seed { force: bool },
}

const USAGE: &str = "\
worker-log — waste log API for a ceramic sanitaryware line

USAGE:
    worker-log [serve]        Run the API (default)
    worker-log seed [--force] Fill the database with demo data
    worker-log --help

ENVIRONMENT:
    WORKER_LOG_DB    SQLite file path        (default: worker-log.db)
    WORKER_LOG_PORT  API port                (default: 8080)
    WORKER_LOG_LOG   tracing filter          (default: worker_log=info)
";

/// Exits directly on `--help` and on bad input: returning these through
/// `main`'s `Box<dyn Error>` would print them Debug-formatted, with the usage
/// text collapsed onto one line full of escaped newlines.
fn parse_args() -> Command {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let flags: Vec<&str> = args.iter().map(String::as_str).collect();

    match flags.as_slice() {
        [] | ["serve"] => Command::Serve,
        ["seed"] => Command::Seed { force: false },
        ["seed", "--force"] => Command::Seed { force: true },
        ["--help" | "-h"] => {
            print!("{USAGE}");
            std::process::exit(0);
        }
        other => {
            eprintln!("Unrecognised arguments: {}\n\n{USAGE}", other.join(" "));
            std::process::exit(2);
        }
    }
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let command = parse_args();

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

    if let Command::Seed { force } = command {
        let mut connection = db
            .lock()
            .map_err(|_| "the database connection was poisoned".to_string())?;
        if let Err(error) = seed::run(&mut connection, force) {
            eprintln!("{error}");
            std::process::exit(1);
        }
        return Ok(());
    }

    let app = routes::router(state::AppState::new(db));
    let addr = SocketAddr::from(([127, 0, 0, 1], port));
    let listener = tokio::net::TcpListener::bind(addr).await?;

    tracing::info!(%addr, "worker-log api listening");
    axum::serve(listener, app).await?;

    Ok(())
}
