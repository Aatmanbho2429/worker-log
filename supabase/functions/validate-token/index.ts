// Supabase Edge Function — validate-token
//
// What the app calls every few hours to find out, without asking the operator
// to sign in again, whether the session it is holding still means anything:
// is the token still good, is this still the PC the licence is bound to, has
// the account been blocked since, and has a trial or a paid term run out.
//
// The token itself is proof of nothing here beyond "GoTrue issued this and it
// has not expired" — the device and status checks below are what `login`
// already enforces at sign-in, run again because time has passed since then.
// Nothing is claimed here the way `login` claims a null `device_id`: by the
// time a token exists to validate, the account already signed in once, so an
// unset `device_id` at this point is a broken row rather than a first login.
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

const PROFILE_COLUMNS =
  'id, first_name, last_name, phone, email, company_name, device_id, ' +
  'status, subscription_status, subscriptions_end_date, created_date';

interface ProfileRow {
  id: string;
  device_id: string | null;
  status: 'active' | 'inactive' | 'blocked';
  subscription_status: string | null;
  subscriptions_end_date: string | null;
}

interface ValidateBody {
  accessToken?: string;
  deviceId?: string;
}

/**
 * Writes `expired` back to the row when a trial or a paid term has run past
 * its end date, and returns the profile carrying whichever status is now
 * true — so a caller reading this response never sees a status the database
 * itself no longer agrees with.
 *
 * Kept identical to the copy in `login/index.ts` rather than shared: each
 * function is pasted into the dashboard on its own, the way `send-otp` and
 * `register` already duplicate the code hashing they both need.
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
      console.error('[validate-token] could not record the expired subscription:', error);
    }

    return { ...profile, subscription_status: 'expired' };
  }

  return profile;
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }
  if (request.method !== 'POST') {
    return fail('badRequest', 'Use POST.');
  }

  try {
    const body = (await request.json()) as ValidateBody;
    const accessToken = String(body.accessToken ?? '').trim();
    const deviceId = String(body.deviceId ?? '').trim();

    if (!accessToken) {
      return fail('badRequest', 'No token provided.');
    }

    const url = Deno.env.get('SUPABASE_URL')!;

    // Deciding whether the token itself is still good needs no privilege
    // beyond the token — the same reason `login` checks the password with
    // the anon key rather than the service role one.
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

    const { data, error: profileError } = await admin
      .from('users')
      .select(PROFILE_COLUMNS)
      .eq('id', userData.user.id)
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

    // Not a claim, unlike `login` — a null `device_id` here means the row was
    // changed after the token was issued (support cleared it, say), not that
    // this is the first sign-in.
    if (!profile.device_id || (deviceId && profile.device_id !== deviceId)) {
      return fail(
        'conflict',
        'This account is licensed to a different PC. Sign in on the machine it ' +
          'was registered on, or contact support to move the licence.',
      );
    }

    return ok({ profile: await withCurrentSubscriptionStatus(admin, profile) });
  } catch (error) {
    console.error(error);
    return fail('internal', 'Something went wrong on our side. Please try again.');
  }
});
