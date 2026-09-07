use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkerLog {
    pub id: i64,
    pub worker_id: i64,
    pub worker_name: String,
    pub reason_id: i64,
    pub reason_name: String,
    pub grade_id: i64,
    pub grade_name: String,
    pub created_date: String,
    pub modified_date: String,
}
