use serde::Deserialize;

/// `auth_register`. The device id is not here — Rust reads it off the machine.
///
/// `otp_code` is the code `auth_send_otp` mailed to `email` moments earlier —
/// checked by the `register` edge function, not here, since that is the only
/// place holding the hash to check it against.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RegisterRequest {
    pub first_name: String,
    pub last_name: String,
    pub phone: String,
    pub email: String,
    pub password: String,
    pub company_name: String,
    pub otp_code: String,
}
