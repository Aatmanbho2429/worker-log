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
    /// The HTTP-style status carried in `ApiResponse.statusCode`
    /// (`.claude/rules/api-response-format.md`) — the front end shows a
    /// 400/404/409 as an actionable warning and a 500 as a fault, the same
    /// split the old `badRequest`/`notFound`/`conflict`/`internal` tag drew.
    pub fn status_code(&self) -> u16 {
        match self {
            AppError::BadRequest(_) => 400,
            AppError::NotFound(_) => 404,
            AppError::Conflict(_) => 409,
            AppError::Database(_) | AppError::Internal(_) => 500,
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
