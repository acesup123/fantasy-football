import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

/**
 * POST /api/auth/magic-link
 *
 * Body: { email: string }
 *
 * Sends a sign-in link ONLY to an active league member.
 *
 * The client used to call supabase.auth.signInWithOtp directly, which defaults
 * to shouldCreateUser: true — so any address could mint a session, and every
 * table carries `FOR SELECT TO authenticated USING (true)` (001_schema.sql:277).
 * A stranger could read the whole league. The login page claimed "Only league
 * members can sign in"; this is what makes that true.
 *
 * Membership is checked here rather than in the browser because the `owners`
 * read policy is granted TO authenticated — an anonymous visitor can't query it.
 *
 * Note we do NOT set shouldCreateUser: false. Most owners have never signed in
 * and have no auth.users row yet; refusing to create one would lock them out.
 * The owners-table check is the gate, so creating the user here is safe.
 */

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const anon = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export async function POST(request: Request) {
  let body: { email?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';

  // `throttle` tells the client whether this failure consumed a send. Rejections
  // that never reached Supabase shouldn't put the button on a 60s cooldown —
  // a typo would strand the owner for a minute for no reason.
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return NextResponse.json(
      { error: 'Enter a valid email address', throttle: false },
      { status: 400 }
    );
  }

  // Compare case-insensitively: auth lowercases addresses, the owners table
  // is free text, and a stray capital would otherwise read as "not a member".
  const { data: owners, error: lookupError } = await admin
    .from('owners')
    .select('email, is_active')
    .eq('is_active', true);

  if (lookupError) {
    return NextResponse.json(
      { error: 'Could not verify league membership. Try again.', throttle: false },
      { status: 500 }
    );
  }

  const isMember = (owners ?? []).some(
    (o) => o.email && o.email.trim().toLowerCase() === email
  );

  if (!isMember) {
    // A private 12-person league among friends — a clear answer beats hiding
    // the roster behind a generic "check your email" that never arrives.
    return NextResponse.json(
      {
        error: "That email isn't on the league roster. Use the address registered with your team, or ask the commissioner.",
        throttle: false,
      },
      { status: 403 }
    );
  }

  const { error } = await anon.auth.signInWithOtp({
    email,
    options: {
      emailRedirectTo: `${new URL(request.url).origin}/auth/callback`,
    },
  });

  if (error) {
    const seconds = error.message.match(/after (\d+) seconds?/i);
    return NextResponse.json(
      {
        error: error.message,
        code: error.code ?? null,
        retryAfter: seconds ? Number(seconds[1]) : null,
        throttle: true,
      },
      { status: error.status ?? 500 }
    );
  }

  return NextResponse.json({ success: true });
}
