import { Component, computed, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { AuthService } from '../../core/auth.service';
import { NotifyService } from '../../core/notify.service';
import {
  RazorpayCancelled,
  RazorpayCancelReason,
  RazorpayService,
} from '../../core/razorpay.service';
import { TranslateService } from '@ngx-translate/core';
import {
  Payment,
  Plan,
  SETTLED_PAYMENT_STATUSES,
  SubscriptionStatus,
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

/**
 * Razorpay's own widget colour, not one of `_tokens.scss`'s — the checkout
 * overlay is Razorpay's surface, not this app's, the same reason barcode
 * tiles and sheet header bands stay outside the theme (`.claude/rules/theming.md`).
 * Mirrors `$navy-500`, duplicated rather than shared because a Sass variable
 * cannot cross into a `.ts` file.
 */
const RAZORPAY_THEME_COLOR = '#1e4e86';

/** Which copy key explains a non-silent {@link RazorpayCancelled}. `dismissed` needs none — see `selectPlan`. */
const RAZORPAY_FAILURE_KEYS: Record<Exclude<RazorpayCancelReason, 'dismissed'>, string> = {
  paymentFailed: 'profile.paymentFailed',
  gatewayUnavailable: 'profile.gatewayFailed',
};

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
  private readonly razorpay = inject(RazorpayService);
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

  // ------------------------------------------------------------- plans ---

  private static readonly PLAN_VISIBLE_STATUSES: readonly SubscriptionStatus[] = [
    'expired',
    'expiring',
  ];

  protected readonly plans = signal<Plan[]>([]);
  protected readonly plansLoading = signal(false);
  protected readonly plansDialogOpen = signal(false);
  private plansLoaded = false;

  /** The plan currently mid-checkout, if any — one payment in flight at a time. */
  protected readonly payingPlanId = signal<string | null>(null);

  /**
   * Whether a "View plans" button belongs on the subscription card at all —
   * an operator with months left sees the profile exactly as it always has,
   * and `auth.plans()` is never called for them.
   */
  protected readonly showPlans = computed(() => {
    const status = this.subscription()?.status;
    return status !== undefined && Profile.PLAN_VISIBLE_STATUSES.includes(status);
  });

  /**
   * The plan with the lowest cost per day, so the tile can carry a "Best
   * value" ribbon — the catalogue has no such flag of its own, and a longer
   * term is not automatically the cheaper one to hold.
   */
  protected readonly bestPlanId = computed(() => {
    const list = this.plans();
    if (!list.length) {
      return null;
    }
    return list.reduce((best, plan) =>
      plan.amount / plan.duration < best.amount / best.duration ? plan : best,
    ).id;
  });

  /**
   * Longest term first — `get-plans` answers in `sort_order` (Monthly
   * first, cheapest commitment to longest), but the tile the operator should
   * see first is the one worth the most: reversed for display only, so
   * `bestPlanId` and every id-keyed lookup above still reads the untouched
   * `plans()` order.
   */
  protected readonly orderedPlans = computed(() => [...this.plans()].reverse());

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

    // An `effect` rather than a one-off call in the constructor: the
    // six-hourly `AuthService.validate()` tick can flip the subscription to
    // `expired` while this screen is already open, and an effect picks that
    // up where a constructor call would leave the operator staring at a
    // profile that never told them. Fires once per session — closing the
    // dialog does not reopen it; the "View plans" button on the subscription
    // card is how it is found again.
    effect(() => {
      if (this.showPlans() && !this.plansLoaded) {
        this.plansLoaded = true;
        this.plansDialogOpen.set(true);
        void this.loadPlans();
      }
    });
  }

  protected openPasswordDialog(): void {
    this.form.set({ ...EMPTY_PASSWORD_FORM });
    this.submitted.set(false);
    this.dialogOpen.set(true);
  }

  /**
   * Reopens the plans dialog after the operator has closed it. Also covers
   * the (unlikely) case of a click landing before the auto-open effect has
   * run — `plansLoaded` makes the load idempotent either way.
   */
  protected openPlansDialog(): void {
    this.plansDialogOpen.set(true);
    if (!this.plansLoaded) {
      this.plansLoaded = true;
      void this.loadPlans();
    }
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

  private async loadPlans(): Promise<void> {
    this.plansLoading.set(true);
    try {
      this.plans.set(await this.auth.plans());
    } catch (error) {
      this.notify.fromCommand(error, this.translate.instant('profile.plansFailed'));
    } finally {
      this.plansLoading.set(false);
    }
  }

  /**
   * Opens Razorpay's checkout for a plan, then hands what it reports to
   * `auth_verify_payment` for the check that actually matters — the
   * signature is recomputed server-side, so nothing the widget says here is
   * trusted until then.
   *
   * A dismissed checkout is not a failure: the operator closed the widget on
   * purpose, so it resets the spinner and says nothing rather than showing
   * an error for a choice they made deliberately.
   */
  protected async selectPlan(plan: Plan): Promise<void> {
    const account = this.user();
    // Cannot happen in practice — this dialog only opens for a signed-in
    // operator — but this keeps the branch total rather than assumed.
    if (!account || this.payingPlanId() !== null) {
      return;
    }

    this.payingPlanId.set(plan.id);

    try {
      const order = await this.auth.createOrder(plan.id);

      const checkout = await this.razorpay.open({
        orderId: order.orderId,
        amount: order.amount,
        currency: order.currency,
        keyId: order.keyId,
        name: this.translate.instant('common.brandName'),
        description: this.translate.instant('profile.paymentDescription', { plan: plan.name }),
        prefill: {
          name: accountFullName(account),
          email: account.email,
          contact: account.phone,
        },
        themeColor: RAZORPAY_THEME_COLOR,
      });

      const session = await this.auth.verifyPayment({
        planId: plan.id,
        razorpayOrderId: checkout.razorpayOrderId,
        razorpayPaymentId: checkout.razorpayPaymentId,
        razorpaySignature: checkout.razorpaySignature,
      });

      this.notify.success(
        this.translate.instant('profile.paymentSuccess', {
          plan: plan.name,
          days: session.subscription.daysLeft,
        }),
      );
      this.plansDialogOpen.set(false);
    } catch (error) {
      if (error instanceof RazorpayCancelled) {
        if (error.reason !== 'dismissed') {
          this.notify.warn(this.translate.instant(RAZORPAY_FAILURE_KEYS[error.reason]));
        }
      } else {
        this.notify.fromCommand(error, this.translate.instant('profile.paymentFailed'));
      }
    } finally {
      this.payingPlanId.set(null);
    }
  }
}
