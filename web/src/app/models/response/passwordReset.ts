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
