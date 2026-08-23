use rusqlite::{Connection, OptionalExtension, params};

use crate::error::{AppError, AppResult};
use crate::models::{SeriesOfProduct, SeriesUpsert};

const SELECT: &str = "
    SELECT s.id,
           s.name,
           s.created_date,
           s.modified_date,
           (SELECT COUNT(*) FROM worker w WHERE w.series_of_product_id = s.id) AS worker_count
      FROM series_of_product s
";

fn map(row: &rusqlite::Row<'_>) -> rusqlite::Result<SeriesOfProduct> {
    Ok(SeriesOfProduct {
        id: row.get("id")?,
        name: row.get("name")?,
        created_date: row.get("created_date")?,
        modified_date: row.get("modified_date")?,
        worker_count: row.get("worker_count")?,
    })
}

pub fn list(connection: &Connection) -> AppResult<Vec<SeriesOfProduct>> {
    let sql = format!("{SELECT} ORDER BY s.name COLLATE NOCASE");
    let mut statement = connection.prepare(&sql)?;
    let rows = statement.query_map([], map)?.collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(rows)
}

pub fn get(connection: &Connection, id: i64) -> AppResult<SeriesOfProduct> {
    let sql = format!("{SELECT} WHERE s.id = ?1");
    connection
        .query_row(&sql, params![id], map)
        .optional()?
        .ok_or_else(|| AppError::NotFound(format!("No series of product with id {id}.")))
}

pub fn create(connection: &Connection, input: SeriesUpsert) -> AppResult<SeriesOfProduct> {
    let input = input.validated().map_err(AppError::BadRequest)?;
    let now = crate::now();

    connection
        .execute(
            "INSERT INTO series_of_product (name, created_date, modified_date)
             VALUES (?1, ?2, ?2)",
            params![input.name, now],
        )
        .map_err(|err| rename_conflict(err, &input.name))?;

    get(connection, connection.last_insert_rowid())
}

pub fn update(connection: &Connection, id: i64, input: SeriesUpsert) -> AppResult<SeriesOfProduct> {
    let input = input.validated().map_err(AppError::BadRequest)?;

    let affected = connection
        .execute(
            "UPDATE series_of_product SET name = ?2, modified_date = ?3 WHERE id = ?1",
            params![id, input.name, crate::now()],
        )
        .map_err(|err| rename_conflict(err, &input.name))?;

    if affected == 0 {
        return Err(AppError::NotFound(format!("No series of product with id {id}.")));
    }

    get(connection, id)
}

pub fn delete(connection: &Connection, id: i64) -> AppResult<()> {
    let series = get(connection, id)?;

    if series.worker_count > 0 {
        return Err(AppError::Conflict(format!(
            "`{}` still has {} worker(s) assigned. Move them to another series first.",
            series.name, series.worker_count
        )));
    }

    connection.execute("DELETE FROM series_of_product WHERE id = ?1", params![id])?;
    Ok(())
}

fn rename_conflict(err: rusqlite::Error, name: &str) -> AppError {
    match AppError::from(err) {
        AppError::Conflict(_) => {
            AppError::Conflict(format!("A series of product named `{name}` already exists."))
        }
        other => other,
    }
}
