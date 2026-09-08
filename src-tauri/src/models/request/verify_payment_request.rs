use serde::Deserialize;

/// What checkout hands back once Razorpay's widget reports success. The
/// `razorpay_signature` is what `verify-payment` recomputes and checks —
/// nothing here is trusted until that check passes.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VerifyPaymentRequest {
    pub plan_id: String,
    pub razorpay_order_id: String,
    pub razorpay_payment_id: String,
    pub razorpay_signature: String,
}
