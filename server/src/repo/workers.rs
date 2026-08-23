use rusqlite::{Connection, OptionalExtension, params};

use crate::error::{AppError, AppResult};
use crate::models::{Worker, WorkerUpsert};

const SELECT: &str = "
    SELECT w.id,
           w.first_name,
           w.last_name,
           w.phone,
           w.series_of_product_id,
           s.name AS series_name,
           w.created_date,
           w.modified_date
      FROM worker w
      JOIN series_of_product s ON s.id = w.series_of_product_id
";

fn map(row: &rusqlite::Row<'_>) -> rusqlite::Result<Worker> {
    Ok(Worker {
        id: row.get("id")?,
        first_name: row.get("first_name")?,
        last_name: row.get("last_name")?,
        phone: row.get("phone")?,
        series_of_product_id: row.get("series_of_product_id")?,
        series_name: row.get("series_name")?,
        created_date: row.get("created_date")?,
        modified_date: row.get("modified_date")?,
    })
}

const ORDER: &str = " ORDER BY w.first_name COLLATE NOCASE, w.last_name COLLATE NOCASE, w.id";

pub fn list(connection: &Connection, series_id: Option<i64>) -> AppResult<Vec<Worker>> {
    let (sql, params) = match series_id {
        Some(id) => (
            format!("{SELECT} WHERE w.series_of_product_id = ?1{ORDER}"),
            vec![id],
        ),
        None => (format!("{SELECT}{ORDER}"), Vec::new()),
    };

    let mut statement = connection.prepare(&sql)?;
    let rows = statement
        .query_map(rusqlite::params_from_iter(params), map)?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(rows)
}

pub fn get(connection: &Connection, id: i64) -> AppResult<Worker> {
    let sql = format!("{SELECT} WHERE w.id = ?1");
    connection
        .query_row(&sql, params![id], map)
        .optional()?
        .ok_or_else(|| AppError::NotFound(format!("No worker with id {id}.")))
}

pub fn create(connection: &Connection, input: WorkerUpsert) -> AppResult<Worker> {
    let input = input.validated().map_err(AppError::BadRequest)?;
    ensure_series_exists(connection, input.series_of_product_id)?;

    connection.execute(
        "INSERT INTO worker (first_name, last_name, phone, series_of_product_id,
                             created_date, modified_date)
         VALUES (?1, ?2, ?3, ?4, ?5, ?5)",
        params![
            input.first_name,
            input.last_name,
            input.phone,
            input.series_of_product_id,
            crate::now(),
        ],
    )?;

    get(connection, connection.last_insert_rowid())
}

pub fn update(connection: &Connection, id: i64, input: WorkerUpsert) -> AppResult<Worker> {
    let input = input.validated().map_err(AppError::BadRequest)?;
    ensure_series_exists(connection, input.series_of_product_id)?;

    let affected = connection.execute(
        "UPDATE worker
            SET first_name = ?2,
                last_name = ?3,
                phone = ?4,
                series_of_product_id = ?5,
                modified_date = ?6
          WHERE id = ?1",
        params![
            id,
            input.first_name,
            input.last_name,
            input.phone,
            input.series_of_product_id,
            crate::now(),
        ],
    )?;

    if affected == 0 {
        return Err(AppError::NotFound(format!("No worker with id {id}.")));
    }

    get(connection, id)
}

/// Deleting a worker takes their waste entries with them, so the caller is
/// told how many rows are about to go.
pub fn logged_entry_count(connection: &Connection, id: i64) -> AppResult<i64> {
    let count = connection.query_row(
        "SELECT COUNT(*) FROM worker_log WHERE worker_id = ?1",
        params![id],
        |row| row.get(0),
    )?;
    Ok(count)
}

pub fn delete(connection: &Connection, id: i64) -> AppResult<()> {
    let affected = connection.execute("DELETE FROM worker WHERE id = ?1", params![id])?;
    if affected == 0 {
        return Err(AppError::NotFound(format!("No worker with id {id}.")));
    }
    Ok(())
}

fn ensure_series_exists(connection: &Connection, series_id: i64) -> AppResult<()> {
    let exists: bool = connection.query_row(
        "SELECT EXISTS (SELECT 1 FROM series_of_product WHERE id = ?1)",
        params![series_id],
        |row| row.get(0),
    )?;

    if exists {
        Ok(())
    } else {
        Err(AppError::BadRequest(format!("No series of product with id {series_id}.")))
    }
}
