// Supabase Edge Function — get-user-subscriptions
//
// The payment history shown on the profile: every `subscriptions` row for
// the calling account, newest first. Replaces a direct PostgREST read that
// used the operator's own access token — this does the same read with the
// service role key instead, once the caller has been proved.
//
// Ported from a reference implementation that took a bare `user_id` in the
// body and read that user's rows with no check that the caller was who they
// claimed — anyone who could reach the function with a guessed uuid would
// get a stranger's payment history. This version takes `accessToken` and
// resolves the id with `auth.getUser()`, the same pattern `validate-token` /
// `create-order` / `verify-payment` already use.
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

interface GetUserSubscriptionsBody {
  accessToken?: string;
}

// `razorpay_order_id` is kept even though nothing here inserts a row that
// has one without also having `razorpay_payment_id` set — `Payment.reference`
// on the Rust side falls back to it for a row that has an order but no
// captured payment yet, so this is a no-op today and a safety net if a
// webhook-based flow ever records a `pending` row before capture.
//
// `plans(name, duration)` — `duration` maps to nothing on the Rust side yet;
// harmless to include (an unrecognised JSON field is ignored on the way in)
// and cheaper to leave than to strip and re-add later.
const SUBSCRIPTION_COLUMNS =
  'id, amount, currency, status, start_date, end_date, created_at, ' +
  'razorpay_order_id, razorpay_payment_id, payment_method, plans(name, duration)';

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }
  if (request.method !== 'POST') {
    return fail('badRequest', 'Use POST.');
  }

  try {
    const body = (await request.json()) as GetUserSubscriptionsBody;
    const accessToken = String(body.accessToken ?? '').trim();

    if (!accessToken) {
      return fail('badRequest', 'Missing required fields.');
    }

    const url = Deno.env.get('SUPABASE_URL')!;

    // ── Who is calling ──────────────────────────────────────────────────
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

    // ── Their payment history, newest first ─────────────────────────────
    const { data, error } = await admin
      .from('subscriptions')
      .select(SUBSCRIPTION_COLUMNS)
      .eq('user_id', userData.user.id)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('[get-user-subscriptions] could not read the payment history:', error);
      return fail('internal', 'Could not load the payment history.');
    }

    return ok({ subscriptions: data ?? [] });
  } catch (error) {
    console.error(error);
    return fail('internal', 'Something went wrong on our side. Please try again.');
  }
});
