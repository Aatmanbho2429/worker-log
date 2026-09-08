use serde::{Deserialize, Serialize};

/// One row of `public.plans`, as `get-plans` returns it — the renewal
/// catalogue shown on the profile once a subscription has expired or is
/// about to.
///
/// `is_active` and `sort_order` are the function's own query criteria, not
/// display data, so they never cross the bridge; what is left is exactly
/// what the profile draws a card from.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Plan {
    pub id: String,
    pub name: String,
    /// Days the term runs for — 30 / 90 / 180 / 365 for the four seeded rows.
    pub duration: i64,
    /// `numeric(10,2)` in Postgres, read as `f64` the same way
    /// `SubscriptionRow.amount` already is in `auth.rs`.
    pub amount: f64,
    /// ISO 4217. Defaults to INR in the schema.
    pub currency: String,
}
