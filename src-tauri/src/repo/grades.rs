use rusqlite::{Connection, OptionalExtension, params};

use crate::barcode::MAX_GRADE_ID;
use crate::error::{AppError, AppResult};
use crate::models::{Grade, GradeUpsert};

const SELECT: &str = "
    SELECT g.id,
           g.name,
           g.created_date,
           g.modified_date,
           (SELECT COUNT(*) FROM worker_log l WHERE l.grade_id = g.id) AS entry_count
      FROM grade g
";

fn map(row: &rusqlite::Row<'_>) -> rusqlite::Result<Grade> {
    Ok(Grade {
        id: row.get("id")?,
        name: row.get("name")?,
        created_date: row.get("created_date")?,
        modified_date: row.get("modified_date")?,
        entry_count: row.get("entry_count")?,
    })
}

/// Ordered by id, which is the order they were added and — because grade 3 and
/// grade 4 are seeded with those ids — the order the sheet has always used.
pub fn list(connection: &Connection) -> AppResult<Vec<Grade>> {
    let sql = format!("{SELECT} ORDER BY g.id");
    let mut statement = connection.prepare(&sql)?;
    let rows = statement.query_map([], map)?.collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(rows)
}

pub fn get(connection: &Connection, id: i64) -> AppResult<Grade> {
    let sql = format!("{SELECT} WHERE g.id = ?1");
    connection
        .query_row(&sql, params![id], map)
        .optional()?
        .ok_or_else(|| AppError::NotFound(format!("No grade with id {id}.")))
}

pub fn create(connection: &Connection, input: GradeUpsert) -> AppResult<Grade> {
    let input = input.validated().map_err(AppError::BadRequest)?;

    // The barcode payload carries the grade id in a single digit, so a tenth
    // grade could be created but never printed. Refusing here says so while
    // the operator can still do something about it.
    // `AUTOINCREMENT` never reuses an id, so the next one comes from the
    // sequence rather than from `MAX(id)`: deleting a grade does not free its
    // digit back up.
    let next: i64 = connection.query_row(
        "SELECT COALESCE(
                    (SELECT seq FROM sqlite_sequence WHERE name = 'grade'),
                    (SELECT COALESCE(MAX(id), 0) FROM grade)
                ) + 1",
        [],
        |row| row.get(0),
    )?;
    if next > MAX_GRADE_ID {
        return Err(AppError::Conflict(format!(
            "The barcode format carries one grade digit, so at most {MAX_GRADE_ID} grades can be \
             tracked. Rename or delete an unused grade instead."
        )));
    }

    connection
        .execute(
            "INSERT INTO grade (name, created_date, modified_date) VALUES (?1, ?2, ?2)",
            params![input.name, crate::now()],
        )
        .map_err(|err| rename_conflict(err, &input.name))?;

    get(connection, connection.last_insert_rowid())
}

pub fn update(connection: &Connection, id: i64, input: GradeUpsert) -> AppResult<Grade> {
    let input = input.validated().map_err(AppError::BadRequest)?;

    let affected = connection
        .execute(
            "UPDATE grade SET name = ?2, modified_date = ?3 WHERE id = ?1",
            params![id, input.name, crate::now()],
        )
        .map_err(|err| rename_conflict(err, &input.name))?;

    if affected == 0 {
        return Err(AppError::NotFound(format!("No grade with id {id}.")));
    }

    get(connection, id)
}

/// Deleting a grade takes its barcodes with it, so the caller is told how many
/// printed codes a fresh sheet would lose.
pub fn barcode_count(connection: &Connection, id: i64) -> AppResult<i64> {
    let count = connection.query_row(
        "SELECT COUNT(*) FROM barcode WHERE grade_id = ?1",
        params![id],
        |row| row.get(0),
    )?;
    Ok(count)
}

pub fn delete(connection: &Connection, id: i64) -> AppResult<()> {
    let grade = get(connection, id)?;

    if grade.entry_count > 0 {
        return Err(AppError::Conflict(format!(
            "`{}` is used by {} waste entr(ies) and cannot be deleted. \
             Rename it instead so past sheets stay accurate.",
            grade.name, grade.entry_count
        )));
    }

    let remaining: i64 =
        connection.query_row("SELECT COUNT(*) FROM grade", [], |row| row.get(0))?;
    if remaining <= 1 {
        return Err(AppError::Conflict(
            "The register needs at least one grade to log waste against.".to_string(),
        ));
    }

    // The grade's barcodes go with it: the button they stand for is gone.
    connection.execute("DELETE FROM grade WHERE id = ?1", params![id])?;
    Ok(())
}

fn rename_conflict(err: rusqlite::Error, name: &str) -> AppError {
    match AppError::from(err) {
        AppError::Conflict(_) => {
            AppError::Conflict(format!("A grade named `{name}` already exists."))
        }
        other => other,
    }
}
