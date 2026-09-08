/** `auth_send_otp`. Nothing about the code itself — only how long to wait. */
export interface OtpSent {
  retryAfterSeconds: number;
}
