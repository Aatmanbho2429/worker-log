use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::routing::get;
use axum::{Json, Router};

use crate::error::AppResult;
use crate::models::{Reason, ReasonUpsert};
use crate::repo::reasons;
use crate::state::AppState;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api/reasons", get(list).post(create))
        .route("/api/reasons/{id}", get(detail).put(update).delete(delete))
}

async fn list(State(state): State<AppState>) -> AppResult<Json<Vec<Reason>>> {
    let conn = state.conn()?;
    Ok(Json(reasons::list(&conn)?))
}

async fn detail(State(state): State<AppState>, Path(id): Path<i64>) -> AppResult<Json<Reason>> {
    let conn = state.conn()?;
    Ok(Json(reasons::get(&conn, id)?))
}

async fn create(
    State(state): State<AppState>,
    Json(body): Json<ReasonUpsert>,
) -> AppResult<(StatusCode, Json<Reason>)> {
    let conn = state.conn()?;
    Ok((StatusCode::CREATED, Json(reasons::create(&conn, body)?)))
}

async fn update(
    State(state): State<AppState>,
    Path(id): Path<i64>,
    Json(body): Json<ReasonUpsert>,
) -> AppResult<Json<Reason>> {
    let conn = state.conn()?;
    Ok(Json(reasons::update(&conn, id, body)?))
}

async fn delete(State(state): State<AppState>, Path(id): Path<i64>) -> AppResult<StatusCode> {
    let conn = state.conn()?;
    reasons::delete(&conn, id)?;
    Ok(StatusCode::NO_CONTENT)
}
