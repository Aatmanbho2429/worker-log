import { SubscriptionStatus } from '../auth';

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
