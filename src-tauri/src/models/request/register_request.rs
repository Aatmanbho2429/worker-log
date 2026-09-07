use serde::Deserialize;

/// `auth_register`. The device id is not here — Rust reads it off the machine.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RegisterRequest {
    pub first_name: String,
    pub last_name: String,
    pub phone: String,
    pub email: String,
    pub password: String,
    pub company_name: String,
}
