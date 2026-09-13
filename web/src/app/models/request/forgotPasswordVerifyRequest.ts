/** `auth_forgot_password_verify`. */
export interface ForgotPasswordVerifyRequest {
  email: string;
  otpCode: string;
}
