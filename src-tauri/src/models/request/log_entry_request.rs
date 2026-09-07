use serde::Deserialize;

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LogEntryRequest {
    pub worker_id: i64,
    pub reason_id: i64,
    pub grade_id: i64,
}
