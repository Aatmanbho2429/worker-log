// Supabase Edge Function — change-password
//
// The profile's "Reset password" dialog: proves the current password, sets
// the new one, revokes every session for the account, and mails a
// confirmation. The revoke is why this has to be a function at all — GoTrue
// alone would change the password on the strength of the session holding it,
// and nothing client-side can force every other session (or a stolen token
// used outside the app) to stop working.
//
// Ported from a Visara reference, with the caller identified by `accessToken`
// in the body rather than an `Authorization` header (see `create-order`'s
// header for why), the account/device checks `validate-token` already does
// added back in (the reference has none), no server-side password rules
// (validation lives in the Angular form only — see
// `.claude/skills/supabase/registration.md`), and the Waste Log sender and
// template in place of Visara's.
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

interface ChangePasswordBody {
  accessToken?: string;
  deviceId?: string;
  currentPassword?: string;
  newPassword?: string;
}

interface AccountRow {
  id: string;
  first_name: string;
  status: 'active' | 'inactive' | 'blocked';
  device_id: string | null;
}

/**
 * Escapes text that goes into the template below.
 *
 * A first name is typed on the register form and lands inside an HTML
 * document here. Without this, a name containing `<` would break the layout
 * at best, and at worst carry markup into somebody's inbox.
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
 * survives a mail client — matches `register/index.ts`'s `welcomeEmail`, so
 * every account mail this app sends looks like the same product.
 */
function passwordChangedEmail(firstName: string): string {
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
            <h2 style="margin:0 0 16px;color:#ffffff;font-size:22px;">Your password was changed</h2>
            <p style="margin:0 0 24px;font-size:15px;line-height:1.7;color:#cbd5e1;">
              Hi ${name}, this confirms that the password on your Waste Log
              account was just changed. You have been signed out everywhere,
              so you will need to sign in again with the new password.
            </p>

            <table width="100%" cellpadding="0" cellspacing="0" style="background:#10203a;border-radius:8px;margin-bottom:28px;">
              <tr>
                <td style="padding:20px 24px;text-align:center;">
                  <p style="margin:0;font-size:12px;text-transform:uppercase;letter-spacing:1px;color:#7098cb;font-weight:bold;">Changed on</p>
                  <p style="margin:6px 0 0;font-size:16px;font-weight:bold;color:#ffffff;">${new Date().toUTCString()}</p>
                </td>
              </tr>
            </table>

            <p style="margin:0;font-size:14px;line-height:1.7;color:#94a3b8;">
              If you did not make this change, contact ${SUPPORT_EMAIL},
              phone ${SUPPORT_PHONE}, immediately — your account may be at risk.
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
 * Sends the confirmation mail, and never throws.
 *
 * The password has already been changed and every session already revoked by
 * the time this runs — failing the request over a mail that did not go out
 * would read as the change itself having failed, when it did not. A failure
 * is logged and swallowed, the same shape as `register`'s `sendWelcome`.
 */
async function sendConfirmation(to: string, firstName: string): Promise<void> {
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
        subject: 'Your Waste Log password was changed',
        html: passwordChangedEmail(firstName),
      }),
    });

    if (!response.ok) {
      console.error('[change-password] confirmation email refused:', response.status, await response.text());
    }
  } catch (error) {
    console.error('[change-password] confirmation email failed:', error);
  }
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }
  if (request.method !== 'POST') {
    return fail('badRequest', 'Use POST.');
  }

  try {
    const body = (await request.json()) as ChangePasswordBody;
    const accessToken = String(body.accessToken ?? '').trim();
    const deviceId = String(body.deviceId ?? '').trim();
    // Not trimmed: whitespace can legitimately be part of a password, and
    // trimming it here would silently accept a different password than the
    // one the operator typed.
    const currentPassword = body.currentPassword ?? '';
    const newPassword = body.newPassword ?? '';

    if (!accessToken || !deviceId || !currentPassword || !newPassword) {
      return fail('badRequest', 'Missing required fields.');
    }

    const url = Deno.env.get('SUPABASE_URL')!;

    // ── 1. Who is calling ──────────────────────────────────────────────
    const anon = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { data: userData, error: userError } = await anon.auth.getUser(accessToken);

    if (userError || !userData?.user) {
      return fail('notFound', 'Your session has expired. Please sign in again.');
    }

    const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // ── 2. The same account/device checks validate-token already makes ──
    // A stolen token used outside the app has to fail here, not just at the
    // desktop client that would normally have refused it first.
    const { data, error: profileError } = await admin
      .from('users')
      .select('id, first_name, status, device_id')
      .eq('id', userData.user.id)
      .single();

    const profile = data as unknown as AccountRow | null;

    if (profileError || !profile) {
      return fail('notFound', 'That account has no profile. Please contact support.');
    }

    if (profile.status === 'blocked') {
      return fail('forbidden', 'This account has been blocked. Please contact support.');
    }
    if (profile.status !== 'active') {
      return fail('forbidden', 'This account is not active. Please contact support.');
    }

    if (!profile.device_id || profile.device_id !== deviceId) {
      return fail(
        'conflict',
        'This account is licensed to a different PC. Sign in on the machine it ' +
          'was registered on, or contact support to move the licence.',
      );
    }

    // ── 3. Prove the current password ───────────────────────────────────
    // A throwaway anon client, never persisted — this exists only to find out
    // whether `currentPassword` is right, the same way `login` proves a
    // password with the anon key rather than the service role one.
    const { error: signInError } = await anon.auth.signInWithPassword({
      email: userData.user.email!,
      password: currentPassword,
    });

    if (signInError) {
      return fail('badRequest', 'The current password is not right.');
    }

    // ── 4. Set the new password ──────────────────────────────────────────
    const { error: updateError } = await admin.auth.admin.updateUserById(userData.user.id, {
      password: newPassword,
    });

    if (updateError) {
      console.error('[change-password] could not update the password:', updateError);
      return fail('internal', 'Could not change the password.');
    }

    // ── 5. Sign out everywhere ───────────────────────────────────────────
    // Revokes every refresh token for this account — including the one the
    // desktop app is holding, and the one step 3 just created. Without this,
    // "sign in again" would be theatre: the old session would keep working
    // until its access token happened to expire on its own. Non-fatal: the
    // password has already changed, and the operator still gets a real
    // answer either way.
    const { error: signOutError } = await admin.auth.admin.signOut(accessToken, 'global');

    if (signOutError) {
      console.error('[change-password] could not revoke sessions:', signOutError);
    }

    // ── 6. Confirmation email, last and non-fatal ───────────────────────
    await sendConfirmation(userData.user.email!, profile.first_name);

    return ok({});
  } catch (error) {
    console.error(error);
    return fail('internal', 'Something went wrong on our side. Please try again.');
  }
});
