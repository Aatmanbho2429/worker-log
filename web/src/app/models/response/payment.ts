import { PaymentStatus } from '../auth';

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
