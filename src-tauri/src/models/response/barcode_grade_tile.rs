use serde::Serialize;

use super::BarcodeSymbol;

/// One grade's barcode in a worker's row: the button it stands in for.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BarcodeGradeTile {
    pub grade_id: i64,
    pub grade_name: String,
    pub symbol: BarcodeSymbol,
}
