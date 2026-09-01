// Supabase Edge Function — register
//
// Opening an account, claiming this PC for it, and welcoming the operator.
//
// Two things have to be true before an account can exist, and both are checked
// here because neither can be checked anywhere else:
//
//   1. This PC is not already registered. One machine carries one account —
//      that is the licence. The front end cannot check it: it would have to
//      read every other user's `device_id` to do so.
//   2. The email address is free. Supabase reports that one for us.
//
// The write order is forced by the schema. `public.users.id` is a foreign key
// onto `auth.users.id`, so there is no profile row to write until the auth user
// exists and has an id. That makes the insert the step that can leave a mess —
// an auth user with no profile is an account that can sign in, find nothing
// about itself, and hold an email address that can never be registered again.
// So a failed insert deletes the auth user again before returning.
//
// Field validation is deliberately not done here. The register form is the one
// place that checks a phone number or a password, so this function stores the
// body as it is given.
//
// Self-contained, so it can be pasted straight into the dashboard editor.
// Remember to turn Verify JWT off — it is called before anybody is signed in.

import { createClient } from 'npm:@supabase/supabase-js@2';

// `*` because the callers are a Tauri window (origin `tauri://localhost`) and
// the dev server, which are not one fixed origin. Nothing here is authorised by
// a cookie, so a permissive origin does not let another site act as the user.
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

/** A new account gets a fortnight to try the register before it needs paying for. */
const TRIAL_DAYS = 14;

/** The verified Resend domain. The mailbox does not have to exist to send. */
const SENDER = 'Waste Log <noreply@pictoria.shop>';
const SUPPORT_EMAIL = 'aatmanbhoraniya12@gmail.com';
const SUPPORT_PHONE = '9428291222';

const PROFILE_COLUMNS =
  'id, first_name, last_name, phone, email, company_name, device_id, ' +
  'status, subscription_status, subscriptions_end_date, created_date';

interface RegisterBody {
  firstName?: string;
  lastName?: string;
  phone?: string;
  email?: string;
  password?: string;
  companyName?: string;
  deviceId?: string;
}

// ------------------------------------------------------------ welcome mail --

/**
 * Escapes text that goes into the template below.
 *
 * A first name and a company name are typed by whoever is registering, and they
 * land inside an HTML document. Without this, a name containing `<` would break
 * the layout at best, and at worst carry markup into somebody's inbox.
 */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * The navy scheme the app itself wears, in table markup because that is what
 * survives a mail client. The dark card on a pale page is the register's own
 * dark theme, so the mail and the application look like the same product.
 */
function welcomeEmail(firstName: string, email: string, trialEnds: string): string {
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
            <p style="margin:10px 0 0;color:#a8c0e0;font-size:12px;letter-spacing:3px;text-transform:uppercase;">Sanitaryware</p>
          </td>
        </tr>

        <tr>
          <td style="padding:40px;color:#e2e8f0;">
            <h2 style="margin:0 0 16px;color:#ffffff;font-size:22px;">Welcome, ${name}!</h2>
            <p style="margin:0 0 24px;font-size:15px;line-height:1.7;color:#cbd5e1;">
              Your Waste Log account is ready. Sign in and start logging waste against
              workers, reasons and grades &mdash; by tap or by barcode &mdash; then pull
              a month's sheet or a PDF report whenever you need one.
            </p>

            <table width="100%" cellpadding="0" cellspacing="0" style="background:#10203a;border-radius:8px;margin-bottom:28px;">
              <tr>
                <td style="padding:20px 24px;">
                  <p style="margin:0 0 6px;font-size:12px;text-transform:uppercase;letter-spacing:1px;color:#7098cb;font-weight:bold;">Your Trial</p>
                  <p style="margin:0;font-size:20px;font-weight:bold;color:#ffffff;">${TRIAL_DAYS} Days &mdash; Free</p>
                  <p style="margin:4px 0 0;font-size:13px;color:#94a3b8;">Active until ${trialEnds}</p>
                </td>
              </tr>
            </table>

            <p style="margin:0 0 8px;font-size:14px;color:#94a3b8;">
              <strong style="color:#e2e8f0;">Login email:</strong> ${escapeHtml(email)}
            </p>
            <p style="margin:0 0 28px;font-size:14px;color:#94a3b8;">
              Use the password you set during registration.
            </p>

            <table width="100%" cellpadding="0" cellspacing="0" style="border-left:3px solid #3f6fa8;background:#10203a;border-radius:6px;margin-bottom:28px;">
              <tr>
                <td style="padding:16px 20px;">
                  <p style="margin:0 0 6px;font-size:12px;text-transform:uppercase;letter-spacing:1px;color:#7098cb;font-weight:bold;">Device-locked account</p>
                  <p style="margin:0;font-size:13px;line-height:1.6;color:#94a3b8;">
                    Your licence is bound to the PC you registered on. Waste Log will not
                    work on any other machine unless you request a device reset.
                  </p>
                </td>
              </tr>
            </table>

            <p style="margin:0;font-size:14px;line-height:1.7;color:#94a3b8;">
              Questions? Contact ${SUPPORT_EMAIL}, phone ${SUPPORT_PHONE} &mdash;
              we're happy to help.
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

/**
 * Sends the welcome mail, and never throws.
 *
 * The account exists by the time this runs. Failing the request because a mail
 * did not go out would tell the operator that registration failed when it did
 * not, and they would try again and be told the address is taken. A failure is
 * logged and swallowed.
 */
async function sendWelcome(to: string, firstName: string, trialEnds: string): Promise<void> {
  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${Deno.env.get('RESEND_API_KEY')}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: SENDER,
        to: [to],
        subject: `Welcome to Waste Log — your ${TRIAL_DAYS}-day trial has started, ${firstName}!`,
        html: welcomeEmail(firstName, to, trialEnds),
      }),
    });

    // `fetch` only rejects on a network fault, so a refused key or an
    // unverified sender would otherwise pass silently.
    if (!response.ok) {
      console.error('[register] welcome email refused:', response.status, await response.text());
    }
  } catch (error) {
    console.error('[register] welcome email failed:', error);
  }
}

// ---------------------------------------------------------------- handler --

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }
  if (request.method !== 'POST') {
    return fail('badRequest', 'Use POST.');
  }

  try {
    const body = (await request.json()) as RegisterBody;

    // Not form validation — the device id never passes through the form. It is
    // read off the machine by Rust, and everything below depends on having one:
    // without it the check underneath would compare against nothing and the
    // account would be written unbound to any PC.
    const deviceId = String(body.deviceId ?? '').trim();
    if (!deviceId) {
      return fail('badRequest', 'This machine could not be identified.');
    }

    // Lowercased against the unique constraint on `users.email`, so the same
    // address typed two ways cannot become two accounts.
    const email = String(body.email ?? '')
      .trim()
      .toLowerCase();

    // The service role key bypasses row level security, which is why this is
    // the only kind of thing allowed to write a profile row, and why this key
    // must never reach the app. `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`
    // are injected by the platform — there is nothing to set.
    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );

    // ------------------------------------------------- is this PC taken? ---
    //
    // Checked before the auth user is created, so a refusal leaves nothing
    // behind to clean up. The account it belongs to is deliberately not named:
    // that would turn a public endpoint into a way of asking which address is
    // registered on a machine.
    const { data: onThisMachine, error: deviceError } = await admin
      .from('users')
      .select('id')
      .eq('device_id', deviceId)
      .maybeSingle();

    if (deviceError) {
      console.error(deviceError);
      return fail('internal', 'Could not check this machine. Please try again.');
    }

    if (onThisMachine) {
      return fail(
        'conflict',
        'This PC is already registered to an account. Sign in with it, or ' +
          'contact support to move the licence to a different machine.',
      );
    }

    // ------------------------------------------------------ the account ---

    // `email_confirm: true` because this is a licensed desktop tool, not a
    // public web sign-up: the operator registers at the machine and has to be
    // able to use it straight away. This is also the line that comes out when
    // the email OTP goes in — the address will already have been proved by
    // then.
    const { data: created, error: authError } = await admin.auth.admin.createUser({
      email,
      password: String(body.password ?? ''),
      email_confirm: true,
    });

    if (authError || !created?.user) {
      // Supabase reports an address that is already taken here rather than on
      // the insert below, and it is the one failure the operator can act on.
      if (/already (been )?registered|already exists/i.test(authError?.message ?? '')) {
        return fail('conflict', 'An account already exists for that email address.');
      }
      console.error(authError);
      return fail('internal', 'Could not create the account.');
    }

    const userId = created.user.id;
    const endsOn = new Date();
    endsOn.setDate(endsOn.getDate() + TRIAL_DAYS);

    const { data: profile, error: profileError } = await admin
      .from('users')
      .insert({
        id: userId,
        first_name: body.firstName,
        last_name: body.lastName,
        phone: body.phone,
        email,
        company_name: body.companyName,
        device_id: deviceId,
        status: 'active',
        // The trial is recorded on the user, not as a `subscriptions` row:
        // nothing was ordered, nothing was paid, and there is no plan to point
        // `plan_id` at. The first `subscriptions` row appears when Razorpay
        // takes money.
        subscription_status: 'trial',
        subscriptions_end_date: endsOn.toISOString(),
      })
      .select(PROFILE_COLUMNS)
      .single();

    if (profileError || !profile) {
      // Roll the auth user back, or the address is held by an account that
      // does not work and cannot be registered again.
      await admin.auth.admin.deleteUser(userId);
      console.error(profileError);
      return fail('internal', 'Could not create the account.');
    }

    // Last, and non-fatal: the account is already real by this point.
    await sendWelcome(
      email,
      String(body.firstName ?? '').trim(),
      endsOn.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' }),
    );

    return ok({ profile });
  } catch (error) {
    // An unexpected throw must not leak a stack trace or a connection string.
    console.error(error);
    return fail('internal', 'Something went wrong on our side. Please try again.');
  }
});
