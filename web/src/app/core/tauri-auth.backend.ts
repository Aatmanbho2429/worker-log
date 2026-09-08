import { Injectable, inject } from '@angular/core';

import { PasswordReset, Payment, Plan, Session } from '../models/auth';
import {
  ChangePasswordRequest,
  LoginRequest,
  OtpSent,
  RazorpayOrder,
  RegisterRequest,
  RestoreResponse,
  VerifyPaymentRequest,
} from '../models/auth.requests';
import { AuthBackend } from './auth.backend';
import { ZoneWrapperService } from './zone-wrapper/zone-wrapper.service';
import { TAURI_COMMANDS } from './tauri/tauri-commands.const';

/**
 * Accounts, by way of Rust.
 *
 * There is no logic in this file and there is not meant to be any. Supabase,
 * the project URL, the anon key, the session tokens and the licence check all
 * live in `src-tauri/src/auth.rs`; this is the calls that reach them.
 *
 * Keeping it this thin is the point. A rule enforced in TypeScript is a rule
 * enforced inside the window, where anyone with the developer tools can watch
 * it happen and step over it. Rust is compiled, holds the only copy of the
 * configuration, and is the layer the device binding is worth checking in.
 */
@Injectable()
export class TauriAuthBackend extends AuthBackend {
  private readonly zoneWrapper = inject(ZoneWrapperService);

  deviceId(): Promise<string> {
    return this.zoneWrapper.invoke<string>(TAURI_COMMANDS.deviceId);
  }

  restore(): Promise<Session | null> {
    return this.zoneWrapper.invoke<RestoreResponse>(TAURI_COMMANDS.authRestore);
  }

  validate(): Promise<Session | null> {
    return this.zoneWrapper.invoke<RestoreResponse>(TAURI_COMMANDS.authValidate);
  }

  sendOtp(email: string): Promise<OtpSent> {
    return this.zoneWrapper.invoke<OtpSent>(TAURI_COMMANDS.authSendOtp, { email });
  }

  register(payload: RegisterRequest): Promise<void> {
    return this.zoneWrapper.invoke<void>(TAURI_COMMANDS.authRegister, { payload });
  }

  login(payload: LoginRequest): Promise<Session> {
    return this.zoneWrapper.invoke<Session>(TAURI_COMMANDS.authLogin, { payload });
  }

  logout(): Promise<void> {
    return this.zoneWrapper.invoke<void>(TAURI_COMMANDS.authLogout);
  }

  forgotPassword(email: string): Promise<PasswordReset> {
    return this.zoneWrapper.invoke<PasswordReset>(TAURI_COMMANDS.authForgotPassword, { email });
  }

  changePassword(payload: ChangePasswordRequest): Promise<void> {
    return this.zoneWrapper.invoke<void>(TAURI_COMMANDS.authChangePassword, { payload });
  }

  payments(): Promise<Payment[]> {
    return this.zoneWrapper.invoke<Payment[]>(TAURI_COMMANDS.authPayments);
  }

  plans(): Promise<Plan[]> {
    return this.zoneWrapper.invoke<Plan[]>(TAURI_COMMANDS.authPlans);
  }

  createOrder(planId: string): Promise<RazorpayOrder> {
    return this.zoneWrapper.invoke<RazorpayOrder>(TAURI_COMMANDS.authCreateOrder, { planId });
  }

  verifyPayment(payload: VerifyPaymentRequest): Promise<Session> {
    return this.zoneWrapper.invoke<Session>(TAURI_COMMANDS.authVerifyPayment, { payload });
  }
}
