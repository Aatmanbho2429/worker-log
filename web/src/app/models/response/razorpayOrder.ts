/**
 * What `auth_create_order` answers with — exactly what `RazorpayService`
 * needs to open the checkout widget, nothing more. The operator's name,
 * email and phone are not part of this: `AuthService.user()` already holds
 * all three in the window, so the widget's `prefill` is built there instead.
 */
export interface RazorpayOrder {
  orderId: string;
  /** Paise, an integer — Razorpay's own unit, not the rupee `Plan.amount`. */
  amount: number;
  currency: string;
  /** Razorpay's publishable key, safe to hand to the widget. */
  keyId: string;
}
