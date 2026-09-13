use serde::Deserialize;

/// `auth_forgot_password_verify`. The device id is not here — Rust reads it
/// off the machine, the same as `RegisterRequest`.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ForgotPasswordVerifyRequest {
    pub email: String,
    pub otp_code: String,
}
