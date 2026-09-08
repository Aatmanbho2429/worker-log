/**
 * What checkout hands back once Razorpay's widget reports success. `auth_verify_payment`
 * trusts none of it until `razorpaySignature` checks out server-side.
 */
export interface VerifyPaymentRequest {
  planId: string;
  razorpayOrderId: string;
  razorpayPaymentId: string;
  razorpaySignature: string;
}
