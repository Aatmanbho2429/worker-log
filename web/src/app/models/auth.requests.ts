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
 * `src-tauri/src/auth.rs`.
 */

import { Payment, PasswordReset, Session } from './auth';

// ------------------------------------------------------------- requests ---

/** `auth_register`. The device id is not here — Rust reads it off the machine. */
export interface RegisterRequest {
  firstName: string;
  lastName: string;
  phone: string;
  email: string;
  password: string;
  companyName: string;
}

/** `auth_login`. */
export interface LoginRequest {
  email: string;
  password: string;
}

/** `auth_change_password`. The confirmation never leaves the form. */
export interface ChangePasswordRequest {
  currentPassword: string;
  newPassword: string;
}

/** `auth_forgot_password`. */
export interface ForgotPasswordRequest {
  email: string;
}

// ------------------------------------------------------------ responses ---

/** `auth_register` and `auth_login` both answer with a full session. */
export type SessionResponse = Session;

/** `auth_restore` answers with null when nobody is signed in. */
export type RestoreResponse = Session | null;

/** `auth_forgot_password`. The new password is deliberately not in it. */
export type ForgotPasswordResponse = PasswordReset;

/** `auth_payments`. */
export type PaymentsResponse = Payment[];

/**
 * The commands themselves, named once so a typo becomes a compile error rather
 * than a rejected promise at runtime.
 */
export const AUTH_COMMANDS = {
  register: 'auth_register',
  login: 'auth_login',
  restore: 'auth_restore',
  logout: 'auth_logout',
  forgotPassword: 'auth_forgot_password',
  changePassword: 'auth_change_password',
  payments: 'auth_payments',
  deviceId: 'device_id',
} as const;
