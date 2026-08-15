import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import type { Owner } from '@/types/database';

/**
 * Auth helpers for API routes.
 *
 * These routes write league state on the service-role client, which bypasses
 * RLS entirely — so the route handler itself is the only thing standing between
 * a caller and the database. Several of them previously took the acting
 * `owner_id` straight from the request body, which meant any caller could act
 * as any owner.
 *
 * Identity is resolved the same way the rest of the app does it: the Supabase
 * session's email is matched against the `owners` table. A valid session alone
 * is NOT sufficient — sign-in is signInWithOtp with the default
 * shouldCreateUser, so anyone can obtain one. League membership is the check.
 */

/**
 * The authorization decision, separated from the IO so it can be tested.
 *
 * Commissioners may act for another owner — they run the draft and routinely
 * enter picks for absent owners, and the UI already grants them this
 * (keepers/page.tsx gates on `isAdmin && adminMode`, where isAdmin is
 * owner.is_commissioner).
 */
export function canActAs(
  actor: Pick<Owner, 'id' | 'is_commissioner'>,
  claimedOwnerId: string
): boolean {
  return actor.id === claimedOwnerId || actor.is_commissioner;
}

export type AuthFailure = { ok: false; response: NextResponse };
export type AuthSuccess = { ok: true; owner: Owner };
export type AuthResult = AuthFailure | AuthSuccess;

/** Resolve the signed-in league member, or a ready-to-return error response. */
export async function requireLeagueMember(): Promise<AuthResult> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user?.email) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    };
  }

  const { data: owners } = await supabase.from('owners').select('*');

  const owner = (owners ?? []).find(
    (o) => o.email && o.email.toLowerCase() === user.email!.toLowerCase()
  ) as Owner | undefined;

  if (!owner) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'Not a league member' }, { status: 403 }),
    };
  }

  return { ok: true, owner };
}

/**
 * Require that the caller IS the owner they claim to be acting as.
 *
 * Commissioners are allowed to act on another owner's behalf — they run the
 * draft and routinely enter picks for absent owners.
 */
export async function requireActingOwner(claimedOwnerId: string): Promise<AuthResult> {
  const auth = await requireLeagueMember();
  if (!auth.ok) return auth;

  if (!canActAs(auth.owner, claimedOwnerId)) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'Cannot act on behalf of another owner' },
        { status: 403 }
      ),
    };
  }

  return auth;
}

/** Require the caller to be the commissioner. */
export async function requireCommissioner(): Promise<AuthResult> {
  const auth = await requireLeagueMember();
  if (!auth.ok) return auth;

  if (!auth.owner.is_commissioner) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'Commissioner only' },
        { status: 403 }
      ),
    };
  }

  return auth;
}
