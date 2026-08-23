use axum::Json;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use serde_json::json;

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

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        let status = match &self {
            AppError::NotFound(_) => StatusCode::NOT_FOUND,
            AppError::BadRequest(_) => StatusCode::BAD_REQUEST,
            AppError::Conflict(_) => StatusCode::CONFLICT,
            AppError::Database(_) | AppError::Internal(_) => StatusCode::INTERNAL_SERVER_ERROR,
        };

        if status == StatusCode::INTERNAL_SERVER_ERROR {
            tracing::error!(error = %self, "request failed");
        }

        (status, Json(json!({ "error": self.to_string() }))).into_response()
    }
}
