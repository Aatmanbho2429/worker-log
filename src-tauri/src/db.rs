use std::path::Path;
use std::sync::{Arc, Mutex};

use rusqlite::Connection;

/// The whole app is one shop floor terminal talking to a file on disk, so a
/// single guarded connection is both sufficient and the simplest thing that
/// keeps writes serialised. Handlers must not hold the guard across an await.
pub type Db = Arc<Mutex<Connection>>;

const SCHEMA: &str = include_str!("../migrations/0001_init.sql");

/// Reasons taken from the printed sheet this app replaces. They are seeded
/// once, on an empty table; renaming or adding to them afterwards is done
/// through the Reasons screen and is never overwritten on restart.
const SEED_REASONS: [&str; 10] = [
    "Karigar",
    "Other",
    "Loader",
    "Bhatthi",
    "Handling",
    "Kachu",
    "Repair",
    "Glazing",
    "Pressure",
    "Sorting",
];

pub fn open(path: impl AsRef<Path>) -> rusqlite::Result<Db> {
    let connection = Connection::open(path)?;

    connection.pragma_update(None, "journal_mode", "WAL")?;
    connection.pragma_update(None, "foreign_keys", "ON")?;
    connection.pragma_update(None, "busy_timeout", 5_000)?;

    connection.execute_batch(SCHEMA)?;
    seed_reasons(&connection)?;

    Ok(Arc::new(Mutex::new(connection)))
}

fn seed_reasons(connection: &Connection) -> rusqlite::Result<()> {
    let existing: i64 = connection.query_row("SELECT COUNT(*) FROM reason", [], |row| row.get(0))?;
    if existing > 0 {
        return Ok(());
    }

    let now = crate::now();
    let mut insert = connection.prepare(
        "INSERT INTO reason (name, sort_order, created_date, modified_date)
         VALUES (?1, ?2, ?3, ?3)",
    )?;

    for (index, name) in SEED_REASONS.iter().enumerate() {
        insert.execute(rusqlite::params![name, index as i64, now])?;
    }

    log::info!("seeded {} default waste reasons", SEED_REASONS.len());
    Ok(())
}
