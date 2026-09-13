/**
 * The result of a forgotten-password request.
 *
 * The password itself is deliberately not in here. It is set and mailed by
 * `forgot-password-verify-otp`, only once the address has proved itself with
 * a code — returning the password to this response as well would mean any
 * process that could read a Tauri command's result (not just the account's
 * own inbox) could learn it.
 */
export interface PasswordReset {
  sentTo: string;
}
