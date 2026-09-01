import { Component, computed, inject, signal } from '@angular/core';
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
  passwordProblem,
  passwordScore,
  passwordScoreKey,
  phoneProblem,
} from '../../../models/auth';
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

/**
 * Opening an account, and binding it to this PC.
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
export class Register {
  private readonly auth = inject(AuthService);
  private readonly notify = inject(NotifyService);
  private readonly router = inject(Router);
  private readonly translate = inject(TranslateService);

  protected readonly form = signal<FormState>({ ...EMPTY_FORM });
  protected readonly saving = signal(false);

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

  protected async submit(): Promise<void> {
    this.submitted.set(true);

    if (!this.valid() || this.saving()) {
      return;
    }

    const form = this.form();
    this.saving.set(true);

    try {
      const session = await this.auth.register({
        firstName: form.firstName.trim(),
        lastName: form.lastName.trim(),
        // Stored as ten bare digits whatever the operator typed around them.
        phone: normalizePhone(form.phone),
        email: form.email.trim().toLowerCase(),
        companyName: form.companyName.trim(),
        password: form.password,
      });

      this.notify.success(
        this.translate.instant('auth.register.welcome', { name: session.user.firstName }),
      );
      await this.router.navigate(['/waste']);
    } catch (error) {
      this.notify.fromCommand(error, this.translate.instant('auth.register.failed'));
    } finally {
      this.saving.set(false);
    }
  }
}
