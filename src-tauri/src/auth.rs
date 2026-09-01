//! Accounts, sessions and the licence check.
//!
//! This is the whole of the account layer. The window asks for a session and
//! gets one; it never sees a token, a key or a Supabase URL. Which Supabase
//! surface each step talks to, and why, is set out in `supabase.rs`.
//!
//! Tokens are kept in their own file beside the register rather than inside
//! it. The Settings screen tells the operator that copying `worker-log.db`
//! backs the register up and moves it to another machine — and a backup that
//! carried a signed-in session with it would hand that session to whoever
//! opened the copy.

use std::path::PathBuf;

use chrono::{DateTime, Local, NaiveDate};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

use crate::error::{AppError, AppResult};
use crate::supabase;

// ------------------------------------------------------------- the models --
//
// Serialised camelCase, because these cross into TypeScript. They mirror
// `web/src/app/models/auth.ts` field for field.

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UserAccount {
    pub id: String,
    pub first_name: String,
    pub last_name: String,
    pub email: String,
    pub phone: String,
    pub company_name: String,
    pub device_id: Option<String>,
    pub status: String,
    pub created_date: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Subscription {
    pub plan: String,
    pub status: String,
    pub started_on: String,
    pub renews_on: String,
    pub days_left: i64,
    pub term_days: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Payment {
    pub id: i64,
    pub reference: String,
    pub paid_on: String,
    pub plan: String,
    pub period_from: String,
    pub period_to: String,
    pub amount: f64,
    pub currency: String,
    pub method: String,
    pub status: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Session {
    pub user: UserAccount,
    pub subscription: Subscription,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PasswordReset {
    pub sent_to: String,
}

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

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LoginRequest {
    pub email: String,
    pub password: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChangePasswordRequest {
    pub current_password: String,
    pub new_password: String,
}

// --------------------------------------------------------- the wire shapes --
//
// What Supabase actually sends back. Kept separate from the models above so a
// column rename over there cannot silently change what the window is handed.

#[derive(Debug, Deserialize)]
struct ProfileRow {
    id: String,
    first_name: String,
    last_name: String,
    phone: Option<String>,
    email: String,
    company_name: Option<String>,
    device_id: Option<String>,
    status: String,
    subscription_status: Option<String>,
    subscriptions_end_date: Option<String>,
    created_date: String,
}

#[derive(Debug, Deserialize)]
struct PlanRow {
    name: String,
}

#[derive(Debug, Deserialize)]
struct SubscriptionRow {
    amount: Option<f64>,
    currency: Option<String>,
    status: String,
    start_date: Option<String>,
    end_date: Option<String>,
    razorpay_order_id: Option<String>,
    razorpay_payment_id: Option<String>,
    payment_method: Option<String>,
    created_at: String,
    plans: Option<PlanRow>,
}

#[derive(Debug, Deserialize)]
struct Tokens {
    access_token: String,
    refresh_token: String,
}

#[derive(Debug, Deserialize)]
struct RegisterResponse {
    #[allow(dead_code)]
    profile: serde_json::Value,
}

#[derive(Debug, Serialize, Deserialize)]
struct StoredSession {
    access_token: String,
    refresh_token: String,
}

const PROFILE_COLUMNS: &str = "id,first_name,last_name,phone,email,company_name,device_id,\
status,subscription_status,subscriptions_end_date,created_date";

const SUBSCRIPTION_COLUMNS: &str = "amount,currency,status,start_date,end_date,\
razorpay_order_id,razorpay_payment_id,payment_method,created_at,plans(name)";

/// An `active` licence with this many days or fewer left starts nagging.
const EXPIRING_WITHIN_DAYS: i64 = 14;

// ------------------------------------------------------------ token storage --

fn session_path(app: &AppHandle) -> AppResult<PathBuf> {
    let directory = app
        .path()
        .app_data_dir()
        .map_err(|err| AppError::Internal(format!("no app data directory: {err}")))?;
    std::fs::create_dir_all(&directory)
        .map_err(|err| AppError::Internal(format!("could not create the app data directory: {err}")))?;
    Ok(directory.join("session.json"))
}

fn load_tokens(app: &AppHandle) -> Option<StoredSession> {
    let path = session_path(app).ok()?;
    let raw = std::fs::read_to_string(path).ok()?;
    serde_json::from_str(&raw).ok()
}

fn save_tokens(app: &AppHandle, tokens: &StoredSession) -> AppResult<()> {
    let path = session_path(app)?;
    let raw = serde_json::to_string(tokens)
        .map_err(|err| AppError::Internal(format!("could not write the session: {err}")))?;
    std::fs::write(path, raw)
        .map_err(|err| AppError::Internal(format!("could not write the session: {err}")))
}

fn clear_tokens(app: &AppHandle) {
    if let Ok(path) = session_path(app) {
        let _ = std::fs::remove_file(path);
    }
}

// ------------------------------------------------------------------ helpers --

/// This PC's fingerprint. See `commands::device_id` for what it reads.
fn device_id() -> AppResult<String> {
    machine_uid::get().map_err(|err| {
        AppError::Internal(format!("could not read this machine's identifier: {err}"))
    })
}

/// `timestamptz` in, `YYYY-MM-DD` out.
///
/// Every date the account screens show is a calendar date, and they format it
/// from those three parts. A full timestamp would leave them parsing
/// `30T05:07:03.177Z` as a day number.
fn to_date(value: Option<&str>) -> String {
    let Some(raw) = value else {
        return String::new();
    };
    match DateTime::parse_from_rfc3339(raw) {
        Ok(parsed) => parsed.with_timezone(&Local).date_naive().to_string(),
        // A `date` column arrives already in the right shape.
        Err(_) => raw.split('T').next().unwrap_or_default().to_string(),
    }
}

fn parse_date(value: &str) -> Option<NaiveDate> {
    NaiveDate::parse_from_str(value, "%Y-%m-%d").ok()
}

fn days_between(from: NaiveDate, to: NaiveDate) -> i64 {
    (to - from).num_days()
}

// ----------------------------------------------------------------- the flow --

async fn sign_in(email: &str, password: &str) -> AppResult<Tokens> {
    supabase::call_auth(
        "token?grant_type=password",
        &serde_json::json!({ "email": email, "password": password }),
        None,
        "That email and password do not match an account.",
    )
    .await
}

async fn refresh(refresh_token: &str) -> AppResult<Tokens> {
    supabase::call_auth(
        "token?grant_type=refresh_token",
        &serde_json::json!({ "refresh_token": refresh_token }),
        None,
        "Your session has ended. Please sign in again.",
    )
    .await
}

async fn fetch_profile(user_id_filter: &str, access_token: &str) -> AppResult<ProfileRow> {
    let rows: Vec<ProfileRow> = supabase::select(
        &format!("users?select={PROFILE_COLUMNS}&{user_id_filter}"),
        access_token,
        "Could not load your account.",
    )
    .await?;

    rows.into_iter()
        .next()
        .ok_or_else(|| AppError::NotFound("That account has no profile. Please contact support.".into()))
}

/// The subscription the licence is currently running on, if there is one.
///
/// A trial has none — nothing was ordered and nothing was paid — so the caller
/// falls back to the account's own dates.
async fn fetch_current_subscription(access_token: &str) -> Option<SubscriptionRow> {
    let query = format!(
        "subscriptions?select={SUBSCRIPTION_COLUMNS}&status=eq.active&order=end_date.desc&limit=1"
    );
    let rows: Vec<SubscriptionRow> = supabase::select(&query, access_token, "").await.ok()?;
    rows.into_iter().next()
}

/// Refuses unless this machine is the one the account is licensed to.
fn check_licence(profile: &ProfileRow) -> AppResult<()> {
    if profile.status == "blocked" {
        return Err(AppError::Conflict(
            "This account has been blocked. Please contact support.".into(),
        ));
    }
    if profile.status != "active" {
        return Err(AppError::Conflict(
            "This account is not active. Please contact support.".into(),
        ));
    }

    let this_machine = device_id()?;
    match profile.device_id.as_deref() {
        Some(bound) if bound == this_machine => Ok(()),
        Some(_) => Err(AppError::Conflict(
            "This account is licensed to a different PC. Sign in on the machine it was \
             registered on, or contact support to move the licence."
                .into(),
        )),
        // Registration always claims the machine, so an unclaimed row means the
        // account was made some other way. Claiming it needs the service role
        // key, which is not here on purpose.
        None => Err(AppError::Conflict(
            "This account is not linked to any PC yet. Please contact support.".into(),
        )),
    }
}

fn build_subscription(profile: &ProfileRow, current: Option<&SubscriptionRow>) -> Subscription {
    let renews_on = to_date(profile.subscriptions_end_date.as_deref());
    let started_on = match current.and_then(|row| row.start_date.as_deref()) {
        Some(start) => to_date(Some(start)),
        // A trial started when the account was opened, which is its only start.
        None => to_date(Some(profile.created_date.as_str())),
    };

    let today = Local::now().date_naive();
    let days_left = parse_date(&renews_on)
        .map(|end| days_between(today, end).max(0))
        .unwrap_or(0);

    // `subscription_status` says what was sold; the end date says whether it is
    // still true. A term that has run out reads as expired whatever the column
    // says, and one inside its last fortnight reads as expiring — a state the
    // database does not store because it changes on its own overnight.
    let stored = profile.subscription_status.clone().unwrap_or_else(|| "trial".into());
    let status = if stored == "active" || stored == "trial" {
        if days_left == 0 {
            "expired".to_string()
        } else if days_left <= EXPIRING_WITHIN_DAYS {
            "expiring".to_string()
        } else {
            stored
        }
    } else {
        stored
    };

    let term_days = match (parse_date(&started_on), parse_date(&renews_on)) {
        (Some(start), Some(end)) => days_between(start, end).max(1),
        _ => days_left.max(1),
    };

    // `plans.name` is the only place a plan is named. A trial has no plan row to
    // point at, and anything else without one has nothing running.
    let plan = current
        .and_then(|row| row.plans.as_ref())
        .map(|plan| plan.name.clone())
        .unwrap_or_else(|| {
            if profile.subscription_status.as_deref() == Some("trial") {
                "Trial".to_string()
            } else {
                "No plan".to_string()
            }
        });

    Subscription { plan, status, started_on, renews_on, days_left, term_days }
}

fn build_account(profile: ProfileRow) -> UserAccount {
    UserAccount {
        id: profile.id,
        first_name: profile.first_name,
        last_name: profile.last_name,
        email: profile.email,
        phone: profile.phone.unwrap_or_default(),
        company_name: profile.company_name.unwrap_or_default(),
        device_id: profile.device_id,
        status: profile.status,
        created_date: to_date(Some(&profile.created_date)),
    }
}

async fn build_session(profile: ProfileRow, access_token: &str) -> Session {
    let current = fetch_current_subscription(access_token).await;
    let subscription = build_subscription(&profile, current.as_ref());
    Session { user: build_account(profile), subscription }
}

// ---------------------------------------------------------------- commands --

/// Opens an account and signs into it.
///
/// The insert needs the service role key, so it goes through the `register`
/// edge function — which is also where this PC is checked against every other
/// account, something no client could do for itself.
#[tauri::command]
pub async fn auth_register(app: AppHandle, payload: RegisterRequest) -> AppResult<Session> {
    let body = serde_json::json!({
        "firstName": payload.first_name,
        "lastName": payload.last_name,
        "phone": payload.phone,
        "email": payload.email,
        "password": payload.password,
        "companyName": payload.company_name,
        "deviceId": device_id()?,
    });

    let _: RegisterResponse =
        supabase::call_function("register", &body, "Could not create the account.").await?;

    // Registering does not sign anybody in — the function creates the account
    // and nothing else.
    auth_login(app, LoginRequest { email: payload.email, password: payload.password }).await
}

#[tauri::command]
pub async fn auth_login(app: AppHandle, payload: LoginRequest) -> AppResult<Session> {
    let email = payload.email.trim().to_lowercase();
    let tokens = sign_in(&email, &payload.password).await?;

    let profile = fetch_profile(&format!("email=eq.{email}"), &tokens.access_token).await?;
    check_licence(&profile)?;

    save_tokens(
        &app,
        &StoredSession {
            access_token: tokens.access_token.clone(),
            refresh_token: tokens.refresh_token,
        },
    )?;

    Ok(build_session(profile, &tokens.access_token).await)
}

/// The signed-in session left over from last time, if there is one.
///
/// The stored access token is usually stale — they last an hour — so a failure
/// to read the profile is taken as "expired" and the refresh token is spent
/// before giving up. The licence is re-checked on the way back in, so a token
/// file copied onto another machine does not outlive the binding.
#[tauri::command]
pub async fn auth_restore(app: AppHandle) -> AppResult<Option<Session>> {
    let Some(stored) = load_tokens(&app) else {
        return Ok(None);
    };

    let mut access_token = stored.access_token;

    let profile = match fetch_profile("select=*&limit=1", &access_token).await {
        Ok(profile) => profile,
        Err(_) => {
            let Ok(fresh) = refresh(&stored.refresh_token).await else {
                clear_tokens(&app);
                return Ok(None);
            };
            access_token = fresh.access_token.clone();
            save_tokens(
                &app,
                &StoredSession {
                    access_token: fresh.access_token,
                    refresh_token: fresh.refresh_token,
                },
            )?;
            match fetch_profile("select=*&limit=1", &access_token).await {
                Ok(profile) => profile,
                Err(_) => {
                    clear_tokens(&app);
                    return Ok(None);
                }
            }
        }
    };

    if check_licence(&profile).is_err() {
        clear_tokens(&app);
        return Ok(None);
    }

    Ok(Some(build_session(profile, &access_token).await))
}

#[tauri::command]
pub async fn auth_logout(app: AppHandle) -> AppResult<()> {
    clear_tokens(&app);
    Ok(())
}

#[tauri::command]
pub async fn auth_forgot_password(email: String) -> AppResult<PasswordReset> {
    supabase::call_function(
        "forgot-password",
        &serde_json::json!({ "email": email.trim().to_lowercase() }),
        "Could not send a new password.",
    )
    .await
}

/// Changing a password, having first proved the current one.
///
/// GoTrue will change a password on the strength of the session alone, so the
/// current one is checked here by signing in with it — otherwise the field
/// would be decoration.
#[tauri::command]
pub async fn auth_change_password(
    app: AppHandle,
    payload: ChangePasswordRequest,
) -> AppResult<()> {
    let Some(stored) = load_tokens(&app) else {
        return Err(AppError::NotFound("You are not signed in.".into()));
    };

    let profile = fetch_profile("select=*&limit=1", &stored.access_token).await?;

    sign_in(&profile.email, &payload.current_password)
        .await
        .map_err(|_| AppError::BadRequest("The current password is not right.".into()))?;

    let _: serde_json::Value = supabase::update_user(
        &serde_json::json!({ "password": payload.new_password }),
        &stored.access_token,
        "Could not change the password.",
    )
    .await?;

    Ok(())
}

/// The payment history: every `subscriptions` row, newest first.
#[tauri::command]
pub async fn auth_payments(app: AppHandle) -> AppResult<Vec<Payment>> {
    let Some(stored) = load_tokens(&app) else {
        return Err(AppError::NotFound("You are not signed in.".into()));
    };

    let query = format!("subscriptions?select={SUBSCRIPTION_COLUMNS}&order=created_at.desc");
    let rows: Vec<SubscriptionRow> = supabase::select(
        &query,
        &stored.access_token,
        "Could not load the payment history.",
    )
    .await?;

    Ok(rows
        .into_iter()
        .enumerate()
        .map(|(index, row)| Payment {
            // The table numbers its own rows; the uuid is not worth showing.
            id: index as i64 + 1,
            // Before Razorpay has taken the money there is an order but no payment.
            reference: row
                .razorpay_payment_id
                .or(row.razorpay_order_id)
                .unwrap_or_else(|| "—".to_string()),
            paid_on: to_date(Some(&row.created_at)),
            plan: row.plans.map(|plan| plan.name).unwrap_or_else(|| "—".to_string()),
            period_from: to_date(row.start_date.as_deref()),
            period_to: to_date(row.end_date.as_deref()),
            amount: row.amount.unwrap_or(0.0),
            currency: row.currency.unwrap_or_else(|| "INR".to_string()),
            method: row.payment_method.unwrap_or_else(|| "—".to_string()),
            status: row.status,
        })
        .collect())
}
