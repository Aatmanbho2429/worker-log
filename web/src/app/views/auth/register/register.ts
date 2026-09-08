import { Component, OnDestroy, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';

import { AuthService } from '../../../core/auth.service';
import { NotifyService } from '../../../core/notify.service';
import { TranslateService } from '@ngx-translate/core';
import {
  companyProblem,
  confirmProblem,
  emailProblem,
  nameProblem,
  normalizePhone,
  otpProblem,
  passwordProblem,
  passwordScore,
  passwordScoreKey,
  phoneProblem,
} from '../../../models/auth';
import { ROUTE_LOGIN } from '../../../models/constants';
import { PrimengComponentsModule } from '../../../shared/primeng-components-module';

interface FormState {
  firstName: string;
  lastName: string;
  phone: string;
  email: string;
  companyName: string;
  password: string;
  confirmPassword: string;
}

type Field = keyof FormState;

const EMPTY_FORM: FormState = {
  firstName: '',
  lastName: '',
  phone: '',
  email: '',
  companyName: '',
  password: '',
  confirmPassword: '',
};

type Step = 'details' | 'code' | 'success';

/** How long, in seconds, a resend is blocked for once one has gone out. */
const DEFAULT_COOLDOWN_SECONDS = 60;

/**
 * Opening an account, and binding it to this PC.
 *
 * Three steps, not one form: the details are collected here but nothing is
 * written anywhere until the address has been proved. `requestCode` mails a
 * one-time code to it and holds the form in memory; `confirm` sends the code
 * back alongside the same details, and the `register` edge function only
 * creates the account if the two agree. There is no way back to step one
 * once a code has gone out — a typo in the address means asking support,
 * same as any other wrong detail once the account exists.
 *
 * Registering does not sign anybody in — `AuthService.register` only opens
 * the account, same as the edge function it calls. The third step tells the
 * operator that plainly and sends them to `/login` rather than assuming they
 * want straight in on the same credentials they just typed.
 *
 * The confirmation field never leaves this component — it is here to catch a
 * typo in a password nobody can read back, and there is nothing for the backend
 * to do with it. The device fingerprint travels the other way: the Rust side
 * reads it off the machine and stores it with the account, and this page only
 * shows which machine that is about to be.
 */
@Component({
  selector: 'app-register',
  imports: [PrimengComponentsModule, FormsModule, RouterLink],
  templateUrl: './register.html',
  styleUrl: './register.scss',
})
export class Register implements OnDestroy {
  private readonly auth = inject(AuthService);
  private readonly notify = inject(NotifyService);
  private readonly router = inject(Router);
  private readonly translate = inject(TranslateService);

  protected readonly ROUTE_LOGIN = ROUTE_LOGIN;

  protected readonly form = signal<FormState>({ ...EMPTY_FORM });
  protected readonly saving = signal(false);

  protected readonly step = signal<Step>('details');
  protected readonly otpCode = signal('');
  protected readonly cooldown = signal(0);

  private readonly otpTouched = signal(false);
  private readonly otpSubmitted = signal(false);
  private cooldownTimer?: ReturnType<typeof setInterval>;

  /** Fields the operator has left, so an untouched form is not all red. */
  private readonly touched = signal<ReadonlySet<Field>>(new Set());
  private readonly submitted = signal(false);

  protected readonly problems = computed<Record<Field, string | null>>(() => {
    const form = this.form();
    return {
      firstName: nameProblem(form.firstName, 'firstName'),
      lastName: nameProblem(form.lastName, 'lastName'),
      phone: phoneProblem(form.phone),
      email: emailProblem(form.email),
      companyName: companyProblem(form.companyName),
      password: passwordProblem(form.password),
      confirmPassword: confirmProblem(form.password, form.confirmPassword),
    };
  });

  protected readonly valid = computed(() =>
    Object.values(this.problems()).every((problem) => problem === null),
  );

  protected readonly score = computed(() => passwordScore(this.form().password));

  protected readonly scoreTone = computed(
    () => ['none', 'weak', 'fair', 'good', 'strong'][this.score()],
  );

  /** A translation key; the template pipes it. */
  protected readonly scoreLabel = computed(() => passwordScoreKey(this.score()));

  protected patch<K extends Field>(field: K, value: FormState[K]): void {
    this.form.update((current) => ({ ...current, [field]: value }));
  }

  protected touch(field: Field): void {
    this.touched.update((current) => new Set(current).add(field));
  }

  /** The message to print under a field, once it is fair to print one. */
  protected problem(field: Field): string | null {
    if (!this.submitted() && !this.touched().has(field)) {
      return null;
    }
    return this.problems()[field];
  }

  private readonly otpCodeProblem = computed(() => otpProblem(this.otpCode()));

  /** The email the code was sent to — locked once step two is reached. */
  protected readonly otpEmail = computed(() => this.form().email.trim().toLowerCase());

  /** The first name as typed, for the success step's greeting. */
  protected readonly firstName = computed(() => this.form().firstName.trim());

  protected touchOtp(): void {
    this.otpTouched.set(true);
  }

  /** The message to print under the code field, once it is fair to print one. */
  protected otpFieldProblem(): string | null {
    if (!this.otpSubmitted() && !this.otpTouched()) {
      return null;
    }
    return this.otpCodeProblem();
  }

  ngOnDestroy(): void {
    this.stopCooldown();
  }

  private stopCooldown(): void {
    if (this.cooldownTimer !== undefined) {
      clearInterval(this.cooldownTimer);
      this.cooldownTimer = undefined;
    }
  }

  private startCooldown(seconds: number): void {
    this.stopCooldown();
    this.cooldown.set(seconds);
    this.cooldownTimer = setInterval(() => {
      const next = this.cooldown() - 1;
      if (next <= 0) {
        this.cooldown.set(0);
        this.stopCooldown();
      } else {
        this.cooldown.set(next);
      }
    }, 1000);
  }

  /** Step one: validate the details, then mail a code to prove the address. */
  protected async requestCode(): Promise<void> {
    this.submitted.set(true);

    if (!this.valid() || this.saving()) {
      return;
    }

    this.saving.set(true);

    try {
      const { retryAfterSeconds } = await this.auth.sendOtp(this.otpEmail());
      this.notify.success(this.translate.instant('auth.register.codeSent'));
      this.startCooldown(retryAfterSeconds || DEFAULT_COOLDOWN_SECONDS);
      this.otpCode.set('');
      this.otpTouched.set(false);
      this.otpSubmitted.set(false);
      this.step.set('code');
    } catch (error) {
      this.notify.fromCommand(error, this.translate.instant('auth.register.sendFailed'));
    } finally {
      this.saving.set(false);
    }
  }

  /** Asks for another code without leaving step two — gated by the cooldown. */
  protected resend(): void {
    if (this.cooldown() > 0 || this.saving()) {
      return;
    }
    void this.requestCode();
  }

  /** Step two: the code and the details travel together to `register`. */
  protected async confirm(): Promise<void> {
    this.otpSubmitted.set(true);

    if (this.otpCodeProblem() || this.saving()) {
      return;
    }

    const form = this.form();
    this.saving.set(true);

    try {
      await this.auth.register({
        firstName: form.firstName.trim(),
        lastName: form.lastName.trim(),
        // Stored as ten bare digits whatever the operator typed around them.
        phone: normalizePhone(form.phone),
        email: this.otpEmail(),
        companyName: form.companyName.trim(),
        password: form.password,
        otpCode: this.otpCode().trim(),
      });

      // No session comes back — registering only opens the account. The
      // third step says so and hands the operator to `/login`.
      this.step.set('success');
    } catch (error) {
      this.notify.fromCommand(error, this.translate.instant('auth.register.failed'));
    } finally {
      this.saving.set(false);
    }
  }

  protected goToLogin(): void {
    void this.router.navigate([ROUTE_LOGIN]);
  }
}
