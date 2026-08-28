use std::path::Path;
use std::sync::{Arc, Mutex};

use rusqlite::Connection;

/// The whole app is one shop floor terminal talking to a file on disk, so a
/// single guarded connection is both sufficient and the simplest thing that
/// keeps writes serialised. Handlers must not hold the guard across an await.
pub type Db = Arc<Mutex<Connection>>;

/// Applied in order, once each, tracked by `PRAGMA user_version`.
///
/// A database from before the pragma was used reports version 0, which is why
/// `0001` is written entirely in `IF NOT EXISTS` form: re-running it over an
/// already-initialised register has to be a no-op.
const MIGRATIONS: [&str; 2] = [
    include_str!("../migrations/0001_init.sql"),
    include_str!("../migrations/0002_grades.sql"),
];

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

    migrate(&connection)?;
    seed_reasons(&connection)?;

    // Grades and reasons both exist by now, so every button the waste screen
    // can draw gets the barcode that stands in for it. This also covers the
    // register that was already full before barcodes were stored at all.
    match crate::repo::barcodes::sync(&connection) {
        Ok(0) => {}
        Ok(added) => log::info!("generated {added} barcode(s) for new grade buttons"),
        Err(error) => log::error!("could not generate barcodes: {error}"),
    }

    Ok(Arc::new(Mutex::new(connection)))
}

fn migrate(connection: &Connection) -> rusqlite::Result<()> {
    let applied: i64 = connection.query_row("PRAGMA user_version", [], |row| row.get(0))?;

    for (index, sql) in MIGRATIONS.iter().enumerate() {
        let version = index as i64 + 1;
        if applied >= version {
            continue;
        }

        // One transaction per migration, so a failure halfway through leaves
        // the register on the last version that fully applied.
        connection.execute_batch(&format!(
            "BEGIN;\n{sql}\nPRAGMA user_version = {version};\nCOMMIT;"
        ))?;
        log::info!("applied database migration {version}");
    }

    Ok(())
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

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::params;

    /// A register as it stood before grades were rows: `worker_log` counting
    /// into `grade3` / `grade4`, and no `grade` or `barcode` table at all.
    fn version_one_database() -> Connection {
        let connection = Connection::open_in_memory().expect("an in-memory database");
        connection.pragma_update(None, "foreign_keys", "ON").unwrap();
        connection.execute_batch(MIGRATIONS[0]).expect("the initial schema");

        connection
            .execute(
                "INSERT INTO series_of_product (id, name, created_date, modified_date)
                 VALUES (1, 'Toilet 3007', '2026-07-01 08:00:00', '2026-07-01 08:00:00')",
                [],
            )
            .unwrap();
        connection
            .execute(
                "INSERT INTO worker (id, first_name, last_name, series_of_product_id,
                                     created_date, modified_date)
                 VALUES (1, 'Ramesh', 'Patel', 1, '2026-07-01 08:00:00', '2026-07-01 08:00:00')",
                [],
            )
            .unwrap();
        connection
            .execute(
                "INSERT INTO reason (id, name, sort_order, created_date, modified_date)
                 VALUES (1, 'Loader', 0, '2026-07-01 08:00:00', '2026-07-01 08:00:00')",
                [],
            )
            .unwrap();

        connection
    }

    fn log_entry(connection: &Connection, grade3: i64, grade4: i64) {
        connection
            .execute(
                "INSERT INTO worker_log (worker_id, grade3, grade4, reason_id,
                                         created_date, modified_date)
                 VALUES (1, ?1, ?2, 1, '2026-07-04 10:00:00', '2026-07-04 10:00:00')",
                params![grade3, grade4],
            )
            .unwrap();
    }

    #[test]
    fn a_fresh_database_ships_with_grade_3_and_grade_4() {
        let connection = Connection::open_in_memory().unwrap();
        migrate(&connection).expect("migrations apply to an empty database");

        let grades: Vec<(i64, String)> = connection
            .prepare("SELECT id, name FROM grade ORDER BY id")
            .unwrap()
            .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
            .unwrap()
            .collect::<rusqlite::Result<_>>()
            .unwrap();

        // The ids are load-bearing, not incidental: the barcode payload carries
        // one in the digit that used to carry the grade number, which is what
        // keeps an already-printed sheet scanning.
        assert_eq!(
            grades,
            vec![(3, "Grade 3".to_string()), (4, "Grade 4".to_string())],
            "grade 3 and grade 4 must keep the ids their barcodes were printed with"
        );
    }

    #[test]
    fn migrations_are_applied_once_and_are_safe_to_re_run() {
        let connection = Connection::open_in_memory().unwrap();

        migrate(&connection).unwrap();
        let version: i64 = connection.query_row("PRAGMA user_version", [], |r| r.get(0)).unwrap();
        assert_eq!(version, MIGRATIONS.len() as i64);

        // Opening the register again must not rebuild `worker_log` or seed a
        // second pair of grades.
        migrate(&connection).expect("a second open is a no-op");
        let grades: i64 =
            connection.query_row("SELECT COUNT(*) FROM grade", [], |r| r.get(0)).unwrap();
        assert_eq!(grades, 2);
    }

    /// The `user_version` pragma was not used before this migration, so an
    /// existing register reports 0 and has to survive `0001` being re-run over
    /// it before `0002` rebuilds the log.
    #[test]
    fn an_existing_register_keeps_its_waste_history() {
        let connection = version_one_database();
        log_entry(&connection, 1, 0);
        log_entry(&connection, 0, 1);
        log_entry(&connection, 1, 0);

        migrate(&connection).expect("migrating a populated version 1 database");

        let rows: Vec<i64> = connection
            .prepare("SELECT grade_id FROM worker_log ORDER BY id")
            .unwrap()
            .query_map([], |row| row.get(0))
            .unwrap()
            .collect::<rusqlite::Result<_>>()
            .unwrap();

        assert_eq!(rows, vec![3, 3, 4], "every tap kept its grade");

        let worker: i64 = connection
            .query_row("SELECT COUNT(*) FROM worker", [], |r| r.get(0))
            .unwrap();
        assert_eq!(worker, 1, "the register itself is untouched");
    }

    /// Nothing writes a count above one, but rounding one down to a single
    /// entry would quietly lose a piece off the month's total.
    #[test]
    fn a_row_counting_more_than_one_piece_becomes_that_many_entries() {
        let connection = version_one_database();
        log_entry(&connection, 3, 0);
        log_entry(&connection, 0, 2);

        migrate(&connection).unwrap();

        let mut counts: Vec<i64> = connection
            .prepare("SELECT grade_id FROM worker_log")
            .unwrap()
            .query_map([], |row| row.get(0))
            .unwrap()
            .collect::<rusqlite::Result<_>>()
            .unwrap();
        counts.sort_unstable();

        assert_eq!(counts, vec![3, 3, 3, 4, 4]);
    }

    /// A register that predates the barcode table gets its codes on the next
    /// open, and every button gets exactly one.
    #[test]
    fn opening_an_existing_register_generates_its_missing_barcodes() {
        let connection = version_one_database();
        migrate(&connection).unwrap();

        let made = crate::repo::barcodes::sync(&connection).expect("barcodes are generated");
        assert_eq!(made, 2, "one worker x one reason x two grades");

        // Running again finds nothing left to do, so a code already on a
        // printed sheet is never reissued.
        assert_eq!(crate::repo::barcodes::sync(&connection).unwrap(), 0);

        let buttons: Vec<(String, i64)> = connection
            .prepare("SELECT barcode, grade_id FROM barcode ORDER BY grade_id")
            .unwrap()
            .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
            .unwrap()
            .collect::<rusqlite::Result<_>>()
            .unwrap();

        assert_eq!(buttons.len(), 2);
        for (code, grade_id) in buttons {
            let scan = crate::barcode::Scan::parse(&code).expect("a code the reader accepts");
            assert_eq!(scan.grade_id, grade_id);
            assert_eq!((scan.worker_id, scan.reason_id), (1, 1));
        }
    }

    /// The sheet is built out of the `barcode` table, so what is printed and
    /// what a scan resolves to are the same row.
    #[test]
    fn the_scanning_sheet_prints_the_stored_codes() {
        let connection = version_one_database();
        migrate(&connection).unwrap();
        crate::repo::barcodes::sync(&connection).unwrap();

        let sheet = crate::barcode_sheet::build(&connection, None).expect("a sheet");
        assert_eq!(sheet.grades.len(), 2);
        assert_eq!(sheet.reasons.len(), 1);

        let row = &sheet.reasons[0].rows[0];
        assert_eq!(row.tiles.len(), 2, "a tile per grade");

        for tile in &row.tiles {
            // Every printed code resolves back to the button it was drawn for.
            let button = crate::repo::barcodes::find(&connection, &tile.symbol.code)
                .expect("a code the reader accepts");
            assert_eq!(
                (button.worker_id, button.reason_id, button.grade_id),
                (row.worker_id, sheet.reasons[0].reason_id, tile.grade_id)
            );
        }
    }

    /// The whole point of the barcode: scanning one writes the entry that
    /// tapping its button would have, and scanning it twice writes two.
    #[test]
    fn scanning_a_code_records_an_entry_against_its_button() {
        let connection = version_one_database();
        migrate(&connection).unwrap();
        crate::repo::barcodes::sync(&connection).unwrap();

        let code: String = connection
            .query_row("SELECT barcode FROM barcode WHERE grade_id = 4", [], |row| row.get(0))
            .unwrap();

        // Exactly what `commands::record_scan` does with a code off a reader.
        for _ in 0..2 {
            let button = crate::repo::barcodes::find(&connection, &code).expect("a known code");
            crate::repo::logs::add_entry(
                &connection,
                &crate::models::LogEntryRequest {
                    worker_id: button.worker_id,
                    reason_id: button.reason_id,
                    grade_id: button.grade_id,
                },
            )
            .expect("the entry is recorded");
        }

        let logged: Vec<(i64, i64, i64)> = connection
            .prepare("SELECT worker_id, reason_id, grade_id FROM worker_log ORDER BY id")
            .unwrap()
            .query_map([], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))
            .unwrap()
            .collect::<rusqlite::Result<_>>()
            .unwrap();

        assert_eq!(logged, vec![(1, 1, 4), (1, 1, 4)], "one row per scan, on the scanned button");
    }

    /// Scanners are pointed at whatever is in front of them, so anything that
    /// is not one of our codes has to be a normal outcome rather than a fault.
    #[test]
    fn a_code_that_is_not_on_the_sheet_is_refused() {
        let connection = version_one_database();
        migrate(&connection).unwrap();
        crate::repo::barcodes::sync(&connection).unwrap();

        // A carton barcode: right length, wrong marker.
        assert!(crate::repo::barcodes::find(&connection, "500123456789").is_err());
        // Our shape and check digit, but no row was ever printed for it.
        let orphan =
            crate::barcode::Scan { worker_id: 99, reason_id: 1, grade_id: 3 }.payload().unwrap();
        assert!(crate::repo::barcodes::find(&connection, &orphan).is_err());
    }

    /// Deleting a worker takes their buttons off the sheet with them.
    #[test]
    fn barcodes_follow_the_worker_they_belong_to() {
        let connection = version_one_database();
        migrate(&connection).unwrap();
        crate::repo::barcodes::sync(&connection).unwrap();

        connection.execute("DELETE FROM worker WHERE id = 1", []).unwrap();

        let left: i64 =
            connection.query_row("SELECT COUNT(*) FROM barcode", [], |r| r.get(0)).unwrap();
        assert_eq!(left, 0);
    }
}
