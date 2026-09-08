/**
 * One row of `public.plans`, as `get-plans` returns it — the renewal
 * catalogue shown on the profile once a subscription has expired or is
 * about to.
 */
export interface Plan {
  id: string;
  name: string;
  /** Days the term runs for — 30 / 90 / 180 / 365 for the four seeded rows. */
  duration: number;
  amount: number;
  /** ISO 4217. Defaults to INR in the schema. */
  currency: string;
}
