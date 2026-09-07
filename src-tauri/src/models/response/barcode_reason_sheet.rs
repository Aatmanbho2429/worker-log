use serde::Serialize;

use super::BarcodeWorkerRow;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BarcodeReasonSheet {
    pub reason_id: i64,
    pub reason_name: String,
    pub rows: Vec<BarcodeWorkerRow>,
}
