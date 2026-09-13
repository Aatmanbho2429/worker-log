import { Component, OnDestroy, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';

import { AuthService } from '../../../core/auth.service';
import { NotifyService } from '../../../core/notify.service';
import { TranslateService } from '@ngx-translate/core';
import { PasswordReset, emailProblem, otpProblem } from '../../../models/auth';
import { ROUTE_REGISTER, ROUTE_WASTE } from '../../../models/constants';
import { PrimengComponentsModule } from '../../../shared/primeng-components-module';

/** How long, in seconds, a resend is blocked for once one has gone out. */
const DEFAULT_COOLDOWN_SECONDS = 60;

type ForgotStep = 'email' | 'code' | 'done';

/**
 * Signing in, and resetting a forgotten password.
 *
 * A wrong address and a wrong password come back as the same message from the
 * backend on purpose, so the sign-in form cannot be used to find out which
 * addresses have accounts. The licence refusal is the one failure worth
 * spelling out — the operator needs to know it is the machine, not the
 * password.
 *
 * The forgot-password dialog is deliberately not held to the same rule: it
 * checks the address exists, is active and is licensed to this PC before
 * mailing anything, and says so plainly. It is a licensed tool with a known
 * operator at a known machine, so a clear message there is worth more than
 * the enumeration it costs — see `.claude/skills/supabase/registration.md`.
 */
@Component({
  selector: 'app-login',
  imports: [PrimengComponentsModule, FormsModule, RouterLink],
  templateUrl: './login.html',
  styleUrl: './login.scss',
})
export class Login implements OnDestroy {
  private readonly auth = inject(AuthService);
  private readonly notify = inject(NotifyService);
  private readonly router = inject(Router);
  private readonly translate = inject(TranslateService);

  protected readonly ROUTE_REGISTER = ROUTE_REGISTER;

  protected readonly email = signal('');
  protected readonly password = signal('');
  protected readonly submitted = signal(false);
  protected readonly signingIn = signal(false);

  protected readonly emailError = computed(() =>
    this.submitted() ? emailProblem(this.email()) : null,
  );

  protected readonly passwordError = computed(() =>
    this.submitted() && !this.password() ? 'validation.passwordRequired' : null,
  );

  // ------------------------------------------------- forgotten password ---
  //
  // Three steps, not one dialog action: the address is checked and a code is
  // mailed to it, the operator enters the code, and only then is a new
  // password rolled, mailed, and set. `forgotResult` (the address the new
  // password went to) is only ever populated once the `done` step is reached.

  protected readonly forgotOpen = signal(false);
  protected readonly forgotStep = signal<ForgotStep>('email');
  protected readonly forgotEmail = signal('');
  protected readonly forgotSubmitted = signal(false);
  protected readonly forgotSending = signal(false);
  protected readonly forgotResult = signal<PasswordReset | null>(null);

  protected readonly forgotCode = signal('');
  protected readonly forgotCodeSubmitted = signal(false);
  protected readonly forgotCooldown = signal(0);
  private cooldownTimer?: ReturnType<typeof setInterval>;

  protected readonly forgotError = computed(() =>
    this.forgotSubmitted() ? emailProblem(this.forgotEmail()) : null,
  );

  protected readonly forgotCodeError = computed(() =>
    this.forgotCodeSubmitted() ? otpProblem(this.forgotCode()) : null,
  );

  /** The address the code was sent to — locked once the code step is reached. */
  protected readonly forgotEmailLocked = computed(() => this.forgotEmail().trim().toLowerCase());

  protected async submit(): Promise<void> {
    this.submitted.set(true);

    if (emailProblem(this.email()) || !this.password() || this.signingIn()) {
      return;
    }

    this.signingIn.set(true);

    try {
      const session = await this.auth.login({
        email: this.email().trim().toLowerCase(),
        password: this.password(),
      });

      this.notify.success(
        this.translate.instant('auth.login.welcome', { name: session.user.firstName }),
      );
      await this.router.navigate([ROUTE_WASTE]);
    } catch (error) {
      this.notify.fromCommand(error, this.translate.instant('auth.login.failed'));
    } finally {
      this.signingIn.set(false);
    }
  }

  ngOnDestroy(): void {
    this.stopForgotCooldown();
  }

  private stopForgotCooldown(): void {
    if (this.cooldownTimer !== undefined) {
      clearInterval(this.cooldownTimer);
      this.cooldownTimer = undefined;
    }
  }

  private startForgotCooldown(seconds: number): void {
    this.stopForgotCooldown();
    this.forgotCooldown.set(seconds);
    this.cooldownTimer = setInterval(() => {
      const next = this.forgotCooldown() - 1;
      if (next <= 0) {
        this.forgotCooldown.set(0);
        this.stopForgotCooldown();
      } else {
        this.forgotCooldown.set(next);
      }
    }, 1000);
  }

  protected openForgot(): void {
    this.stopForgotCooldown();
    this.forgotStep.set('email');
    // The address already typed is almost always the one they want.
    this.forgotEmail.set(this.email());
    this.forgotSubmitted.set(false);
    this.forgotCode.set('');
    this.forgotCodeSubmitted.set(false);
    this.forgotCooldown.set(0);
    this.forgotResult.set(null);
    this.forgotOpen.set(true);
  }

  /** Step one: validate the address, then mail a code to prove it. */
  protected async sendCode(): Promise<void> {
    this.forgotSubmitted.set(true);

    if (emailProblem(this.forgotEmail()) || this.forgotSending()) {
      return;
    }

    this.forgotSending.set(true);

    try {
      const { retryAfterSeconds } = await this.auth.forgotPasswordSendOtp(this.forgotEmailLocked());
      this.notify.success(this.translate.instant('auth.forgot.codeSent'));
      this.startForgotCooldown(retryAfterSeconds || DEFAULT_COOLDOWN_SECONDS);
      this.forgotCode.set('');
      this.forgotCodeSubmitted.set(false);
      this.forgotStep.set('code');
    } catch (error) {
      // The not-found / other-PC / blocked messages arrive here exactly as
      // the function wrote them — nothing about this dialog softens them.
      this.notify.fromCommand(error, this.translate.instant('auth.forgot.sendFailed'));
    } finally {
      this.forgotSending.set(false);
    }
  }

  /** Asks for another code without leaving the code step — gated by the cooldown. */
  protected resendCode(): void {
    if (this.forgotCooldown() > 0 || this.forgotSending()) {
      return;
    }
    void this.sendCode();
  }

  /** Back to the email step — a typo in the address is the likeliest mistake. */
  protected backToEmail(): void {
    this.stopForgotCooldown();
    this.forgotStep.set('email');
    this.forgotCode.set('');
    this.forgotCodeSubmitted.set(false);
  }

  /** Step two: the code goes back; a correct one mails a new password and sets it. */
  protected async verifyCode(): Promise<void> {
    this.forgotCodeSubmitted.set(true);

    if (otpProblem(this.forgotCode()) || this.forgotSending()) {
      return;
    }

    this.forgotSending.set(true);

    try {
      const result = await this.auth.forgotPasswordVerify({
        email: this.forgotEmailLocked(),
        otpCode: this.forgotCode().trim(),
      });
      this.stopForgotCooldown();
      this.forgotResult.set(result);
      this.forgotStep.set('done');
    } catch (error) {
      this.notify.fromCommand(error, this.translate.instant('auth.forgot.failed'));
    } finally {
      this.forgotSending.set(false);
    }
  }

  /**
   * The dialog's own close — the header's × or Escape — bypasses every
   * button here, so the cooldown timer has to be stopped from this hook too,
   * not only from {@link closeForgot}.
   */
  protected onForgotVisibleChange(visible: boolean): void {
    this.forgotOpen.set(visible);
    if (!visible) {
      this.stopForgotCooldown();
    }
  }

  /** Closes the dialog and puts the address back in the sign-in form. */
  protected closeForgot(): void {
    const result = this.forgotResult();
    if (result) {
      this.email.set(result.sentTo);
      this.password.set('');
      this.submitted.set(false);
    }
    this.stopForgotCooldown();
    this.forgotOpen.set(false);
  }
}
