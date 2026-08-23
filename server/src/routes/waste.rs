use axum::extract::{Query, State};
use axum::http::StatusCode;
use axum::routing::{get, post};
use axum::{Json, Router};
use serde::Deserialize;

use crate::error::AppResult;
use crate::models::{Dashboard, LogEntryRequest, RangeQuery, WorkerLog};
use crate::repo::{DateRange, logs};
use crate::state::AppState;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api/waste/dashboard", get(dashboard))
        .route("/api/waste/logs", get(list).post(add))
        .route("/api/waste/logs/undo", post(undo))
}

/// The grid behind the waste dashboard: workers down, reasons across.
async fn dashboard(
    State(state): State<AppState>,
    Query(query): Query<RangeQuery>,
) -> AppResult<Json<Dashboard>> {
    let range = DateRange::resolve(&query)?;
    let conn = state.conn()?;
    Ok(Json(logs::dashboard(&conn, &range)?))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LogListQuery {
    #[serde(flatten)]
    range: RangeQuery,
    #[serde(default)]
    worker_id: Option<i64>,
}

/// The audit trail behind the counts.
async fn list(
    State(state): State<AppState>,
    Query(query): Query<LogListQuery>,
) -> AppResult<Json<Vec<WorkerLog>>> {
    let range = DateRange::resolve(&query.range)?;
    let conn = state.conn()?;
    Ok(Json(logs::list(&conn, &range, query.worker_id.filter(|id| *id > 0))?))
}

/// One tap of a grade 3 / grade 4 button.
async fn add(
    State(state): State<AppState>,
    Json(body): Json<LogEntryRequest>,
) -> AppResult<(StatusCode, Json<WorkerLog>)> {
    let conn = state.conn()?;
    Ok((StatusCode::CREATED, Json(logs::add_entry(&conn, &body)?)))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct UndoRequest {
    #[serde(flatten)]
    entry: LogEntryRequest,
    /// The range currently on screen; the undo never reaches outside it.
    #[serde(flatten)]
    range: RangeQuery,
}

/// Removes the most recent matching tap — the fix for a mis-click.
async fn undo(
    State(state): State<AppState>,
    Json(body): Json<UndoRequest>,
) -> AppResult<Json<WorkerLog>> {
    let range = DateRange::resolve(&body.range)?;
    let conn = state.conn()?;
    Ok(Json(logs::remove_latest_entry(&conn, &range, &body.entry)?))
}
