/**
 * The account, its licence and its payment history.
 *
 * A licence is bound to one PC: the register is a shop-floor tool and a single
 * seat is a single machine. The device fingerprint is taken by the Rust side at
 * registration and checked again at every sign-in, so handing the email and
 * password to a colleague does not hand over the app with them.
 */

/** `public.users.status`. Anything but `active` is refused at sign-in. */
export type AccountStatus = 'active' | 'inactive' | 'blocked';

export interface UserAccount {
  /** The `auth.users` uuid — `public.users.id` is a foreign key onto it. */
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  companyName: string;
  /** Fingerprint of the PC this licence is claimed by, null until claimed. */
  deviceId: string | null;
  status: AccountStatus;
  createdDate: string;
}

/**
 * The four values `public.users.subscription_status` is allowed to hold, plus
 * `expiring`, which is not one of them: it is `active` with a fortnight or less
 * to run, worked out from the end date when the profile is drawn.
 */
export type SubscriptionStatus = 'trial' | 'active' | 'inactive' | 'expired' | 'expiring';

export interface Subscription {
  plan: string;
  status: SubscriptionStatus;
  /** ISO date the current term began. */
  startedOn: string;
  /** ISO date the current term runs out. */
  renewsOn: string;
  /** Whole days left, floored at zero once the term has run out. */
  daysLeft: number;
  /** Days in the current term, so the profile can draw how much is spent. */
  termDays: number;
}

/** Mirrors `public.subscriptions.status`. */
export type PaymentStatus = 'created' | 'pending' | 'active' | 'failed' | 'cancelled' | 'expired';

/**
 * One row of `public.subscriptions`, which is the payment history — every row
 * is a purchase with a Razorpay reference, an amount and the term it bought.
 * There is no separate payments table, and there should not be one: it would
 * duplicate all of this and start disagreeing with it.
 */
export interface Payment {
  /** Row number for the table, not the uuid — that is not worth showing. */
  id: number;
  /** The Razorpay payment id, falling back to the order id before one exists. */
  reference: string;
  paidOn: string;
  plan: string;
  periodFrom: string;
  periodTo: string;
  amount: number;
  /** ISO 4217, from the row. Defaults to INR in the schema. */
  currency: string;
  method: string;
  status: PaymentStatus;
}

/**
 * The statuses that mean money actually changed hands. `created`, `pending` and
 * `failed` never got as far as a payment, and `cancelled` may have been called
 * off before one — so the profile's running total counts neither.
 */
export const SETTLED_PAYMENT_STATUSES: readonly PaymentStatus[] = ['active', 'expired'];

/** What a successful register or sign-in hands back. */
export interface Session {
  user: UserAccount;
  subscription: Subscription;
}

// The request shapes that used to live here are in `auth.requests.ts`, with
// the rest of what crosses the Tauri bridge.

/**
 * The result of a forgotten-password request.
 *
 * The password itself is deliberately not in here. It is set and mailed by the
 * `forgot-password` edge function, which takes an email address and no proof of
 * anything — returning what it set would let anyone take over any account by
 * asking for it.
 */
export interface PasswordReset {
  sentTo: string;
}

// ------------------------------------------------------------ validation ---
//
// Every one of these returns a **translation key**, or null when the value is
// good. Returning a key rather than a sentence is what keeps the copy in
// `assets/i18n/en.json`: the rule lives here, the wording lives there, and the
// template translates whatever it is handed.

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i;

/** Ten digits starting 6-9 — the whole of the Indian mobile range. */
const INDIAN_MOBILE_PATTERN = /^[6-9]\d{9}$/;

/**
 * Strips everything a person might type around the number — `+91`, a leading
 * `0`, spaces, dashes, brackets — and returns the bare ten digits.
 *
 * Returns whatever digits were found when they do not add up to a number, so
 * the caller can show the input back in the error.
 */
export function normalizePhone(raw: string): string {
  const digits = raw.replace(/\D/g, '');

  if (digits.length === 12 && digits.startsWith('91')) {
    return digits.slice(2);
  }
  if (digits.length === 11 && digits.startsWith('0')) {
    return digits.slice(1);
  }
  return digits;
}

/** `98765 43210`, which is how the number is read aloud on the floor. */
export function formatPhone(phone: string): string {
  const digits = normalizePhone(phone);
  return digits.length === 10 ? `${digits.slice(0, 5)} ${digits.slice(5)}` : phone;
}

/** Which of the two name fields is being checked. */
export type NameField = 'firstName' | 'lastName';

export function nameProblem(value: string, field: NameField): string | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return `validation.${field}Required`;
  }
  if (trimmed.length < 2) {
    return `validation.${field}TooShort`;
  }
  return null;
}

export function emailProblem(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return 'validation.emailRequired';
  }
  if (!EMAIL_PATTERN.test(trimmed)) {
    return 'validation.emailInvalid';
  }
  return null;
}

export function phoneProblem(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return 'validation.phoneRequired';
  }

  const digits = normalizePhone(trimmed);
  if (digits.length !== 10) {
    return 'validation.phoneLength';
  }
  if (!INDIAN_MOBILE_PATTERN.test(digits)) {
    return 'validation.phonePrefix';
  }
  return null;
}

export function companyProblem(value: string): string | null {
  return value.trim() ? null : 'validation.companyRequired';
}

export function passwordProblem(value: string): string | null {
  if (!value) {
    return 'validation.passwordRequired';
  }
  if (value.length < 8) {
    return 'validation.passwordLength';
  }
  if (!/[A-Za-z]/.test(value) || !/\d/.test(value)) {
    return 'validation.passwordVariety';
  }
  return null;
}

export function confirmProblem(password: string, confirmation: string): string | null {
  if (!confirmation) {
    return 'validation.confirmRequired';
  }
  return password === confirmation ? null : 'validation.confirmMismatch';
}

/**
 * A 0-4 score for the meter under the password field. Length carries most of
 * it, because it is the part that actually makes a password hard to guess.
 */
export function passwordScore(value: string): number {
  if (!value) {
    return 0;
  }

  let score = 0;
  if (value.length >= 8) score++;
  if (value.length >= 12) score++;
  if (/[A-Za-z]/.test(value) && /\d/.test(value)) score++;
  if (/[^A-Za-z0-9]/.test(value)) score++;

  return Math.min(score, 4);
}

/** The key for the word printed under the meter. Empty at a score of zero. */
export function passwordScoreKey(score: number): string {
  return ['', 'passwordStrength.weak', 'passwordStrength.fair', 'passwordStrength.good', 'passwordStrength.strong'][
    score
  ];
}

// --------------------------------------------------------------- display ---

export function accountFullName(user: UserAccount): string {
  return `${user.firstName} ${user.lastName}`.trim();
}

export function accountInitials(user: UserAccount): string {
  return `${user.firstName.charAt(0)}${user.lastName.charAt(0)}`.toUpperCase();
}

/**
 * The device fingerprint is a long opaque string. Only its ends are worth
 * showing — enough to tell two machines apart when support asks.
 */
export function shortDeviceId(deviceId: string): string {
  return deviceId.length > 16 ? `${deviceId.slice(0, 8)}…${deviceId.slice(-4)}` : deviceId;
}

export function subscriptionSeverity(
  status: SubscriptionStatus,
): 'success' | 'info' | 'warn' | 'danger' {
  switch (status) {
    case 'active':
      return 'success';
    case 'trial':
      return 'info';
    case 'expiring':
      return 'warn';
    case 'inactive':
    case 'expired':
      return 'danger';
  }
}

/** The translation key for the status tag on the profile. */
export function subscriptionLabel(status: SubscriptionStatus): string {
  return `subscriptionStatus.${status}`;
}

export function paymentSeverity(
  status: PaymentStatus,
): 'success' | 'info' | 'warn' | 'danger' | 'secondary' {
  switch (status) {
    case 'active':
      return 'success';
    case 'created':
    case 'pending':
      return 'warn';
    case 'failed':
      return 'danger';
    case 'cancelled':
    case 'expired':
      return 'secondary';
  }
}
