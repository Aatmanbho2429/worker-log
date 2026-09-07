use serde::Serialize;

use super::BarcodeGradeTile;

/// One worker's row under a reason, a tile per grade.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BarcodeWorkerRow {
    pub worker_id: i64,
    pub name: String,
    pub series_name: String,
    pub tiles: Vec<BarcodeGradeTile>,
}
