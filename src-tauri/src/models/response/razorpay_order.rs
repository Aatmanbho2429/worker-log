use serde::{Deserialize, Serialize};

/// What `create-order` answers with — exactly what `RazorpayService` needs to
/// open the checkout widget, nothing more. The operator's name, email and
/// phone are not part of this: `AuthService.user()` already holds all three
/// in the window, so the widget's `prefill` is built there instead of being
/// round-tripped through a function that would otherwise be handing back
/// account details for anyone who could reach it with a valid token.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RazorpayOrder {
    pub order_id: String,
    /// Paise, an integer — Razorpay's own unit, not the rupee `f64`
    /// `Plan.amount` carries.
    pub amount: i64,
    pub currency: String,
    /// Razorpay's publishable key. Safe to hand to the window: it identifies
    /// which Razorpay account the order belongs to, and only the key
    /// *secret* — which never leaves `create-order` — can act on it.
    pub key_id: String,
}
