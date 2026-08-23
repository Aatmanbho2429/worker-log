use serde::Serialize;

#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("{0}")]
    NotFound(String),

    #[error("{0}")]
    BadRequest(String),

    /// A unique constraint or a foreign key that still has dependants.
    #[error("{0}")]
    Conflict(String),

    #[error("database error: {0}")]
    Database(rusqlite::Error),

    #[error("{0}")]
    Internal(String),
}

pub type AppResult<T> = Result<T, AppError>;

impl AppError {
    /// A stable tag the front end can branch on, so it can tell a validation
    /// problem the operator can fix from a fault it should just report.
    pub fn kind(&self) -> &'static str {
        match self {
            AppError::NotFound(_) => "notFound",
            AppError::BadRequest(_) => "badRequest",
            AppError::Conflict(_) => "conflict",
            AppError::Database(_) | AppError::Internal(_) => "internal",
        }
    }
}

impl From<rusqlite::Error> for AppError {
    fn from(err: rusqlite::Error) -> Self {
        use rusqlite::ErrorCode;
        match &err {
            rusqlite::Error::SqliteFailure(inner, message) => match inner.code {
                ErrorCode::ConstraintViolation => AppError::Conflict(
                    message.clone().unwrap_or_else(|| "constraint violation".to_string()),
                ),
                _ => AppError::Database(err),
            },
            rusqlite::Error::QueryReturnedNoRows => AppError::NotFound("not found".to_string()),
            _ => AppError::Database(err),
        }
    }
}

/// What a rejected `invoke` resolves to on the JavaScript side.
///
/// Tauri serialises a command's `Err` straight into the promise rejection, so
/// this is the shape the front end's error handler reads.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandError {
    pub kind: &'static str,
    pub message: String,
}

impl Serialize for AppError {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        if matches!(self, AppError::Database(_) | AppError::Internal(_)) {
            log::error!("command failed: {self}");
        }

        CommandError { kind: self.kind(), message: self.to_string() }.serialize(serializer)
    }
}
