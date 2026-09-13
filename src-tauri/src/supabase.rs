//! The Supabase side of the app, and the only place that knows it exists.
//!
//! Everything the front end can do to an account goes through here. The
//! project URL and the anon key are compiled in rather than shipped to the web
//! layer, and no key ever crosses the Tauri bridge — the window receives
//! answers, never credentials.
//!
//! Two different Supabase surfaces are used, and which one a call goes to is
//! decided by what privilege the call needs:
//!
//! * **GoTrue** (`/auth/v1`) — refreshing a stale access token. The anon key
//!   is enough for this alone; nothing privileged happens on this path.
//! * **Edge functions** (`/functions/v1`) — everything else: registration,
//!   signing in, the licence check, changing a password, the profile and
//!   payment history reads, and Razorpay. All of it needs the service role
//!   key, which exists only on the function, never here — a secret compiled
//!   into a desktop binary is a secret that ships to every customer.
//!
//! There used to be a third surface, PostgREST with the anon key, for reading
//! the profile and the payment history as the signed-in user. Both moved
//! behind edge functions once it turned out the row level security policies
//! those reads depended on were never actually created on the live project,
//! so they were reading nothing — see the `supabase` skill's `payments.md`.

use serde::Serialize;
use serde::de::DeserializeOwned;

use crate::error::{AppError, AppResult};

/// The project this build talks to.
///
/// Overridable by environment variable so a developer can point a build at
/// their own project without editing the source.
pub fn project_url() -> String {
    std::env::var("SUPABASE_URL")
        .unwrap_or_else(|_| "https://ujalkizozxeshrheuhkb.supabase.co".to_string())
}

/// The publishable key. Safe to compile in: on its own it can read nothing at
/// all, since row level security is enabled on every table it can reach with
/// no policy granting it access — see the module doc above.
pub fn anon_key() -> String {
    std::env::var("SUPABASE_ANON_KEY").unwrap_or_else(|_| {
        "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVqYWxraXpvenhlc2hyaGV1aGtiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc3NDUyNTMsImV4cCI6MjEwMzMyMTI1M30.1pxwcWgnXIuOEDm1-jw7g3PaGQvDSaHrRFw_hmhRYsI"
            .to_string()
    })
}

fn client() -> AppResult<reqwest::Client> {
    reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|err| AppError::Internal(format!("could not start the HTTP client: {err}")))
}

/// What an edge function answers with when it refuses.
#[derive(serde::Deserialize)]
struct FunctionError {
    error: FunctionErrorBody,
}

#[derive(serde::Deserialize)]
struct FunctionErrorBody {
    kind: String,
    message: String,
}

/// What GoTrue answers with when it refuses.
#[derive(serde::Deserialize)]
struct GoTrueError {
    #[serde(default)]
    error_description: Option<String>,
    #[serde(default)]
    msg: Option<String>,
    #[serde(default)]
    message: Option<String>,
}

/// Turns a refusal into the right kind of `AppError`.
///
/// An edge function already tells us which kind it meant, so that is used as
/// written — it is what makes a refusal from Deno reach the operator as the
/// sentence it was written as. Anything else is classified by status code.
fn to_error(status: reqwest::StatusCode, body: &str, fallback: &str) -> AppError {
    if let Ok(parsed) = serde_json::from_str::<FunctionError>(body) {
        let message = parsed.error.message;
        return match parsed.error.kind.as_str() {
            "notFound" => AppError::NotFound(message),
            "badRequest" => AppError::BadRequest(message),
            "conflict" | "forbidden" => AppError::Conflict(message),
            _ => AppError::Internal(message),
        };
    }

    if let Ok(parsed) = serde_json::from_str::<GoTrueError>(body) {
        if let Some(message) = parsed.error_description.or(parsed.msg).or(parsed.message) {
            return match status.as_u16() {
                400 | 401 | 422 => AppError::BadRequest(message),
                403 => AppError::Conflict(message),
                404 => AppError::NotFound(message),
                _ => AppError::Internal(message),
            };
        }
    }

    // A function that was never deployed answers with the gateway's own 404,
    // which is worth saying plainly rather than reporting as a fault.
    if status == reqwest::StatusCode::NOT_FOUND {
        return AppError::Internal(format!("{fallback} (the server has no such endpoint yet)"));
    }

    log::error!("supabase refused with {status}: {body}");
    AppError::Internal(fallback.to_string())
}

fn transport_error(err: reqwest::Error, fallback: &str) -> AppError {
    log::error!("supabase request failed: {err}");
    if err.is_timeout() || err.is_connect() {
        return AppError::Internal(
            "Could not reach the account service. Check this machine's internet connection."
                .to_string(),
        );
    }
    AppError::Internal(fallback.to_string())
}

async fn read<T: DeserializeOwned>(
    response: reqwest::Response,
    fallback: &str,
) -> AppResult<T> {
    let status = response.status();
    let body = response
        .text()
        .await
        .map_err(|err| transport_error(err, fallback))?;

    if !status.is_success() {
        return Err(to_error(status, &body, fallback));
    }

    serde_json::from_str::<T>(&body).map_err(|err| {
        log::error!("could not read the response from supabase: {err}; body was {body}");
        AppError::Internal(fallback.to_string())
    })
}

/// Calls an edge function. Used only where the service role key is needed.
pub async fn call_function<B: Serialize, T: DeserializeOwned>(
    name: &str,
    body: &B,
    fallback: &str,
) -> AppResult<T> {
    let response = client()?
        .post(format!("{}/functions/v1/{name}", project_url()))
        .header("apikey", anon_key())
        .header("Authorization", format!("Bearer {}", anon_key()))
        .json(body)
        .send()
        .await
        .map_err(|err| transport_error(err, fallback))?;

    read(response, fallback).await
}

/// Calls GoTrue. `path` is everything after `/auth/v1/`. Its only caller is
/// `refresh` — signing in moved to the `login` function and changing a
/// password moved to `change-password`, both of which need the service role
/// key this always-anon-key call cannot carry.
pub async fn call_auth<B: Serialize, T: DeserializeOwned>(
    path: &str,
    body: &B,
    fallback: &str,
) -> AppResult<T> {
    let response = client()?
        .post(format!("{}/auth/v1/{path}", project_url()))
        .header("apikey", anon_key())
        .header("Authorization", format!("Bearer {}", anon_key()))
        .json(body)
        .send()
        .await
        .map_err(|err| transport_error(err, fallback))?;

    read(response, fallback).await
}

