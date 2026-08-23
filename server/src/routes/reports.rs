use axum::extract::{Query, State};
use axum::http::{HeaderMap, HeaderValue, header};
use axum::response::IntoResponse;
use axum::routing::get;
use axum::Router;

use crate::error::AppResult;
use crate::models::RangeQuery;
use crate::report::{ReportContext, to_csv, to_pdf};
use crate::repo::{DateRange, logs, series};
use crate::state::AppState;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api/reports/waste-log.pdf", get(pdf))
        .route("/api/reports/waste-log.csv", get(csv))
}

/// Loads everything the renderers need for one date range.
fn build<'a>(
    state: &AppState,
    range: &'a DateRange,
    holder: &'a mut Option<String>,
) -> AppResult<(crate::models::Dashboard, Option<&'a str>)> {
    let conn = state.conn()?;

    let dashboard = logs::dashboard(&conn, range)?;
    if let Some(series_id) = range.series_id {
        *holder = Some(series::get(&conn, series_id)?.name);
    }

    Ok((dashboard, holder.as_deref()))
}

fn filename(range: &DateRange, extension: &str) -> String {
    format!("waste-log-{}-to-{}.{extension}", range.from, range.to)
}

async fn pdf(
    State(state): State<AppState>,
    Query(query): Query<RangeQuery>,
) -> AppResult<impl IntoResponse> {
    let range = DateRange::resolve(&query)?;
    let mut holder = None;
    let (dashboard, series_name) = build(&state, &range, &mut holder)?;

    let bytes = to_pdf(&ReportContext {
        dashboard: &dashboard,
        range: &range,
        series_name,
        generated_at: crate::now(),
    });

    Ok((download_headers("application/pdf", &filename(&range, "pdf")), bytes))
}

async fn csv(
    State(state): State<AppState>,
    Query(query): Query<RangeQuery>,
) -> AppResult<impl IntoResponse> {
    let range = DateRange::resolve(&query)?;
    let mut holder = None;
    let (dashboard, series_name) = build(&state, &range, &mut holder)?;

    let body = to_csv(&ReportContext {
        dashboard: &dashboard,
        range: &range,
        series_name,
        generated_at: crate::now(),
    });

    Ok((download_headers("text/csv; charset=utf-8", &filename(&range, "csv")), body))
}

fn download_headers(content_type: &str, filename: &str) -> HeaderMap {
    let mut headers = HeaderMap::new();

    if let Ok(value) = HeaderValue::from_str(content_type) {
        headers.insert(header::CONTENT_TYPE, value);
    }
    if let Ok(value) = HeaderValue::from_str(&format!("attachment; filename=\"{filename}\"")) {
        headers.insert(header::CONTENT_DISPOSITION, value);
    }

    headers
}
