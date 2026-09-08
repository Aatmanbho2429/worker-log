// Supabase Edge Function — verify-payment
//
// The second half of a purchase, and the one that actually matters: proves
// the payment Razorpay's widget reported is real, then records the term it
// bought. Nothing before this point could have been trusted on its own —
// `create-order`'s `order_id` is public, and the checkout widget runs in the
// operator's own webview, where a modified client could claim success
// without paying. The signature is what closes that gap: only someone
// holding the Razorpay key secret (this function, never the client) can have
// produced it from the real `order_id` and `payment_id` together.
//
// Ported from a working pair on another project, with the caller identified
// by `accessToken` rather than a bare `user_id` (see `create-order`'s header
// for why), this project's actual column names (`subscriptions_end_date`,
// not `subscription_end`), and a replay guard the original did not have —
// see the comment above the duplicate check below.
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

interface VerifyPaymentBody {
  accessToken?: string;
  planId?: string;
  razorpayOrderId?: string;
  razorpayPaymentId?: string;
  razorpaySignature?: string;
}

interface PlanRow {
  id: string;
  name: string;
  duration: number;
  amount: number;
  currency: string | null;
}

/** HMAC-SHA256 of `orderId|paymentId`, hex-encoded — what Razorpay signs. */
async function computeSignature(orderId: string, paymentId: string, secret: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signatureBuffer = await crypto.subtle.sign('HMAC', key, encoder.encode(`${orderId}|${paymentId}`));
  return Array.from(new Uint8Array(signatureBuffer))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }
  if (request.method !== 'POST') {
    return fail('badRequest', 'Use POST.');
  }

  try {
    const body = (await request.json()) as VerifyPaymentBody;
    const accessToken = String(body.accessToken ?? '').trim();
    const planId = String(body.planId ?? '').trim();
    const razorpayOrderId = String(body.razorpayOrderId ?? '').trim();
    const razorpayPaymentId = String(body.razorpayPaymentId ?? '').trim();
    const razorpaySignature = String(body.razorpaySignature ?? '').trim();

    if (!accessToken || !planId || !razorpayOrderId || !razorpayPaymentId || !razorpaySignature) {
      return fail('badRequest', 'Missing required fields.');
    }

    // ── 1. Prove the signature ────────────────────────────────────────
    const keySecret = Deno.env.get('RAZORPAY_KEY_SECRET_PROD')!;
    const expected = await computeSignature(razorpayOrderId, razorpayPaymentId, keySecret);

    if (expected !== razorpaySignature) {
      return fail('badRequest', 'Invalid payment signature.');
    }

    const url = Deno.env.get('SUPABASE_URL')!;

    // ── 2. Who is calling ──────────────────────────────────────────────
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

    // ── 3. Refuse to buy the same term twice ──────────────────────────
    // A signature that has already been recorded means this call is a
    // retry — a network blip on the client after the first call actually
    // landed, say — not a second payment. Answering with the term already
    // on file, rather than inserting again, is what keeps a retry from
    // extending the licence a second time for one payment. The unique
    // index in `0003_payments.sql` is the backstop if two such calls ever
    // race each other.
    const { data: existing } = await admin
      .from('subscriptions')
      .select('end_date')
      .eq('razorpay_payment_id', razorpayPaymentId)
      .maybeSingle();

    if (existing) {
      return ok({ subscriptionEnd: existing.end_date });
    }

    // ── 4. Read the plan and the account's current term ───────────────
    const { data: planData, error: planError } = await admin
      .from('plans')
      .select('id, name, duration, amount, currency')
      .eq('id', planId)
      .single();

    const plan = planData as unknown as PlanRow | null;

    if (planError || !plan) {
      return fail('notFound', 'That plan is not available.');
    }

    const { data: userRow, error: userRowError } = await admin
      .from('users')
      .select('subscriptions_end_date')
      .eq('id', userData.user.id)
      .single();

    if (userRowError || !userRow) {
      return fail('notFound', 'That account has no profile. Please contact support.');
    }

    // ── 5. Work out the new term ───────────────────────────────────────
    // Extends from whichever is later: today, or the current end date —
    // one expression that covers a trial, an active licence and an
    // expired one without a status check, and never discards time the
    // operator already had (unlike extending only when `status ===
    // 'active'`, which would cost a mid-trial purchaser their remaining
    // trial days).
    const now = new Date();
    const currentEnd = userRow.subscriptions_end_date ? new Date(userRow.subscriptions_end_date) : now;
    const startDate = currentEnd > now ? currentEnd : now;

    const endDate = new Date(startDate);
    endDate.setDate(endDate.getDate() + plan.duration);

    // ── 6. Record the payment ──────────────────────────────────────────
    const { error: insertError } = await admin.from('subscriptions').insert({
      user_id: userData.user.id,
      plan_id: plan.id,
      amount: plan.amount,
      currency: plan.currency || 'INR',
      status: 'active',
      start_date: startDate.toISOString(),
      end_date: endDate.toISOString(),
      razorpay_order_id: razorpayOrderId,
      razorpay_payment_id: razorpayPaymentId,
      razorpay_signature: razorpaySignature,
      payment_method: 'razorpay',
    });

    if (insertError) {
      console.error('[verify-payment] could not record the payment:', insertError);
      return fail('internal', 'The payment went through, but could not be recorded. Please contact support.');
    }

    // ── 7. Unblock the account ─────────────────────────────────────────
    const { error: updateError } = await admin
      .from('users')
      .update({
        subscription_status: 'active',
        subscriptions_end_date: endDate.toISOString(),
      })
      .eq('id', userData.user.id);

    if (updateError) {
      console.error('[verify-payment] could not update the account:', updateError);
      return fail('internal', 'The payment was recorded, but the account could not be updated. Please contact support.');
    }

    return ok({ subscriptionEnd: endDate.toISOString() });
  } catch (error) {
    console.error(error);
    return fail('internal', 'Something went wrong on our side. Please try again.');
  }
});
