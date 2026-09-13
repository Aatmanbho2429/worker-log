// Supabase Edge Function — login
//
// Signing in, and the only place the device binding is actually enforced.
//
// It would be simpler to sign in from the app and check `device_id` there, and
// it would also be worthless: the check would live in code the person being
// checked is running. So the password is verified here, the binding is decided
// here, and the session is only handed back once both have passed. The schema
// grants no update policy on `public.users`, so this function — holding the
// service role key — is the only thing that can claim or read the binding.
//
// A row with a null `device_id` is unclaimed, and the first machine to sign in
// takes it. That is also how support moves a licence: null the column.
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

// The `!users_current_subscription_id_fkey` hint is required: without it
// PostgREST sees two relationships between `users` and `subscriptions`
// (this one, and `subscriptions.user_id`) and refuses the query as
// ambiguous — which would fail sign-in for every account, not just this
// embed. `0004_current_subscription.sql` is what names the constraint.
const PROFILE_COLUMNS =
  'id, first_name, last_name, phone, email, company_name, device_id, ' +
  'status, subscription_status, subscriptions_end_date, created_date, ' +
  'current_subscription:subscriptions!users_current_subscription_id_fkey(' +
  'start_date, end_date, status, plans(name))';

interface CurrentSubscriptionRow {
  start_date: string | null;
  end_date: string | null;
  status: string | null;
  plans: { name: string } | null;
}

interface ProfileRow {
  id: string;
  device_id: string | null;
  status: 'active' | 'inactive' | 'blocked';
  subscription_status: string | null;
  subscriptions_end_date: string | null;
  current_subscription: CurrentSubscriptionRow | null;
}

/**
 * Writes `expired` back to the row when a trial or a paid term has run past
 * its end date, and returns the profile carrying whichever status is now
 * true — so a caller reading this response never sees a status the database
 * itself no longer agrees with.
 *
 * Not fatal if the write fails: the profile in this response still reports
 * the right status, and the next login or `validate-token` call tries again.
 * This is the only place either function refuses on a status past `expired`
 * — an expired subscription still signs in. The app decides what an expired
 * account can do; a lapsed card is not a wrong password.
 */
async function withCurrentSubscriptionStatus(
  admin: ReturnType<typeof createClient>,
  profile: ProfileRow,
): Promise<ProfileRow> {
  const { subscription_status: status, subscriptions_end_date: endsOn } = profile;

  if ((status === 'trial' || status === 'active') && endsOn && new Date(endsOn) < new Date()) {
    const { error } = await admin
      .from('users')
      .update({ subscription_status: 'expired' })
      .eq('id', profile.id);

    if (error) {
      console.error('[login] could not record the expired subscription:', error);
    }

    return { ...profile, subscription_status: 'expired' };
  }

  return profile;
}

interface LoginBody {
  email?: string;
  password?: string;
  deviceId?: string;
}

/**
 * One message for a wrong address and a wrong password, so the form cannot be
 * used to find out which addresses have accounts.
 */
const REFUSED = 'That email and password do not match an account.';

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }
  if (request.method !== 'POST') {
    return fail('badRequest', 'Use POST.');
  }

  try {
    const body = (await request.json()) as LoginBody;
    const deviceId = String(body.deviceId ?? '').trim();
    const email = String(body.email ?? '').trim().toLowerCase();

    if (!email || !body.password) {
      return fail('badRequest', REFUSED);
    }
    if (!deviceId) {
      return fail('badRequest', 'This machine could not be identified.');
    }

    const url = Deno.env.get('SUPABASE_URL')!;

    // Checking a password is the one thing that happens with no privilege at
    // all, so it goes through the anon key rather than the service role one.
    const anon = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { data: signIn, error: signInError } = await anon.auth.signInWithPassword({
      email,
      password: String(body.password),
    });

    if (signInError || !signIn?.session || !signIn.user) {
      return fail('badRequest', REFUSED);
    }

    const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { data, error: profileError } = await admin
      .from('users')
      .select(PROFILE_COLUMNS)
      .eq('id', signIn.user.id)
      .single();

    // The client is untyped and `PROFILE_COLUMNS` is a `string` rather than a
    // literal, so the row shape has to be asserted rather than inferred.
    const profile = data as unknown as ProfileRow | null;

    if (profileError || !profile) {
      console.error(profileError);
      return fail('notFound', 'That account has no profile. Please contact support.');
    }

    if (profile.status === 'blocked') {
      return fail('forbidden', 'This account has been blocked. Please contact support.');
    }
    if (profile.status !== 'active') {
      return fail('forbidden', 'This account is not active. Please contact support.');
    }

    if (!profile.device_id) {
      const { data: claimedData, error: claimError } = await admin
        .from('users')
        .update({ device_id: deviceId, modified_date: new Date().toISOString() })
        .eq('id', profile.id)
        // Only if it is still unclaimed, so two machines racing cannot both win.
        .is('device_id', null)
        .select(PROFILE_COLUMNS)
        .single();

      if (claimError || !claimedData) {
        return fail('conflict', 'This licence was just claimed by another PC.');
      }
      const claimed = claimedData as unknown as ProfileRow;
      return ok({
        session: signIn.session,
        profile: await withCurrentSubscriptionStatus(admin, claimed),
      });
    }

    if (profile.device_id !== deviceId) {
      return fail(
        'conflict',
        'This account is licensed to a different PC. Sign in on the machine it ' +
          'was registered on, or contact support to move the licence.',
      );
    }

    return ok({
      session: signIn.session,
      profile: await withCurrentSubscriptionStatus(admin, profile),
    });
  } catch (error) {
    console.error(error);
    return fail('internal', 'Something went wrong on our side. Please try again.');
  }
});
