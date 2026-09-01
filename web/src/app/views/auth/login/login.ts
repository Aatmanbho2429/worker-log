import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';

import { AuthService } from '../../../core/auth.service';
import { NotifyService } from '../../../core/notify.service';
import { TranslateService } from '@ngx-translate/core';
import { PasswordReset, emailProblem } from '../../../models/auth';
import { PrimengComponentsModule } from '../../../shared/primeng-components-module';

/**
 * Signing in, and rolling a new password for whoever has forgotten theirs.
 *
 * A wrong address and a wrong password come back as the same message from the
 * backend on purpose, so the form cannot be used to find out which addresses
 * have accounts. The licence refusal is the one failure worth spelling out —
 * the operator needs to know it is the machine, not the password.
 */
@Component({
  selector: 'app-login',
  imports: [PrimengComponentsModule, FormsModule, RouterLink],
  templateUrl: './login.html',
  styleUrl: './login.scss',
})
export class Login {
  private readonly auth = inject(AuthService);
  private readonly notify = inject(NotifyService);
  private readonly router = inject(Router);
  private readonly translate = inject(TranslateService);

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

  protected readonly forgotOpen = signal(false);
  protected readonly forgotEmail = signal('');
  protected readonly forgotSubmitted = signal(false);
  protected readonly forgotSending = signal(false);
  protected readonly forgotResult = signal<PasswordReset | null>(null);

  protected readonly forgotError = computed(() =>
    this.forgotSubmitted() ? emailProblem(this.forgotEmail()) : null,
  );

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
      await this.router.navigate(['/waste']);
    } catch (error) {
      this.notify.fromCommand(error, this.translate.instant('auth.login.failed'));
    } finally {
      this.signingIn.set(false);
    }
  }

  protected openForgot(): void {
    // The address already typed is almost always the one they want.
    this.forgotEmail.set(this.email());
    this.forgotSubmitted.set(false);
    this.forgotResult.set(null);
    this.forgotOpen.set(true);
  }

  protected async sendNewPassword(): Promise<void> {
    this.forgotSubmitted.set(true);

    if (emailProblem(this.forgotEmail()) || this.forgotSending()) {
      return;
    }

    this.forgotSending.set(true);

    try {
      this.forgotResult.set(await this.auth.forgotPassword(this.forgotEmail().trim()));
    } catch (error) {
      this.notify.fromCommand(error, this.translate.instant('auth.forgot.failed'));
    } finally {
      this.forgotSending.set(false);
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
    this.forgotOpen.set(false);
  }
}
