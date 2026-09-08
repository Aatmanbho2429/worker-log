// Supabase Edge Function — get-plans
//
// The renewal catalogue shown on the profile once a subscription has expired
// or is close to it. Reads with the service role key and asks the caller for
// nothing — no token, no device id — because a price list is not private the
// way a profile or a payment history is, and the operator who needs this
// screen is precisely the one whose access token may be mid-refresh.
//
// This is the most exposed of the functions in this directory: no
// authentication and no rate limit, unlike `send-otp`. That is accepted
// deliberately — it costs one indexed read of a four-row table and returns a
// price list, nothing an attacker gains anything from hammering.
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

const PLAN_COLUMNS = 'id, name, duration, amount, currency';

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }
  if (request.method !== 'POST') {
    return fail('badRequest', 'Use POST.');
  }

  try {
    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );

    const { data, error } = await admin
      .from('plans')
      .select(PLAN_COLUMNS)
      .eq('is_active', true)
      .order('sort_order', { ascending: true });

    if (error) {
      console.error('[get-plans] could not read the plan catalogue:', error);
      return fail('internal', 'Could not load the plans.');
    }

    return ok({ plans: data ?? [] });
  } catch (error) {
    console.error(error);
    return fail('internal', 'Something went wrong on our side. Please try again.');
  }
});
