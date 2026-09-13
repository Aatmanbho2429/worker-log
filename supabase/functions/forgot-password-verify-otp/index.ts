// Supabase Edge Function — forgot-password-verify-otp
//
// Step two of resetting a forgotten password: check the code
// `forgot-password-send-otp` mailed, re-run the same account/device checks
// (ten minutes is long enough for an account to be blocked or its licence
// moved in between), then roll a new password, mail it, and only then set it.
//
// Ported from a Visara reference with the same deltas as
// `forgot-password-send-otp` — see that file's header and
// `.claude/skills/supabase/registration.md`. Two more here specifically:
// mailing the new password *before* setting it (the reference sets first, so
// a mail failure locks the operator out of an account that worked a moment
// earlier), and an unbiased password generator that guarantees a letter and
// a digit, so it can never fail this app's own password rule.
//
// Self-contained so it can be pasted straight into the dashboard editor.

import { createClient } from 'npm:@supabase/supabase-js@2';

// ------------------------------------------------------------------ http --

type ErrorKind = 'notFound' | 'badRequest' | 'conflict' | 'forbidden' | 'internal';

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const STATUS: Record<ErrorKind, number> = {
  badRequest: 400,
  forbidden: 403,
  notFound: 404,
  conflict: 409,
  internal: 500,
};

function ok(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

function fail(kind: ErrorKind, message: string): Response {
  return new Response(JSON.stringify({ error: { kind, message } }), {
    status: STATUS[kind],
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

// ---------------------------------------------------------------- handler --

/** The verified Resend domain. The mailbox does not have to exist to send. */
const SENDER = 'Waste Log <noreply@pictoria.shop>';
const SUPPORT_EMAIL = 'aatmanbhoraniya12@gmail.com';
const SUPPORT_PHONE = '9428291222';

/** Must match `forgot-password-send-otp`, which hashed the code this recomputes. */
const PEPPER = Deno.env.get('OTP_PEPPER') ?? '';

/**
 * Wrong guesses allowed against one code before it is destroyed.
 *
 * This, not the length of the code, is what makes four digits safe — the same
 * reasoning as `register`'s `MAX_ATTEMPTS`, and a guessed reset code gains an
 * attacker nothing besides an unwanted reset: the new password is mailed to
 * the account's own inbox, never returned here.
 */
const MAX_ATTEMPTS = 5;

/** No 0/O or 1/l, because this gets read off a screen and typed in again. No
 * symbols, because it is also read off an email and typed in by hand. */
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
const LENGTH = 12;
const DIGITS = /[0-9]/;
const LETTERS = /[A-Za-z]/;

interface VerifyOtpBody {
  email?: string;
  deviceId?: string;
  otpCode?: string;
}

interface AccountRow {
  id: string;
  status: 'active' | 'inactive' | 'blocked';
  device_id: string | null;
  first_name: string;
  email: string;
}

interface OtpRow {
  code_hash: string;
  expires_at: string;
  attempts: number;
}

/** Must match `forgot-password-send-otp` exactly, or every code looks wrong. */
async function hashCode(email: string, code: string): Promise<string> {
  const data = new TextEncoder().encode(`${email}:${code}:${PEPPER}`);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * One character from `ALPHABET`, drawn without the small bias a plain
 * `byte % ALPHABET.length` would carry (256 is not a multiple of the
 * alphabet's length). Draws are discarded and retried past the largest
 * multiple of the alphabet's length that fits in a byte, rather than
 * accepted with a skewed distribution.
 */
function randomChar(): string {
  const ceiling = 256 - (256 % ALPHABET.length);
  const draw = new Uint8Array(1);
  let byte: number;
  do {
    crypto.getRandomValues(draw);
    byte = draw[0];
  } while (byte >= ceiling);
  return ALPHABET[byte % ALPHABET.length];
}

/**
 * A random password the app can always accept.
 *
 * `passwordProblem()` on the Angular side requires at least one letter and
 * one digit — a password this function mails has to clear that rule too, or
 * the operator would be handed a password the sign-in screen's own change-
 * password dialog would later refuse to save unchanged. All-letters or
 * all-digits happens rarely against a 61-character alphabet, so the retry
 * loop almost always runs once.
 */
function rollPassword(): string {
  let password: string;
  do {
    password = Array.from({ length: LENGTH }, randomChar).join('');
  } while (!LETTERS.test(password) || !DIGITS.test(password));
  return password;
}

/**
 * Escapes text that goes into the templates below. See
 * `forgot-password-send-otp`'s copy of this for why.
 */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ------------------------------------------------------------- the email --

function newPasswordEmail(firstName: string, password: string): string {
  const name = escapeHtml(firstName);

  return `<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;background:#eef1f6;font-family:Arial,Helvetica,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#eef1f6;padding:40px 0;">
    <tr><td align="center">
      <table width="580" cellpadding="0" cellspacing="0" style="background:#0b1524;border-radius:12px;overflow:hidden;">

        <tr>
          <td style="background:linear-gradient(135deg,#1e4e86,#0a1a2f);padding:36px 40px;text-align:center;">
            <h1 style="margin:0;color:#ffffff;font-size:30px;letter-spacing:6px;font-weight:bold;">WASTE LOG</h1>
            <p style="margin:10px 0 0;color:#a8c0e0;font-size:12px;letter-spacing:3px;text-transform:uppercase;">Password reset</p>
          </td>
        </tr>

        <tr>
          <td style="padding:40px;color:#e2e8f0;">
            <h2 style="margin:0 0 16px;color:#ffffff;font-size:22px;">Your password has been reset</h2>
            <p style="margin:0 0 24px;font-size:15px;line-height:1.7;color:#cbd5e1;">
              Hi ${name}, here is your new password:
            </p>

            <table width="100%" cellpadding="0" cellspacing="0" style="background:#10203a;border-radius:8px;margin-bottom:28px;">
              <tr>
                <td style="padding:20px 24px;text-align:center;">
                  <p style="margin:0;font-size:22px;font-weight:bold;letter-spacing:2px;color:#ffffff;font-family:monospace;">${escapeHtml(password)}</p>
                </td>
              </tr>
            </table>

            <p style="margin:0 0 8px;font-size:14px;line-height:1.7;color:#94a3b8;">
              Sign in with it, then change it from your profile.
            </p>
            <p style="margin:0;font-size:14px;line-height:1.7;color:#94a3b8;">
              If you did not ask for this, contact ${SUPPORT_EMAIL}, phone
              ${SUPPORT_PHONE}, straight away.
            </p>
          </td>
        </tr>

        <tr>
          <td style="padding:24px 40px;border-top:1px solid #14243c;text-align:center;">
            <p style="margin:0;font-size:12px;color:#5b6d84;">&copy; ${new Date().getFullYear()} Waste Log. All rights reserved.</p>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

// ----------------------------------------------------------------- handler --

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }
  if (request.method !== 'POST') {
    return fail('badRequest', 'Use POST.');
  }

  try {
    const body = (await request.json()) as VerifyOtpBody;

    const email = String(body.email ?? '').trim().toLowerCase();
    const deviceId = String(body.deviceId ?? '').trim();
    const otpCode = String(body.otpCode ?? '').trim();

    if (!email) {
      return fail('badRequest', 'An email address is required.');
    }
    if (!deviceId) {
      return fail('badRequest', 'This machine could not be identified.');
    }
    if (!otpCode) {
      return fail('badRequest', 'Enter the code sent to your email address.');
    }

    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );

    // ------------------------------------------------------ is the code right? ---
    const { data: otpData, error: otpError } = await admin
      .from('password_reset_otps')
      .select('*')
      .eq('email', email)
      .maybeSingle();

    if (otpError) {
      console.error(otpError);
      return fail('internal', 'Could not check that code. Please try again.');
    }

    const pending = otpData as unknown as OtpRow | null;

    if (!pending) {
      return fail('badRequest', 'No code has been sent to that address. Ask for a new one.');
    }

    // Each dead end deletes the row rather than leaving it to be retried: an
    // expired or exhausted code has to be replaced by a fresh send, and
    // `forgot-password-send-otp` is what rate-limits those.
    if (new Date(pending.expires_at).getTime() < Date.now()) {
      await admin.from('password_reset_otps').delete().eq('email', email);
      return fail('badRequest', 'That code has expired. Ask for a new one.');
    }

    if (pending.attempts >= MAX_ATTEMPTS) {
      await admin.from('password_reset_otps').delete().eq('email', email);
      return fail('badRequest', 'Too many incorrect codes. Ask for a new one.');
    }

    if ((await hashCode(email, otpCode)) !== pending.code_hash) {
      // Counted, or five guesses would become unlimited ones.
      await admin
        .from('password_reset_otps')
        .update({ attempts: pending.attempts + 1 })
        .eq('email', email);
      return fail('badRequest', 'That code is not right. Check it and try again.');
    }

    // ------------------------------------- re-check the account and device ---
    //
    // Ten minutes have passed since `forgot-password-send-otp` checked this;
    // an account can be blocked, or a licence moved, in that time.
    const { data: accountData, error: accountError } = await admin
      .from('users')
      .select('id, status, device_id, first_name, email')
      .eq('email', email)
      .maybeSingle();

    if (accountError) {
      console.error(accountError);
      return fail('internal', 'Could not check that address. Please try again.');
    }

    const account = accountData as unknown as AccountRow | null;

    if (!account) {
      return fail('notFound', 'No account is registered with that email address.');
    }
    if (account.status === 'blocked') {
      return fail('forbidden', 'This account has been blocked. Please contact support.');
    }
    if (account.status !== 'active') {
      return fail('forbidden', 'This account is not active. Please contact support.');
    }
    if (account.device_id && account.device_id !== deviceId) {
      return fail(
        'conflict',
        'This account is licensed to a different PC. Reset the password from ' +
          'the PC it was registered on, or contact support to move the licence.',
      );
    }

    // ------------------------------------------------- mail before setting ---
    //
    // A password that is set but never delivered locks the operator out of an
    // account that was working a moment ago. Sending first means a mail
    // failure changes nothing — the old password still works and the same
    // code can be retried.
    const password = rollPassword();

    const mail = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${Deno.env.get('RESEND_API_KEY')}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: SENDER,
        to: [account.email],
        subject: 'Your new Waste Log password',
        html: newPasswordEmail(account.first_name, password),
      }),
    });

    if (!mail.ok) {
      console.error('[forgot-password-verify-otp] resend refused:', await mail.text());
      return fail(
        'internal',
        'Could not send the new password. Your current password still works — please try again.',
      );
    }

    const { error: updateError } = await admin.auth.admin.updateUserById(account.id, { password });

    if (updateError) {
      // The mail already went out with a password that was never set — kept
      // deliberately vague to the operator (the mailed password is simply
      // dead), and the code row is kept so a retry of the same code mails a
      // different password rather than needing a fresh send.
      console.error('[forgot-password-verify-otp] could not set the password:', updateError);
      return fail(
        'internal',
        'The new password could not be set. Your current password still works — please try again.',
      );
    }

    // The code has done its job — deleted only now, after the password is
    // actually set, so a failure above leaves it in place for a retry.
    await admin.from('password_reset_otps').delete().eq('email', email);

    return ok({ sentTo: account.email });
  } catch (error) {
    console.error(error);
    return fail('internal', 'Something went wrong on our side. Please try again.');
  }
});
