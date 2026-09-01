import { Injectable, inject } from '@angular/core';

import { PasswordReset, Payment, Session } from '../models/auth';
import {
  AUTH_COMMANDS,
  ChangePasswordRequest,
  LoginRequest,
  RegisterRequest,
  RestoreResponse,
} from '../models/auth.requests';
import { AuthBackend } from './auth.backend';
import { TauriService } from './tauri.service';

/**
 * Accounts, by way of Rust.
 *
 * There is no logic in this file and there is not meant to be any. Supabase,
 * the project URL, the anon key, the session tokens and the licence check all
 * live in `src-tauri/src/auth.rs`; this is the seven calls that reach them.
 *
 * Keeping it this thin is the point. A rule enforced in TypeScript is a rule
 * enforced inside the window, where anyone with the developer tools can watch
 * it happen and step over it. Rust is compiled, holds the only copy of the
 * configuration, and is the layer the device binding is worth checking in.
 */
@Injectable()
export class TauriAuthBackend extends AuthBackend {
  private readonly tauri = inject(TauriService);

  deviceId(): Promise<string> {
    return this.tauri.call<string>(AUTH_COMMANDS.deviceId);
  }

  restore(): Promise<Session | null> {
    return this.tauri.call<RestoreResponse>(AUTH_COMMANDS.restore);
  }

  register(payload: RegisterRequest): Promise<Session> {
    return this.tauri.call<Session>(AUTH_COMMANDS.register, { payload });
  }

  login(payload: LoginRequest): Promise<Session> {
    return this.tauri.call<Session>(AUTH_COMMANDS.login, { payload });
  }

  logout(): Promise<void> {
    return this.tauri.call<void>(AUTH_COMMANDS.logout);
  }

  forgotPassword(email: string): Promise<PasswordReset> {
    return this.tauri.call<PasswordReset>(AUTH_COMMANDS.forgotPassword, { email });
  }

  changePassword(payload: ChangePasswordRequest): Promise<void> {
    return this.tauri.call<void>(AUTH_COMMANDS.changePassword, { payload });
  }

  payments(): Promise<Payment[]> {
    return this.tauri.call<Payment[]>(AUTH_COMMANDS.payments);
  }
}
