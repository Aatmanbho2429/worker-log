import { Injectable } from '@angular/core';

import { PasswordReset, Payment, Plan, Session } from '../models/auth';
import {
  ChangePasswordRequest,
  ForgotPasswordVerifyRequest,
  LoginRequest,
  OtpSent,
  RazorpayOrder,
  RegisterRequest,
  VerifyPaymentRequest,
} from '../models/auth.requests';

/**
 * Everything the account screens need, and the seam between them and where the
 * accounts actually live.
 *
 * `TauriAuthBackend` is what implements it, and `app.config.ts` is the one line
 * that says so. Behind that seam everything is Rust: the screens neither know
 * nor care that a register goes through an edge function while a payment
 * history comes straight from PostgREST, and no part of `web/` holds a URL, a
 * key or a token.
 *
 * Rejections carry a `CommandError` shape — `{ kind, message }` — because
 * `NotifyService.fromCommand` decides between a warning and an error from the
 * kind, and the screens hand it every failure they catch. Rust maps a refusal
 * from Supabase into that shape, so a sentence written in an edge function
 * reaches the operator as the sentence it was written as.
 */
@Injectable()
export abstract class AuthBackend {
  /** The fingerprint of this PC, which a licence is bound to. */
  abstract deviceId(): Promise<string>;

  /** The signed-in session left over from last time, if there is one. */
  abstract restore(): Promise<Session | null>;

  /**
   * Re-checks the stored session: still a real token, still this PC, still
   * an active account, and whatever the subscription status now is. `null`
   * means the session is over — wrong device, blocked account, or a token
   * that could not be renewed — and the operator is signed out same as a
   * failed {@link restore}.
   */
  abstract validate(): Promise<Session | null>;

  /** Mails a code to prove the address before `register` is called with it. */
  abstract sendOtp(email: string): Promise<OtpSent>;

  /**
   * Opens an account. Does not sign in — the account and the session are two
   * separate facts, and this only makes the first one true.
   */
  abstract register(payload: RegisterRequest): Promise<void>;

  abstract login(payload: LoginRequest): Promise<Session>;

  abstract logout(): Promise<void>;

  /** Mails a code, if the address has an active account licensed to this PC. */
  abstract forgotPasswordSendOtp(email: string): Promise<OtpSent>;

  /** Checks the code, then mails a new password to the address and sets it. */
  abstract forgotPasswordVerify(payload: ForgotPasswordVerifyRequest): Promise<PasswordReset>;

  abstract changePassword(payload: ChangePasswordRequest): Promise<void>;

  abstract payments(): Promise<Payment[]>;

  /**
   * The renewal catalogue, unrelated to whether anyone is signed in — `Rust`
   * reads it with the service role key, so this can be called even from a
   * session that has just been found to be expired.
   */
  abstract plans(): Promise<Plan[]>;

  /** Opens a Razorpay order against a plan's real, server-read price. */
  abstract createOrder(planId: string): Promise<RazorpayOrder>;

  /**
   * Proves a Razorpay payment happened and records the term it bought.
   * Answers with a freshly rebuilt session rather than loose subscription
   * fields — `AuthService.verifyPayment` replaces its session signal with
   * it, which is what unblocks the app without a sign-out and back in.
   */
  abstract verifyPayment(payload: VerifyPaymentRequest): Promise<Session>;
}
