import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import {
  buildStandings,
  espnFetch,
  getCurrentNFLSeason,
  hasEspnCredentials,
  isSeasonComplete,
} from '@/lib/espn/client';

/**
 * GET /api/standings/live
 *
 * Pulls standings straight from ESPN, bypassing the nightly sync. Backs the
 * "Refresh" button on /standings so in-week records are current rather than up
 * to 24h stale.
 *
 * Read-only — this does NOT write to Supabase. The nightly /api/sync owns
 * persistence; this is a live view on top of it.
 *
 * Query params:
 *   ?year=2025 — override season (defaults to current NFL season)
 */
export async function GET(request: Request) {
  // League data is private — require a signed-in league member.
  // A session alone is not enough: sign-in is signInWithOtp with the default
  // shouldCreateUser, so any email on the internet can obtain a valid session.
  // Membership is the actual authorization check.
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { data: owners } = await supabase
    .from('owners')
    .select('id, name, team_name, email');

  const isMember = (owners ?? []).some(
    (o) => o.email && user.email && o.email.toLowerCase() === user.email.toLowerCase()
  );
  if (!isMember) {
    return NextResponse.json({ error: 'Not a league member' }, { status: 403 });
  }

  if (!hasEspnCredentials()) {
    return NextResponse.json(
      { error: 'ESPN credentials not configured' },
      { status: 500 }
    );
  }

  const { searchParams } = new URL(request.url);
  const year = parseInt(searchParams.get('year') ?? '') || getCurrentNFLSeason();

  try {
    const league = await espnFetch(year, ['mTeam']);

    if (!league.teams?.length) {
      return NextResponse.json(
        { error: 'ESPN returned no teams — cookies may have expired' },
        { status: 502 }
      );
    }

    // Attach team names from our own owners table — ESPN's team names drift and
    // the app displays the league's canonical ones. (owners already fetched above
    // for the membership check.)
    const byName = new Map((owners ?? []).map((o) => [o.name, o]));

    const rows = buildStandings(league, year).map((row) => {
      const owner = row.ownerName ? byName.get(row.ownerName) : undefined;
      return {
        ...row,
        ownerId: owner?.id ?? null,
        teamName: owner?.team_name ?? null,
      };
    });

    return NextResponse.json({
      year,
      seasonComplete: isSeasonComplete(league),
      fetchedAt: new Date().toISOString(),
      standings: rows,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'ESPN fetch failed' },
      { status: 502 }
    );
  }
}
