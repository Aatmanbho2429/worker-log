import { Injectable, computed, inject, signal } from '@angular/core';

import { PasswordReset, Payment, Session } from '../models/auth';
import { ChangePasswordRequest, LoginRequest, RegisterRequest } from '../models/auth.requests';
import { AuthBackend } from './auth.backend';

/**
 * Who is signed in, held as signals so the shell and the profile follow the
 * session without either of them subscribing to anything.
 *
 * The backend behind it does the work; this is the part the screens talk to.
 * {@link ready} matters more than it looks: the session is restored
 * asynchronously at start-up, and the guards have to wait for that answer or
 * they would bounce a returning operator to the sign-in page on every reload.
 */
@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly backend = inject(AuthBackend);

  private readonly session = signal<Session | null>(null);

  readonly user = computed(() => this.session()?.user ?? null);
  readonly subscription = computed(() => this.session()?.subscription ?? null);
  readonly signedIn = computed(() => this.session() !== null);

  /** Resolves once the stored session has been looked for, whatever the answer. */
  readonly ready: Promise<void>;

  constructor() {
    this.ready = this.restore();
  }

  async register(payload: RegisterRequest): Promise<Session> {
    const session = await this.backend.register(payload);
    this.session.set(session);
    return session;
  }

  async login(payload: LoginRequest): Promise<Session> {
    const session = await this.backend.login(payload);
    this.session.set(session);
    return session;
  }

  async logout(): Promise<void> {
    try {
      await this.backend.logout();
    } finally {
      // Whatever the backend made of it, this window is signed out.
      this.session.set(null);
    }
  }

  forgotPassword(email: string): Promise<PasswordReset> {
    return this.backend.forgotPassword(email);
  }

  changePassword(payload: ChangePasswordRequest): Promise<void> {
    return this.backend.changePassword(payload);
  }

  payments(): Promise<Payment[]> {
    return this.backend.payments();
  }

  deviceId(): Promise<string> {
    return this.backend.deviceId();
  }

  private async restore(): Promise<void> {
    try {
      this.session.set(await this.backend.restore());
    } catch (error) {
      // A session that cannot be read is a session that is over. The screens
      // are about to show the sign-in page; there is nobody to tell yet.
      console.error(error);
      this.session.set(null);
    }
  }
}
