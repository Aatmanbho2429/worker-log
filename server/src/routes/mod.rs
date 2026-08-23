mod reasons;
mod reports;
mod series;
mod waste;
mod workers;

use axum::Router;
use axum::http::{HeaderValue, Method, header};
use axum::routing::get;
use tower_http::cors::CorsLayer;
use tower_http::trace::TraceLayer;

use crate::state::AppState;

pub fn router(state: AppState) -> Router {
    // The Angular dev server proxies `/api`, so CORS only matters when the two
    // are run on different origins during development.
    let cors = CorsLayer::new()
        .allow_origin("http://localhost:4200".parse::<HeaderValue>().expect("valid origin"))
        .allow_methods([Method::GET, Method::POST, Method::PUT, Method::DELETE])
        .allow_headers([header::CONTENT_TYPE]);

    Router::new()
        .route("/api/health", get(health))
        .merge(series::router())
        .merge(workers::router())
        .merge(reasons::router())
        .merge(waste::router())
        .merge(reports::router())
        .layer(cors)
        .layer(TraceLayer::new_for_http())
        .with_state(state)
}

async fn health() -> &'static str {
    "ok"
}
