use serde::{Deserialize, Serialize};

/// What `send-otp` returns: nothing about the code itself, only how long the
/// operator has to wait before asking for another one.
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OtpSent {
    pub retry_after_seconds: u32,
}
