use serde::Serialize;

use super::Worker;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkerDeleteImpact {
    pub worker: Worker,
    /// Waste entries that would be removed along with the worker.
    pub logged_entries: i64,
}
