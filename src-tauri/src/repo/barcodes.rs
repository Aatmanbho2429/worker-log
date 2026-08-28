//! The stored barcodes: one row per grade button.
//!
//! A button is a worker crossed with a reason crossed with a grade, so the
//! table holds that whole grid. Nothing here decides *when* a scan is valid —
//! it resolves a code to the button it was printed for, and the log repo takes
//! it from there.

use rusqlite::{Connection, OptionalExtension, params};

use crate::barcode::Scan;
use crate::error::{AppError, AppResult};

/// A code resolved back to the button it stands for.
#[derive(Debug, Clone)]
pub struct Button {
    pub barcode: String,
    pub worker_id: i64,
    pub reason_id: i64,
    pub grade_id: i64,
}

/// Fills in every button that has no barcode yet, and returns how many it made.
///
/// One function covers all four moments a barcode becomes necessary — a worker,
/// a reason or a grade is added, or a register predating the table is opened —
/// because they are the same job: whatever combination is missing, make it.
/// Existing rows are never touched, so a code already printed on a sheet keeps
/// meaning what it meant.
pub fn sync(connection: &Connection) -> AppResult<usize> {
    let missing: Vec<(i64, i64, i64)> = {
        let mut statement = connection.prepare(
            "SELECT w.id AS worker_id, r.id AS reason_id, g.id AS grade_id
               FROM worker w
               CROSS JOIN reason r
               CROSS JOIN grade g
              WHERE NOT EXISTS (
                    SELECT 1 FROM barcode b
                     WHERE b.worker_id = w.id
                       AND b.reason_id = r.id
                       AND b.grade_id  = g.id
                    )
              ORDER BY w.id, r.id, g.id",
        )?;

        statement
            .query_map([], |row| {
                Ok((row.get("worker_id")?, row.get("reason_id")?, row.get("grade_id")?))
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?
    };

    if missing.is_empty() {
        return Ok(0);
    }

    let now = crate::now();
    let mut insert = connection.prepare(
        "INSERT INTO barcode (barcode, worker_id, reason_id, grade_id, created_date, modified_date)
         VALUES (?1, ?2, ?3, ?4, ?5, ?5)",
    )?;

    for (worker_id, reason_id, grade_id) in &missing {
        let code = Scan { worker_id: *worker_id, reason_id: *reason_id, grade_id: *grade_id }
            .payload()?;
        insert.execute(params![code, worker_id, reason_id, grade_id, now])?;
    }

    Ok(missing.len())
}

/// The button a scanned code was printed for.
///
/// The shape is checked first so a barcode off a passing carton is turned away
/// with "not one of ours" rather than "unknown code", and a misread digit is
/// caught by the check digit rather than resolving to some other worker's
/// button. Only then is the row looked up, and the row is what the entry is
/// recorded against — the digits are how the code was made, not what it means.
pub fn find(connection: &Connection, code: &str) -> AppResult<Button> {
    let code = code.trim();
    Scan::parse(code)?;

    connection
        .query_row(
            "SELECT barcode, worker_id, reason_id, grade_id FROM barcode WHERE barcode = ?1",
            params![code],
            |row| {
                Ok(Button {
                    barcode: row.get("barcode")?,
                    worker_id: row.get("worker_id")?,
                    reason_id: row.get("reason_id")?,
                    grade_id: row.get("grade_id")?,
                })
            },
        )
        .optional()?
        .ok_or_else(|| {
            AppError::NotFound(
                "That barcode is not on the current sheet — the worker, reason or grade it was \
                 printed for has since been removed. Print a fresh sheet."
                    .to_string(),
            )
        })
}

/// Every barcode for one reason, keyed by `(worker_id, grade_id)`, which is
/// how the scanning sheet lays a reason's page out.
pub fn for_reason(connection: &Connection, reason_id: i64) -> AppResult<Vec<Button>> {
    let mut statement = connection.prepare(
        "SELECT barcode, worker_id, reason_id, grade_id
           FROM barcode
          WHERE reason_id = ?1",
    )?;

    let rows = statement
        .query_map(params![reason_id], |row| {
            Ok(Button {
                barcode: row.get("barcode")?,
                worker_id: row.get("worker_id")?,
                reason_id: row.get("reason_id")?,
                grade_id: row.get("grade_id")?,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;

    Ok(rows)
}
