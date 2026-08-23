use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::routing::get;
use axum::{Json, Router};

use crate::error::AppResult;
use crate::models::{SeriesOfProduct, SeriesUpsert};
use crate::repo::series;
use crate::state::AppState;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api/series", get(list).post(create))
        .route("/api/series/{id}", get(detail).put(update).delete(delete))
}

async fn list(State(state): State<AppState>) -> AppResult<Json<Vec<SeriesOfProduct>>> {
    let conn = state.conn()?;
    Ok(Json(series::list(&conn)?))
}

async fn detail(
    State(state): State<AppState>,
    Path(id): Path<i64>,
) -> AppResult<Json<SeriesOfProduct>> {
    let conn = state.conn()?;
    Ok(Json(series::get(&conn, id)?))
}

async fn create(
    State(state): State<AppState>,
    Json(body): Json<SeriesUpsert>,
) -> AppResult<(StatusCode, Json<SeriesOfProduct>)> {
    let conn = state.conn()?;
    Ok((StatusCode::CREATED, Json(series::create(&conn, body)?)))
}

async fn update(
    State(state): State<AppState>,
    Path(id): Path<i64>,
    Json(body): Json<SeriesUpsert>,
) -> AppResult<Json<SeriesOfProduct>> {
    let conn = state.conn()?;
    Ok(Json(series::update(&conn, id, body)?))
}

async fn delete(State(state): State<AppState>, Path(id): Path<i64>) -> AppResult<StatusCode> {
    let conn = state.conn()?;
    series::delete(&conn, id)?;
    Ok(StatusCode::NO_CONTENT)
}
