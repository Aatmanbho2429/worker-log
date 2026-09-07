use serde::Serialize;

use super::WorkerLog;

/// What the scanning screen shows back after a successful scan.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanReceipt {
    pub entry: WorkerLog,
}
