use std::collections::HashMap;

use rusqlite::{Connection, OptionalExtension, params};

use crate::error::{AppError, AppResult};
use crate::models::{
    Dashboard, DashboardCell, DashboardRow, Grade, GradeCounts, LogEntryRequest, WorkerLog,
};
use crate::repo::{DateRange, reasons, workers};

const SELECT_LOG: &str = "
    SELECT l.id,
           l.worker_id,
           w.first_name || ' ' || w.last_name AS worker_name,
           l.grade3,
           l.grade4,
           l.reason_id,
           r.name AS reason_name,
           l.created_date,
           l.modified_date
      FROM worker_log l
      JOIN worker w ON w.id = l.worker_id
      JOIN reason r ON r.id = l.reason_id
";

fn map(row: &rusqlite::Row<'_>) -> rusqlite::Result<WorkerLog> {
    Ok(WorkerLog {
        id: row.get("id")?,
        worker_id: row.get("worker_id")?,
        worker_name: row.get("worker_name")?,
        grade3: row.get("grade3")?,
        grade4: row.get("grade4")?,
        reason_id: row.get("reason_id")?,
        reason_name: row.get("reason_name")?,
        created_date: row.get("created_date")?,
        modified_date: row.get("modified_date")?,
    })
}

/// Records one tap of a grade button: a single row, never a mutated counter.
pub fn add_entry(connection: &Connection, input: &LogEntryRequest) -> AppResult<WorkerLog> {
    // Surfaces a clear message rather than a bare foreign key failure.
    workers::get(connection, input.worker_id)?;
    reasons::get(connection, input.reason_id)?;

    let (grade3, grade4) = input.grade.counters();

    connection.execute(
        "INSERT INTO worker_log (worker_id, grade3, grade4, reason_id, created_date, modified_date)
         VALUES (?1, ?2, ?3, ?4, ?5, ?5)",
        params![input.worker_id, grade3, grade4, input.reason_id, crate::now()],
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
    let grade_column = match input.grade {
        Grade::Three => "grade3",
        Grade::Four => "grade4",
    };

    let sql = format!(
        "SELECT id FROM worker_log
          WHERE worker_id = ?1
            AND reason_id = ?2
            AND {grade_column} > 0
            AND created_date >= ?3
            AND created_date < ?4
          ORDER BY created_date DESC, id DESC
          LIMIT 1"
    );

    let id: Option<i64> = connection
        .query_row(
            &sql,
            params![input.worker_id, input.reason_id, range.start_bound(), range.end_bound()],
            |row| row.get(0),
        )
        .optional()?;

    let Some(id) = id else {
        return Err(AppError::NotFound(format!(
            "There is no grade {} entry left to remove for this worker and reason in {}.",
            i64::from(input.grade),
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
/// worker crossed with every reason, plus row, column and grand totals.
pub fn dashboard(connection: &Connection, range: &DateRange) -> AppResult<Dashboard> {
    let reasons = reasons::list(connection)?;
    let workers = workers::list(connection, range.series_id)?;

    let mut sql = String::from(
        "SELECT l.worker_id, l.reason_id, SUM(l.grade3) AS g3, SUM(l.grade4) AS g4
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
    sql.push_str(" GROUP BY l.worker_id, l.reason_id");

    let mut statement = connection.prepare(&sql)?;
    let mut totals: HashMap<(i64, i64), GradeCounts> = HashMap::new();
    let mut cursor = statement.query(rusqlite::params_from_iter(values))?;

    while let Some(row) = cursor.next()? {
        let worker_id: i64 = row.get("worker_id")?;
        let reason_id: i64 = row.get("reason_id")?;
        totals.insert(
            (worker_id, reason_id),
            GradeCounts { grade3: row.get("g3")?, grade4: row.get("g4")? },
        );
    }

    let mut reason_totals: Vec<DashboardCell> = reasons
        .iter()
        .map(|reason| DashboardCell { reason_id: reason.id, counts: GradeCounts::default() })
        .collect();
    let mut grand_total = GradeCounts::default();

    let rows = workers
        .into_iter()
        .map(|worker| {
            let mut row_total = GradeCounts::default();

            let cells = reasons
                .iter()
                .enumerate()
                .map(|(index, reason)| {
                    let counts = totals.get(&(worker.id, reason.id)).copied().unwrap_or_default();

                    row_total.grade3 += counts.grade3;
                    row_total.grade4 += counts.grade4;
                    reason_totals[index].counts.grade3 += counts.grade3;
                    reason_totals[index].counts.grade4 += counts.grade4;

                    DashboardCell { reason_id: reason.id, counts }
                })
                .collect();

            grand_total.grade3 += row_total.grade3;
            grand_total.grade4 += row_total.grade4;

            DashboardRow { worker, cells, total: row_total }
        })
        .collect();

    Ok(Dashboard {
        from: range.from.to_string(),
        to: range.to.to_string(),
        reasons,
        rows,
        reason_totals,
        grand_total,
    })
}
