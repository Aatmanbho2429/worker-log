/**
 * What crosses the Tauri bridge, in both directions.
 *
 * These are the request and response shapes of the `auth_*` commands, and they
 * are separate from the domain models in `auth.ts` on purpose. `auth.ts` says
 * what the account screens display; this says what Rust is sent and what Rust
 * sends back. When one changes the other does not have to, and a mismatch shows
 * up here rather than three components deep.
 *
 * Every field name matches the `#[serde(rename_all = "camelCase")]` structs in
 * `src-tauri/src/auth.rs`. The types themselves live one apiece in
 * `models/request/` and `models/response/` (`.claude/rules/models.md`) and are
 * re-exported here so the account screens have one file to import from.
 */

export type { ChangePasswordRequest } from './request/changePasswordRequest';
export type { ForgotPasswordRequest } from './request/forgotPasswordRequest';
export type { LoginRequest } from './request/loginRequest';
export type { RegisterRequest } from './request/registerRequest';
export type { VerifyPaymentRequest } from './request/verifyPaymentRequest';

export type { ForgotPasswordResponse } from './response/forgotPasswordResponse';
export type { OtpSent } from './response/otpSent';
export type { PaymentsResponse } from './response/paymentsResponse';
export type { RazorpayOrder } from './response/razorpayOrder';
export type { RestoreResponse } from './response/restoreResponse';
export type { SessionResponse } from './response/sessionResponse';
