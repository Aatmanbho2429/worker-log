import { Injectable, computed, inject, signal } from '@angular/core';

import { PasswordReset, Payment, Session } from '../models/auth';
import {
  ChangePasswordRequest,
  LoginRequest,
  OtpSent,
  RegisterRequest,
} from '../models/auth.requests';
import { AuthBackend } from './auth.backend';

/**
 * How often a signed-in window re-checks its session against the server.
 * Frequent enough that a subscription lapsing, a device unbound from the
 * dashboard, or an account blocked mid-shift is noticed within the shift;
 * infrequent enough that it costs one request every few hours per terminal
 * rather than one an hour.
 */
const VALIDATE_INTERVAL_MS = 6 * 60 * 60 * 1000;

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
  private validateTimer?: ReturnType<typeof setInterval>;

  readonly user = computed(() => this.session()?.user ?? null);
  readonly subscription = computed(() => this.session()?.subscription ?? null);
  readonly signedIn = computed(() => this.session() !== null);
  readonly subscriptionExpired = computed(() => this.subscription()?.status === 'expired');

  /** Resolves once the stored session has been looked for, whatever the answer. */
  readonly ready: Promise<void>;

  constructor() {
    this.ready = this.restore();
  }

  /**
   * Mails a code to prove the address before {@link register} is called with
   * it. Does not touch the session — nothing exists yet to sign into.
   */
  sendOtp(email: string): Promise<OtpSent> {
    return this.backend.sendOtp(email);
  }

  /**
   * Opens an account. Does not sign it in — the screen sends the operator to
   * {@link login} instead, so there is no session here to set.
   */
  register(payload: RegisterRequest): Promise<void> {
    return this.backend.register(payload);
  }

  async login(payload: LoginRequest): Promise<Session> {
    const session = await this.backend.login(payload);
    this.session.set(session);
    this.scheduleValidation();
    return session;
  }

  async logout(): Promise<void> {
    try {
      await this.backend.logout();
    } finally {
      // Whatever the backend made of it, this window is signed out.
      this.session.set(null);
      this.stopValidation();
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
      const session = await this.backend.restore();
      this.session.set(session);
      if (session) {
        this.scheduleValidation();
      }
    } catch (error) {
      // A session that cannot be read is a session that is over. The screens
      // are about to show the sign-in page; there is nobody to tell yet.
      console.error(error);
      this.session.set(null);
    }
  }

  /**
   * Re-checks the session against the server on {@link VALIDATE_INTERVAL_MS}.
   * A `null` answer is a real refusal — wrong device, blocked account, a
   * refresh token that could not be renewed — and signs the window out the
   * same way a failed {@link restore} does. A thrown error is left alone:
   * this machine's own network trouble is not proof the session is over, and
   * the next tick tries again.
   */
  private async validate(): Promise<void> {
    try {
      const session = await this.backend.validate();
      this.session.set(session);
      if (!session) {
        this.stopValidation();
      }
    } catch (error) {
      console.error(error);
    }
  }

  private scheduleValidation(): void {
    this.stopValidation();
    this.validateTimer = setInterval(() => void this.validate(), VALIDATE_INTERVAL_MS);
  }

  private stopValidation(): void {
    if (this.validateTimer !== undefined) {
      clearInterval(this.validateTimer);
      this.validateTimer = undefined;
    }
  }
}
