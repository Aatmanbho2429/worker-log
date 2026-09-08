// Supabase Edge Function — create-order
//
// The first half of a purchase: read the plan's real price out of the
// database, open an order against it with Razorpay, and hand back only what
// checkout.js needs to render its widget. Nothing the caller sends decides
// what gets charged — `plan_id` is a lookup key, not an amount.
//
// Ported from a working pair on another project. Two things changed for how
// this project actually proves who is calling: the caller identifies itself
// with `accessToken` (checked with `auth.getUser`, the same way
// `validate-token` already does) rather than a bare `user_id` in the body,
// and the response carries no name/email/phone — `AuthService.user()` already
// holds all three in the window, so Razorpay's `prefill` is built there
// instead of being handed back here for anyone who can guess a uuid to read.
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

interface CreateOrderBody {
  accessToken?: string;
  planId?: string;
}

interface PlanRow {
  id: string;
  name: string;
  duration: number;
  amount: number;
  currency: string | null;
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }
  if (request.method !== 'POST') {
    return fail('badRequest', 'Use POST.');
  }

  try {
    const body = (await request.json()) as CreateOrderBody;
    const accessToken = String(body.accessToken ?? '').trim();
    const planId = String(body.planId ?? '').trim();

    if (!accessToken || !planId) {
      return fail('badRequest', 'accessToken and planId are required.');
    }

    const url = Deno.env.get('SUPABASE_URL')!;

    // Who is calling — proved by the token, never taken on trust from the
    // body. The same check `validate-token` already does.
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

    const { data: userRow, error: userRowError } = await admin
      .from('users')
      .select('id, status')
      .eq('id', userData.user.id)
      .single();

    if (userRowError || !userRow) {
      return fail('notFound', 'That account has no profile. Please contact support.');
    }
    // A blocked or otherwise inactive account should not be able to buy its
    // way back in — the same status `validate-token` refuses on.
    if (userRow.status !== 'active') {
      return fail('forbidden', 'This account is not active. Please contact support.');
    }

    const { data, error: planError } = await admin
      .from('plans')
      .select('id, name, duration, amount, currency')
      .eq('id', planId)
      .eq('is_active', true)
      .single();

    const plan = data as unknown as PlanRow | null;

    if (planError || !plan) {
      return fail('notFound', 'That plan is not available.');
    }

    // ── Create the Razorpay order ─────────────────────────────────────
    const keyId = Deno.env.get('RAZORPAY_KEY_ID_PROD')!;
    const keySecret = Deno.env.get('RAZORPAY_KEY_SECRET_PROD')!;
    const auth = btoa(`${keyId}:${keySecret}`);

    const orderResponse = await fetch('https://api.razorpay.com/v1/orders', {
      method: 'POST',
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        // Razorpay takes paise, an integer — `plan.amount` is rupees.
        amount: Math.round(plan.amount * 100),
        currency: plan.currency || 'INR',
        // Stays inside Razorpay's 40-character receipt limit.
        receipt: `wastelog_${userRow.id.slice(0, 8)}_${Date.now()}`,
        notes: {
          user_id: userRow.id,
          plan_id: plan.id,
          plan: plan.name,
        },
      }),
    });

    if (!orderResponse.ok) {
      const body = await orderResponse.text();
      console.error('[create-order] razorpay refused:', body);
      return fail('internal', 'Could not start the payment. Please try again.');
    }

    const order = await orderResponse.json();

    return ok({
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
      keyId,
    });
  } catch (error) {
    console.error(error);
    return fail('internal', 'Something went wrong on our side. Please try again.');
  }
});
