use rusqlite::{Connection, OptionalExtension, params};

use crate::error::{AppError, AppResult};
use crate::models::{Reason, ReasonUpsert};

const SELECT: &str = "SELECT id, name, sort_order, created_date, modified_date FROM reason";

fn map(row: &rusqlite::Row<'_>) -> rusqlite::Result<Reason> {
    Ok(Reason {
        id: row.get("id")?,
        name: row.get("name")?,
        sort_order: row.get("sort_order")?,
        created_date: row.get("created_date")?,
        modified_date: row.get("modified_date")?,
    })
}

/// Ordered the way the columns run across the sheet.
pub fn list(connection: &Connection) -> AppResult<Vec<Reason>> {
    let sql = format!("{SELECT} ORDER BY sort_order, id");
    let mut statement = connection.prepare(&sql)?;
    let rows = statement.query_map([], map)?.collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(rows)
}

pub fn get(connection: &Connection, id: i64) -> AppResult<Reason> {
    let sql = format!("{SELECT} WHERE id = ?1");
    connection
        .query_row(&sql, params![id], map)
        .optional()?
        .ok_or_else(|| AppError::NotFound(format!("No reason with id {id}.")))
}

pub fn create(connection: &Connection, input: ReasonUpsert) -> AppResult<Reason> {
    let input = input.validated().map_err(AppError::BadRequest)?;

    let sort_order = match input.sort_order {
        Some(order) => order,
        None => connection.query_row(
            "SELECT COALESCE(MAX(sort_order), -1) + 1 FROM reason",
            [],
            |row| row.get(0),
        )?,
    };

    connection
        .execute(
            "INSERT INTO reason (name, sort_order, created_date, modified_date)
             VALUES (?1, ?2, ?3, ?3)",
            params![input.name, sort_order, crate::now()],
        )
        .map_err(|err| rename_conflict(err, &input.name))?;

    get(connection, connection.last_insert_rowid())
}

pub fn update(connection: &Connection, id: i64, input: ReasonUpsert) -> AppResult<Reason> {
    let input = input.validated().map_err(AppError::BadRequest)?;
    let current = get(connection, id)?;
    let sort_order = input.sort_order.unwrap_or(current.sort_order);

    connection
        .execute(
            "UPDATE reason SET name = ?2, sort_order = ?3, modified_date = ?4 WHERE id = ?1",
            params![id, input.name, sort_order, crate::now()],
        )
        .map_err(|err| rename_conflict(err, &input.name))?;

    get(connection, id)
}

pub fn delete(connection: &Connection, id: i64) -> AppResult<()> {
    let reason = get(connection, id)?;

    let logged: i64 = connection.query_row(
        "SELECT COUNT(*) FROM worker_log WHERE reason_id = ?1",
        params![id],
        |row| row.get(0),
    )?;

    if logged > 0 {
        return Err(AppError::Conflict(format!(
            "`{}` is used by {logged} waste entr(ies) and cannot be deleted. \
             Rename it instead so past sheets stay accurate.",
            reason.name
        )));
    }

    connection.execute("DELETE FROM reason WHERE id = ?1", params![id])?;
    Ok(())
}

fn rename_conflict(err: rusqlite::Error, name: &str) -> AppError {
    match AppError::from(err) {
        AppError::Conflict(_) => AppError::Conflict(format!("A reason named `{name}` already exists.")),
        other => other,
    }
}
