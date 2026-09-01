// Supabase Edge Function — forgot-password
//
// Rolls a new password for an account and emails it.
//
// The new password is **never** put in the response. This endpoint takes an
// email address and no proof of anything, so returning what it set would let
// anyone take over any account by asking. It goes to the address on file or it
// goes nowhere, and if the mail cannot be sent the change is not made.
//
// Needs two secrets of its own:
//
//   supabase secrets set RESEND_API_KEY=re_xxxxxxxx
//   supabase secrets set RESEND_FROM="Waste Log <noreply@your-domain.com>"
//
// The `from` address has to be on a domain verified in Resend; their sandbox
// sender only delivers to your own account's address.
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

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i;

/** No 0/O or 1/l, because this gets read off a screen and typed in again. */
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
const LENGTH = 12;

function rollPassword(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(LENGTH));
  return Array.from(bytes, (byte) => ALPHABET[byte % ALPHABET.length]).join('');
}

async function sendPassword(to: string, firstName: string, password: string): Promise<void> {
  const apiKey = Deno.env.get('RESEND_API_KEY');
  const from = Deno.env.get('RESEND_FROM');

  if (!apiKey || !from) {
    throw new Error('RESEND_API_KEY and RESEND_FROM must be set on this function');
  }

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from,
      to: [to],
      subject: 'Your new Waste Log password',
      html: `
        <p>Hello ${firstName},</p>
        <p>Here is a new password for your Waste Log account:</p>
        <p style="font-family:monospace;font-size:20px;letter-spacing:2px"><strong>${password}</strong></p>
        <p>Sign in with it, then change it from your profile.</p>
        <p>If you did not ask for this, change your password straight away —
        someone else has requested a reset on your account.</p>
      `,
    }),
  });

  if (!response.ok) {
    throw new Error(`Resend refused the message: ${response.status} ${await response.text()}`);
  }
}

interface AccountRow {
  id: string;
  first_name: string;
  email: string;
  status: string;
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }
  if (request.method !== 'POST') {
    return fail('badRequest', 'Use POST.');
  }

  try {
    const body = (await request.json()) as { email?: string };
    const email = String(body.email ?? '').trim().toLowerCase();

    if (!email || !EMAIL_PATTERN.test(email)) {
      return fail('badRequest', 'That does not look like an email address.');
    }

    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );

    const { data } = await admin
      .from('users')
      .select('id, first_name, email, status')
      .eq('email', email)
      .maybeSingle();

    const profile = data as unknown as AccountRow | null;

    // Naming an address with no account tells a stranger which addresses have
    // one. It is kept because this is a licensed tool with a known operator at
    // a known machine, and telling them they typed the wrong address is worth
    // more here than the enumeration it costs. Return the same success
    // response as below instead if you would rather not say.
    if (!profile) {
      return fail('notFound', 'No account is registered with that email address.');
    }
    if (profile.status !== 'active') {
      return fail('forbidden', 'This account is not active. Please contact support.');
    }

    const password = rollPassword();

    // Sent first: a password that was set but never delivered locks the
    // operator out of an account that was working a moment ago.
    await sendPassword(profile.email, profile.first_name, password);

    const { error: updateError } = await admin.auth.admin.updateUserById(profile.id, { password });

    if (updateError) {
      console.error(updateError);
      return fail('internal', 'Could not set the new password.');
    }

    return ok({ sentTo: profile.email });
  } catch (error) {
    console.error(error);
    return fail('internal', 'Something went wrong on our side. Please try again.');
  }
});
