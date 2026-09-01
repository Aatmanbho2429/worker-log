import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { AuthService } from '../../core/auth.service';
import { NotifyService } from '../../core/notify.service';
import { TranslateService } from '@ngx-translate/core';
import {
  Payment,
  SETTLED_PAYMENT_STATUSES,
  accountFullName,
  accountInitials,
  confirmProblem,
  formatPhone,
  passwordProblem,
  passwordScore,
  passwordScoreKey,
  paymentSeverity,
  shortDeviceId,
  subscriptionLabel,
  subscriptionSeverity,
} from '../../models/auth';
import { PrimengComponentsModule } from '../../shared/primeng-components-module';

interface PasswordForm {
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
}

const EMPTY_PASSWORD_FORM: PasswordForm = {
  currentPassword: '',
  newPassword: '',
  confirmPassword: '',
};

/**
 * The account, what is left on the subscription, and what has been paid for it.
 *
 * Everything on the left comes from the session the shell is already holding,
 * so the page paints immediately; only the payment history is fetched.
 */
@Component({
  selector: 'app-profile',
  imports: [PrimengComponentsModule, FormsModule],
  templateUrl: './profile.html',
  styleUrl: './profile.scss',
})
export class Profile {
  private readonly auth = inject(AuthService);
  private readonly notify = inject(NotifyService);
  private readonly translate = inject(TranslateService);

  protected readonly user = this.auth.user;
  protected readonly subscription = this.auth.subscription;

  protected readonly payments = signal<Payment[]>([]);
  protected readonly loading = signal(true);

  protected readonly initials = computed(() => {
    const user = this.user();
    return user ? accountInitials(user) : '';
  });

  protected readonly fullName = computed(() => {
    const user = this.user();
    return user ? accountFullName(user) : '';
  });

  /** How much of the current term has been used, as a percentage. */
  protected readonly termUsed = computed(() => {
    const subscription = this.subscription();
    if (!subscription) {
      return 0;
    }
    const used = subscription.termDays - subscription.daysLeft;
    return Math.min(Math.max(Math.round((used / subscription.termDays) * 100), 0), 100);
  });

  /** The rows where money actually changed hands, newest first. */
  private readonly settled = computed(() =>
    this.payments().filter((payment) => SETTLED_PAYMENT_STATUSES.includes(payment.status)),
  );

  protected readonly paidTotal = computed(() =>
    this.settled().reduce((total, payment) => total + payment.amount, 0),
  );

  /**
   * What to total in. Every row carries its own currency, so a running total
   * only means anything in one of them — the most recent is the honest choice,
   * and in practice they are all INR.
   */
  protected readonly totalCurrency = computed(() => this.settled()[0]?.currency ?? 'INR');

  // ---------------------------------------------------- change password ---

  protected readonly dialogOpen = signal(false);
  protected readonly form = signal<PasswordForm>({ ...EMPTY_PASSWORD_FORM });
  protected readonly submitted = signal(false);
  protected readonly saving = signal(false);

  protected readonly currentError = computed(() =>
    this.submitted() && !this.form().currentPassword ? 'validation.currentPasswordRequired' : null,
  );

  protected readonly newError = computed(() => {
    if (!this.submitted()) {
      return null;
    }
    const form = this.form();
    const problem = passwordProblem(form.newPassword);
    if (problem) {
      return problem;
    }
    // Saving the same password again is almost always a half-finished edit.
    return form.newPassword === form.currentPassword ? 'validation.passwordUnchanged' : null;
  });

  protected readonly confirmError = computed(() =>
    this.submitted() ? confirmProblem(this.form().newPassword, this.form().confirmPassword) : null,
  );

  protected readonly score = computed(() => passwordScore(this.form().newPassword));

  protected readonly scoreTone = computed(
    () => ['none', 'weak', 'fair', 'good', 'strong'][this.score()],
  );

  /** A translation key; the template pipes it. */
  protected readonly scoreLabel = computed(() => passwordScoreKey(this.score()));

  constructor() {
    void this.load();
  }

  protected openPasswordDialog(): void {
    this.form.set({ ...EMPTY_PASSWORD_FORM });
    this.submitted.set(false);
    this.dialogOpen.set(true);
  }

  protected patch<K extends keyof PasswordForm>(field: K, value: PasswordForm[K]): void {
    this.form.update((current) => ({ ...current, [field]: value }));
  }

  protected async savePassword(): Promise<void> {
    this.submitted.set(true);

    if (this.currentError() || this.newError() || this.confirmError() || this.saving()) {
      return;
    }

    this.saving.set(true);

    try {
      await this.auth.changePassword({
        currentPassword: this.form().currentPassword,
        newPassword: this.form().newPassword,
      });
      this.notify.success(this.translate.instant('profile.changePasswordDone'));
      this.dialogOpen.set(false);
    } catch (error) {
      this.notify.fromCommand(error, this.translate.instant('profile.changePasswordFailed'));
    } finally {
      this.saving.set(false);
    }
  }

  // --------------------------------------------------------- formatting ---

  /**
   * `12 Aug 2026`, from the backend's `YYYY-MM-DD`.
   *
   * `subscriptions_start_date` and `subscriptions_end_date` are both nullable,
   * so a row that was written by hand rather than by the register function can
   * arrive with nothing in them. An em dash is the honest answer; `new Date()`
   * on an empty string would print "Invalid Date" on the profile.
   */
  protected date(iso: string): string {
    if (!iso) {
      return '—';
    }

    const [year, month, day] = iso.split('-').map(Number);
    // Built from the parts rather than parsed, so a date-only string cannot
    // slide a day either way on the timezone.
    return new Date(year, month - 1, day).toLocaleDateString('en-GB', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });
  }

  /** `₹11,800`, from the amount and the currency the row was charged in. */
  protected money(amount: number, currency: string): string {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency,
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    }).format(amount);
  }

  protected readonly formatPhone = formatPhone;
  protected readonly shortDeviceId = shortDeviceId;
  protected readonly subscriptionLabel = subscriptionLabel;
  protected readonly subscriptionSeverity = subscriptionSeverity;
  protected readonly paymentSeverity = paymentSeverity;

  private async load(): Promise<void> {
    this.loading.set(true);
    try {
      this.payments.set(await this.auth.payments());
    } catch (error) {
      this.notify.fromCommand(error, this.translate.instant('profile.paymentsFailed'));
    } finally {
      this.loading.set(false);
    }
  }
}
