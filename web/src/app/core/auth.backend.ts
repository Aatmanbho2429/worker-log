import { Injectable } from '@angular/core';

import { PasswordReset, Payment, Session } from '../models/auth';
import { ChangePasswordRequest, LoginRequest, RegisterRequest } from '../models/auth.requests';

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

  abstract register(payload: RegisterRequest): Promise<Session>;

  abstract login(payload: LoginRequest): Promise<Session>;

  abstract logout(): Promise<void>;

  /** Rolls a new password for the account and sends it to the address on file. */
  abstract forgotPassword(email: string): Promise<PasswordReset>;

  abstract changePassword(payload: ChangePasswordRequest): Promise<void>;

  abstract payments(): Promise<Payment[]>;
}
