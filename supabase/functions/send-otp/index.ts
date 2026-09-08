// Supabase Edge Function — send-otp
//
// Step one of registering: prove the email address exists and belongs to
// whoever is at the machine, before an account is made for it.
//
// The register form collects everything, then calls this with the address
// alone. Nothing is created here — the form's answers stay in the Angular
// window until `register` is called with the code. That is deliberate: a
// half-written account is worse than no account, and this endpoint is
// reachable by anyone who can reach the project.
//
// Three abuse controls, all of them here because none can live on the client:
//
//   1. One minute between sends to one address.
//   2. Five sends an hour to one address, so a stranger typing somebody's
//      address into the form cannot mail-bomb them.
//   3. A ten-minute code, replaced (not added to) on every send.
//
// Field validation is deliberately not done here — the register form is the
// one place that checks the shape of an email address. This function only
// needs an address to send to, so it checks that one was given and lets the
// mail provider reject a malformed one.
//
// Needs one secret of its own, shared with `register`:
//
//   supabase secrets set OTP_PEPPER=<a long random string>
//
// Self-contained, so it can be pasted straight into the dashboard editor.
// Remember to turn Verify JWT off — it is called before anybody is signed in.

import { createClient } from 'npm:@supabase/supabase-js@2';

// `*` because the callers are a Tauri window (origin `tauri://localhost`) and
// the dev server, which are not one fixed origin. Nothing here is authorised
// by a cookie, so a permissive origin does not let another site act as a user.
const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

type ErrorKind = 'notFound' | 'badRequest' | 'conflict' | 'forbidden' | 'internal';

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

// `{ error: { kind, message } }` matches the shape the Rust commands reject
// with, so `NotifyService.fromCommand` on the front end handles a Supabase
// refusal and a Tauri one the same way: `kind` decides whether the operator
// sees a warning they can act on or an error to report.
function fail(kind: ErrorKind, message: string): Response {
  return new Response(JSON.stringify({ error: { kind, message } }), {
    status: STATUS[kind],
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

/** The verified Resend domain. The mailbox does not have to exist to send. */
const SENDER = 'Waste Log <noreply@pictoria.shop>';

/** Shared with `register`, which recomputes this hash to check a code. */
const PEPPER = Deno.env.get('OTP_PEPPER') ?? '';

const COOLDOWN_MS = 60_000; // one minute between sends
const WINDOW_MS = 3_600_000; // the hour the send cap is counted over
const MAX_PER_HOUR = 5;
const CODE_TTL_MS = 10 * 60_000; // a code is good for ten minutes

interface SendOtpBody {
  email?: string;
}

/**
 * The stored form of a code.
 *
 * Salted with the address so the same four digits hash differently for two
 * people, and peppered with a secret the database does not hold so a dump of
 * `email_otps` cannot be walked against all 10,000 codes offline.
 */
async function hashCode(email: string, code: string): Promise<string> {
  const data = new TextEncoder().encode(`${email}:${code}:${PEPPER}`);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Four digits, from the platform CSPRNG rather than `Math.random`.
 *
 * `% 10_000` over a 32-bit draw is very slightly biased toward the low codes
 * (2^32 is not a multiple of 10,000). The bias is about one part in 430,000 —
 * far below what five guesses could ever exploit — and the attempt counter in
 * `register`, not the width of this number, is what actually stops guessing.
 */
function generateCode(): string {
  const draw = new Uint32Array(1);
  crypto.getRandomValues(draw);
  return (draw[0] % 10_000).toString().padStart(4, '0');
}

// ------------------------------------------------------------- the email --

/**
 * The navy scheme the app itself wears, in table markup because that is what
 * survives a mail client — the same shell as the welcome mail in `register`,
 * so the two read as one product.
 */
function codeEmail(code: string): string {
  return `<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;background:#eef1f6;font-family:Arial,Helvetica,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#eef1f6;padding:40px 0;">
    <tr><td align="center">
      <table width="580" cellpadding="0" cellspacing="0" style="background:#0b1524;border-radius:12px;overflow:hidden;">

        <tr>
          <td style="background:linear-gradient(135deg,#1e4e86,#0a1a2f);padding:36px 40px;text-align:center;">
            <h1 style="margin:0;color:#ffffff;font-size:30px;letter-spacing:6px;font-weight:bold;">WASTE LOG</h1>
            <p style="margin:10px 0 0;color:#a8c0e0;font-size:12px;letter-spacing:3px;text-transform:uppercase;">Email verification</p>
          </td>
        </tr>

        <tr>
          <td style="padding:40px;color:#e2e8f0;text-align:center;">
            <h2 style="margin:0 0 12px;color:#ffffff;font-size:22px;">Verify your email</h2>
            <p style="margin:0 0 28px;font-size:15px;line-height:1.7;color:#cbd5e1;">
              Enter this code in Waste Log to finish creating your account.
            </p>

            <table cellpadding="0" cellspacing="0" align="center" style="background:#10203a;border-radius:10px;margin-bottom:28px;">
              <tr>
                <td style="padding:18px 32px;">
                  <span style="font-size:38px;font-weight:bold;letter-spacing:14px;color:#ffffff;">${code}</span>
                </td>
              </tr>
            </table>

            <p style="margin:0;font-size:13px;line-height:1.6;color:#94a3b8;">
              This code expires in 10 minutes. If you did not ask for it,
              you can ignore this email &mdash; nothing has been created.
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
    const body = (await request.json()) as SendOtpBody;

    // Not form validation — the form checks the shape. There simply has to be
    // an address for the mail to go to.
    const email = String(body.email ?? '')
      .trim()
      .toLowerCase();
    if (!email) {
      return fail('badRequest', 'An email address is required.');
    }

    // The service role key bypasses row level security, which is why this is
    // the only kind of thing allowed to touch `email_otps`, and why this key
    // must never reach the app. `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`
    // are injected by the platform — there is nothing to set.
    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );

    // ------------------------------------------- is the address taken? ---
    //
    // Checked before anything is sent: there is no point proving an address
    // that cannot be registered, and the operator would rather be told now
    // than after typing a code in.
    const { data: existing, error: existingError } = await admin
      .from('users')
      .select('id')
      .eq('email', email)
      .maybeSingle();

    if (existingError) {
      console.error(existingError);
      return fail('internal', 'Could not check that address. Please try again.');
    }

    if (existing) {
      return fail('conflict', 'An account already exists for that email address.');
    }

    // --------------------------------------------------- rate limiting ---

    const now = Date.now();
    const { data: previous, error: previousError } = await admin
      .from('email_otps')
      .select('*')
      .eq('email', email)
      .maybeSingle();

    if (previousError) {
      console.error(previousError);
      return fail('internal', 'Could not send a code. Please try again.');
    }

    if (previous) {
      const sinceLast = now - new Date(previous.last_sent_at).getTime();
      if (sinceLast < COOLDOWN_MS) {
        const wait = Math.ceil((COOLDOWN_MS - sinceLast) / 1000);
        return fail('conflict', `Please wait ${wait} seconds before asking for another code.`);
      }
    }

    // A window that has run out starts again at one; one still running counts
    // up, and refuses past the cap.
    let sendCount = 1;
    let windowStart = new Date(now).toISOString();

    if (previous && now - new Date(previous.window_start).getTime() < WINDOW_MS) {
      if (previous.send_count >= MAX_PER_HOUR) {
        return fail(
          'conflict',
          'Too many codes have been sent to that address. Please try again in an hour.',
        );
      }
      sendCount = previous.send_count + 1;
      windowStart = previous.window_start;
    }

    // ---------------------------------------------------- the new code ---
    //
    // Written before it is sent. The other order would leave a code in
    // somebody's inbox that this project has no record of, and the operator
    // typing it in would be told it was wrong.
    const code = generateCode();

    const { error: storeError } = await admin.from('email_otps').upsert({
      email,
      code_hash: await hashCode(email, code),
      expires_at: new Date(now + CODE_TTL_MS).toISOString(),
      attempts: 0,
      last_sent_at: new Date(now).toISOString(),
      send_count: sendCount,
      window_start: windowStart,
    });

    if (storeError) {
      console.error(storeError);
      return fail('internal', 'Could not send a code. Please try again.');
    }

    // ------------------------------------------------------- the email ---

    const mail = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${Deno.env.get('RESEND_API_KEY')}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: SENDER,
        to: [email],
        subject: `${code} is your Waste Log verification code`,
        html: codeEmail(code),
      }),
    });

    // `fetch` only rejects on a network fault, so a refused key, an unverified
    // sender or an address the provider will not accept would otherwise pass
    // silently and leave the operator waiting for a mail that never comes.
    if (!mail.ok) {
      console.error('[send-otp] resend refused:', await mail.text());
      return fail('internal', 'Could not send the code. Please check the address and try again.');
    }

    // The cooldown goes back so the screen can disable its resend button for
    // exactly as long as this function will refuse one.
    return ok({ retryAfterSeconds: COOLDOWN_MS / 1000 });
  } catch (error) {
    // An unexpected throw must not leak a stack trace or a connection string.
    console.error(error);
    return fail('internal', 'Something went wrong on our side. Please try again.');
  }
});
