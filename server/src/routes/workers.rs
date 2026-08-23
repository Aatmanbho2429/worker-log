use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::routing::get;
use axum::{Json, Router};
use serde::{Deserialize, Serialize};

use crate::error::AppResult;
use crate::models::{Worker, WorkerUpsert};
use crate::repo::workers;
use crate::state::AppState;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api/workers", get(list).post(create))
        .route("/api/workers/{id}", get(detail).put(update).delete(delete))
        .route("/api/workers/{id}/impact", get(impact))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ListQuery {
    #[serde(default)]
    series_id: Option<i64>,
}

async fn list(
    State(state): State<AppState>,
    Query(query): Query<ListQuery>,
) -> AppResult<Json<Vec<Worker>>> {
    let conn = state.conn()?;
    Ok(Json(workers::list(&conn, query.series_id.filter(|id| *id > 0))?))
}

async fn detail(State(state): State<AppState>, Path(id): Path<i64>) -> AppResult<Json<Worker>> {
    let conn = state.conn()?;
    Ok(Json(workers::get(&conn, id)?))
}

async fn create(
    State(state): State<AppState>,
    Json(body): Json<WorkerUpsert>,
) -> AppResult<(StatusCode, Json<Worker>)> {
    let conn = state.conn()?;
    Ok((StatusCode::CREATED, Json(workers::create(&conn, body)?)))
}

async fn update(
    State(state): State<AppState>,
    Path(id): Path<i64>,
    Json(body): Json<WorkerUpsert>,
) -> AppResult<Json<Worker>> {
    let conn = state.conn()?;
    Ok(Json(workers::update(&conn, id, body)?))
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct DeleteImpact {
    worker: Worker,
    /// Waste entries that would be removed along with the worker.
    logged_entries: i64,
}

/// Lets the confirm dialog warn about history that is about to be lost.
async fn impact(State(state): State<AppState>, Path(id): Path<i64>) -> AppResult<Json<DeleteImpact>> {
    let conn = state.conn()?;
    Ok(Json(DeleteImpact {
        worker: workers::get(&conn, id)?,
        logged_entries: workers::logged_entry_count(&conn, id)?,
    }))
}

async fn delete(State(state): State<AppState>, Path(id): Path<i64>) -> AppResult<StatusCode> {
    let conn = state.conn()?;
    workers::delete(&conn, id)?;
    Ok(StatusCode::NO_CONTENT)
}
