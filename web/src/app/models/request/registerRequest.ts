/**
 * `auth_register`. The device id is not here — Rust reads it off the machine.
 *
 * `otpCode` is the code `auth_send_otp` mailed to `email` moments earlier.
 */
export interface RegisterRequest {
  firstName: string;
  lastName: string;
  phone: string;
  email: string;
  password: string;
  companyName: string;
  otpCode: string;
}
