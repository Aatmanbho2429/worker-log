use std::collections::HashMap;

use rusqlite::{Connection, OptionalExtension, params};

use crate::error::{AppError, AppResult};
use crate::models::{Dashboard, DashboardCell, DashboardRow, LogEntryRequest, WorkerLog};
use crate::repo::{DateRange, grades, reasons, workers};

const SELECT_LOG: &str = "
    SELECT l.id,
           l.worker_id,
           w.first_name || ' ' || w.last_name AS worker_name,
           l.reason_id,
           r.name AS reason_name,
           l.grade_id,
           g.name AS grade_name,
           l.created_date,
           l.modified_date
      FROM worker_log l
      JOIN worker w ON w.id = l.worker_id
      JOIN reason r ON r.id = l.reason_id
      JOIN grade  g ON g.id = l.grade_id
";

fn map(row: &rusqlite::Row<'_>) -> rusqlite::Result<WorkerLog> {
    Ok(WorkerLog {
        id: row.get("id")?,
        worker_id: row.get("worker_id")?,
        worker_name: row.get("worker_name")?,
        reason_id: row.get("reason_id")?,
        reason_name: row.get("reason_name")?,
        grade_id: row.get("grade_id")?,
        grade_name: row.get("grade_name")?,
        created_date: row.get("created_date")?,
        modified_date: row.get("modified_date")?,
    })
}

/// Records one tap of a grade button: a single row, never a mutated counter.
pub fn add_entry(connection: &Connection, input: &LogEntryRequest) -> AppResult<WorkerLog> {
    // Surfaces a clear message rather than a bare foreign key failure.
    workers::get(connection, input.worker_id)?;
    reasons::get(connection, input.reason_id)?;
    grades::get(connection, input.grade_id)?;

    connection.execute(
        "INSERT INTO worker_log (worker_id, reason_id, grade_id, created_date, modified_date)
         VALUES (?1, ?2, ?3, ?4, ?4)",
        params![input.worker_id, input.reason_id, input.grade_id, crate::now()],
    )?;

    get(connection, connection.last_insert_rowid())
}

/// Undoes the most recent tap for this worker/reason/grade inside `range`.
///
/// Scoping the undo to the range on screen means the button can never reach
/// back and silently rewrite a month that has already been exported.
pub fn remove_latest_entry(
    connection: &Connection,
    range: &DateRange,
    input: &LogEntryRequest,
) -> AppResult<WorkerLog> {
    let id: Option<i64> = connection
        .query_row(
            "SELECT id FROM worker_log
              WHERE worker_id = ?1
                AND reason_id = ?2
                AND grade_id = ?3
                AND created_date >= ?4
                AND created_date < ?5
              ORDER BY created_date DESC, id DESC
              LIMIT 1",
            params![
                input.worker_id,
                input.reason_id,
                input.grade_id,
                range.start_bound(),
                range.end_bound()
            ],
            |row| row.get(0),
        )
        .optional()?;

    let Some(id) = id else {
        let grade = grades::get(connection, input.grade_id)?;
        return Err(AppError::NotFound(format!(
            "There is no {} entry left to remove for this worker and reason in {}.",
            grade.name,
            range.label(),
        )));
    };

    let entry = get(connection, id)?;
    connection.execute("DELETE FROM worker_log WHERE id = ?1", params![id])?;
    Ok(entry)
}

pub fn get(connection: &Connection, id: i64) -> AppResult<WorkerLog> {
    let sql = format!("{SELECT_LOG} WHERE l.id = ?1");
    connection
        .query_row(&sql, params![id], map)
        .optional()?
        .ok_or_else(|| AppError::NotFound(format!("No waste entry with id {id}.")))
}

/// The raw audit trail behind the counts, newest first.
pub fn list(
    connection: &Connection,
    range: &DateRange,
    worker_id: Option<i64>,
) -> AppResult<Vec<WorkerLog>> {
    let mut sql = format!("{SELECT_LOG} WHERE l.created_date >= ?1 AND l.created_date < ?2");
    let mut values: Vec<rusqlite::types::Value> =
        vec![range.start_bound().into(), range.end_bound().into()];

    if let Some(series_id) = range.series_id {
        sql.push_str(" AND w.series_of_product_id = ?3");
        values.push(series_id.into());
    }
    if let Some(worker_id) = worker_id {
        sql.push_str(&format!(" AND l.worker_id = ?{}", values.len() + 1));
        values.push(worker_id.into());
    }

    sql.push_str(" ORDER BY l.created_date DESC, l.id DESC");

    let mut statement = connection.prepare(&sql)?;
    let rows = statement
        .query_map(rusqlite::params_from_iter(values), map)?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(rows)
}

/// Builds the whole grid the waste dashboard and the PDF both render: every
/// worker crossed with every reason, a count per grade, plus row, column and
/// grand totals.
pub fn dashboard(connection: &Connection, range: &DateRange) -> AppResult<Dashboard> {
    let grades = grades::list(connection)?;
    let reasons = reasons::list(connection)?;
    let workers = workers::list(connection, range.series_id)?;

    // Where each grade sits in every `counts` vector, worked out once.
    let column: HashMap<i64, usize> =
        grades.iter().enumerate().map(|(index, grade)| (grade.id, index)).collect();
    let width = grades.len();

    let mut sql = String::from(
        "SELECT l.worker_id, l.reason_id, l.grade_id, COUNT(*) AS entries
           FROM worker_log l
           JOIN worker w ON w.id = l.worker_id
          WHERE l.created_date >= ?1 AND l.created_date < ?2",
    );
    let mut values: Vec<rusqlite::types::Value> =
        vec![range.start_bound().into(), range.end_bound().into()];

    if let Some(series_id) = range.series_id {
        sql.push_str(" AND w.series_of_product_id = ?3");
        values.push(series_id.into());
    }
    sql.push_str(" GROUP BY l.worker_id, l.reason_id, l.grade_id");

    let mut statement = connection.prepare(&sql)?;
    let mut counted: HashMap<(i64, i64), Vec<i64>> = HashMap::new();
    let mut cursor = statement.query(rusqlite::params_from_iter(values))?;

    while let Some(row) = cursor.next()? {
        let worker_id: i64 = row.get("worker_id")?;
        let reason_id: i64 = row.get("reason_id")?;
        let grade_id: i64 = row.get("grade_id")?;
        let entries: i64 = row.get("entries")?;

        // A grade with no column has nowhere to land. `grade_id` is a
        // restricting foreign key so this cannot happen through the app, but
        // folding the count into a neighbouring grade would be worse than
        // leaving it out if it ever did.
        if let Some(&index) = column.get(&grade_id) {
            counted.entry((worker_id, reason_id)).or_insert_with(|| vec![0; width])[index] +=
                entries;
        }
    }

    let mut reason_totals: Vec<DashboardCell> = reasons
        .iter()
        .map(|reason| DashboardCell { reason_id: reason.id, counts: vec![0; width] })
        .collect();
    let mut grand_total = vec![0_i64; width];

    let rows = workers
        .into_iter()
        .map(|worker| {
            let mut row_total = vec![0_i64; width];

            let cells = reasons
                .iter()
                .enumerate()
                .map(|(index, reason)| {
                    let counts = counted
                        .get(&(worker.id, reason.id))
                        .cloned()
                        .unwrap_or_else(|| vec![0; width]);

                    for (slot, count) in counts.iter().enumerate() {
                        row_total[slot] += count;
                        reason_totals[index].counts[slot] += count;
                    }

                    DashboardCell { reason_id: reason.id, counts }
                })
                .collect();

            for (slot, count) in row_total.iter().enumerate() {
                grand_total[slot] += count;
            }

            DashboardRow { worker, cells, total: row_total }
        })
        .collect();

    Ok(Dashboard {
        from: range.from.to_string(),
        to: range.to.to_string(),
        grades,
        reasons,
        rows,
        reason_totals,
        grand_total,
    })
}
