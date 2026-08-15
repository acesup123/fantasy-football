import { timingSafeEqual } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import {
  espnFetch,
  getCurrentNFLSeason,
  getOwnerName,
  hasEspnCredentials,
  isSeasonComplete,
  rankOrNull,
} from '@/lib/espn/client';

/**
 * GET /api/sync
 *
 * Daily ESPN sync. Pulls current season standings, matchup scores,
 * and transactions into Supabase. Called by Vercel cron or manually.
 *
 * Query params:
 *   ?year=2025  — override season year (defaults to current NFL season)
 *   ?secret=xxx — optional auth for cron (matches CRON_SECRET env var)
 */

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// ESPN credentials, league id, the team→owner mapping and the fetch helper all
// live in @/lib/espn/client so /api/standings/live shares them.

// Cache owner IDs
let ownerIdCache: Record<string, string> | null = null;

async function getOwnerIds(): Promise<Record<string, string>> {
  if (ownerIdCache) return ownerIdCache;
  const { data } = await supabase.from('owners').select('id, name');
  ownerIdCache = {};
  for (const o of data ?? []) {
    ownerIdCache[o.name] = o.id;
  }
  return ownerIdCache;
}

/** Constant-time compare so the secret can't be recovered by timing the response. */
function timingSafeMatch(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);

  // Cron auth — fails CLOSED. This handler runs on the service-role client and
  // deletes/re-inserts season_results and matchups, so an unguarded call is
  // destructive. Previously the check was skipped entirely when CRON_SECRET was
  // unset, which left the route open to the internet.
  //
  // Vercel sends `Authorization: Bearer $CRON_SECRET` on its own cron
  // invocations once CRON_SECRET is set as an env var — no query string needed.
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return NextResponse.json(
      { error: 'CRON_SECRET is not configured — refusing to run' },
      { status: 503 }
    );
  }

  const provided =
    request.headers.get('authorization')?.replace('Bearer ', '') ??
    searchParams.get('secret') ??
    '';

  if (!timingSafeMatch(provided, cronSecret)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const year = parseInt(searchParams.get('year') ?? '') || getCurrentNFLSeason();
  const log: string[] = [];
  let errors = 0;

  log.push(`Syncing ESPN data for ${year} season`);

  // Check ESPN cookies work
  if (!hasEspnCredentials()) {
    return NextResponse.json({
      error: 'ESPN credentials not configured',
      log,
    }, { status: 500 });
  }

  const ownerIds = await getOwnerIds();

  try {
    // ============================================================
    // 1. SYNC STANDINGS
    // ============================================================
    log.push('Fetching standings...');
    const standingsData = await espnFetch(year, ['mTeam', 'mStandings']);
    const teams = standingsData.teams ?? [];
    const seasonComplete = isSeasonComplete(standingsData);
    log.push(seasonComplete ? 'Season is complete' : 'Season in progress');

    if (teams.length === 0) {
      log.push('WARNING: No teams returned — ESPN cookies may have expired');
      return NextResponse.json({ success: false, error: 'ESPN returned no data — cookies may have expired', log });
    }

    // Get or create season
    let { data: season } = await supabase
      .from('seasons')
      .select('id')
      .eq('year', year)
      .single();

    if (!season) {
      const { data: newSeason } = await supabase
        .from('seasons')
        .insert({ year, draft_status: 'complete', draft_order: [], is_current: true })
        .select()
        .single();
      season = newSeason;
      log.push(`Created new season for ${year}`);
    }

    if (!season) {
      throw new Error('Failed to get/create season');
    }

    // Find champion
    const matchupData = await espnFetch(year, ['mTeam', 'mMatchup', 'mMatchupScore']);
    const champGames = (matchupData.schedule ?? []).filter(
      (m: any) => m.playoffTierType === 'WINNERS_BRACKET'
    );
    let championTeamId: number | null = null;
    let runnerUpTeamId: number | null = null;
    if (champGames.length > 0) {
      const final = champGames.reduce((a: any, b: any) =>
        (a.matchupPeriodId ?? 0) > (b.matchupPeriodId ?? 0) ? a : b
      );
      const hId = final.home?.teamId;
      const aId = final.away?.teamId;
      if (final.winner === 'HOME') {
        championTeamId = hId;
        runnerUpTeamId = aId;
      } else if (final.winner === 'AWAY') {
        championTeamId = aId;
        runnerUpTeamId = hId;
      }
    }

    // Upsert season results
    let resultCount = 0;
    for (const team of teams) {
      const espnTeamId = team.id;
      const ownerName = getOwnerName(espnTeamId, year);
      const ownerId = ownerName ? ownerIds[ownerName] : null;
      if (!ownerId) continue;

      const rec = team.record?.overall ?? {};
      const seed = rankOrNull(team.playoffSeed);
      let playoffResult: string | null = null;
      if (espnTeamId === championTeamId) playoffResult = 'champion';
      else if (espnTeamId === runnerUpTeamId) playoffResult = 'runner_up';

      // Final placement after playoffs. ESPN keeps this field populated mid-season
      // as a projection, so only record it once the season is actually complete —
      // otherwise the draft lottery would seed off a guess.
      const finalRank = seasonComplete ? rankOrNull(team.rankCalculatedFinal) : null;

      const streakType = rec.streakType ?? null;

      // Real upsert on the (season_id, owner_id) unique constraint. This used to
      // be delete-then-insert with neither error checked, so if the insert failed
      // — e.g. migration 002 had not been applied and the new columns did not
      // exist — the delete had already succeeded and the row was simply gone,
      // while the route still reported success. An upsert never leaves the row
      // transiently absent, and the error is checked below.
      const { error: upsertError } = await supabase.from('season_results').upsert({
        season_id: season.id,
        owner_id: ownerId,
        wins: rec.wins ?? 0,
        losses: rec.losses ?? 0,
        ties: rec.ties ?? 0,
        points_for: rec.pointsFor ?? 0,
        points_against: rec.pointsAgainst ?? 0,
        playoff_seed: seed,
        playoff_result: playoffResult,
        // ESPN assigns playoffSeed strictly by regular-season standings order,
        // so seed is the regular-season finish. final_rank is the post-playoff one.
        regular_season_finish: seed,
        final_rank: finalRank,
        streak_length: rec.streakLength ?? null,
        streak_type:
          streakType === 'WIN' || streakType === 'LOSS' || streakType === 'TIE'
            ? streakType
            : null,
        games_back: rec.gamesBack ?? null,
      }, { onConflict: 'season_id,owner_id' });

      if (upsertError) {
        // Fail loudly and stop. A partial standings write is worse than none:
        // the lottery seeds off a complete 1-12 and silently falls back otherwise.
        log.push(`ERROR writing standings for ${ownerName}: ${upsertError.message}`);
        return NextResponse.json(
          {
            success: false,
            error: `Failed to write season_results: ${upsertError.message}`,
            hint: 'If this mentions an unknown column, apply the latest migration in supabase/migrations/.',
            log,
          },
          { status: 500 }
        );
      }
      resultCount++;
    }
    log.push(`Updated ${resultCount} team standings`);

    if (resultCount !== teams.length) {
      // Every ESPN team must map to an owner. A short count means the
      // TEAM_OWNERS ranges have a gap, which would silently break the lottery.
      log.push(
        `WARNING: wrote ${resultCount} of ${teams.length} teams — check TEAM_OWNERS year ranges`
      );
      errors++;
    }

    // ============================================================
    // 2. SYNC MATCHUPS
    // ============================================================
    log.push('Fetching matchups...');
    const schedule = matchupData.schedule ?? [];

    // Get existing matchup count
    const { count: existingMatchups } = await supabase
      .from('matchups')
      .select('id', { count: 'exact', head: true })
      .eq('season_id', season.id);

    const newMatchups = schedule.filter((m: any) => {
      const home = m.home?.teamId;
      const away = m.away?.teamId;
      return home && away && m.home?.totalPoints > 0;
    });

    if (newMatchups.length > (existingMatchups ?? 0)) {
      // Delete and re-import all matchups for this season
      // (simpler than diffing individual matchups)

      // First delete lineups for this season's matchups
      const { data: oldMatchups } = await supabase
        .from('matchups')
        .select('id')
        .eq('season_id', season.id);

      if (oldMatchups && oldMatchups.length > 0) {
        const oldIds = oldMatchups.map(m => m.id);
        // Delete in batches
        for (let i = 0; i < oldIds.length; i += 100) {
          const batch = oldIds.slice(i, i + 100);
          await supabase.from('matchup_lineups').delete().in('matchup_id', batch);
        }
        await supabase.from('matchups').delete().eq('season_id', season.id);
      }

      let matchupCount = 0;
      for (const m of schedule) {
        const home = m.home;
        const away = m.away;
        if (!home?.teamId || !away?.teamId) continue;

        const hName = getOwnerName(home.teamId, year);
        const aName = getOwnerName(away.teamId, year);
        const hId = hName ? ownerIds[hName] : null;
        const aId = aName ? ownerIds[aName] : null;
        if (!hId || !aId) continue;

        const winnerId = m.winner === 'HOME' ? hId : m.winner === 'AWAY' ? aId : null;
        const playoffTier = m.playoffTierType;
        const isPlayoff = playoffTier != null && playoffTier !== 'NONE';

        await supabase.from('matchups').insert({
          season_id: season.id,
          week: m.matchupPeriodId,
          home_owner_id: hId,
          away_owner_id: aId,
          home_points: home.totalPoints ?? 0,
          away_points: away.totalPoints ?? 0,
          winner_owner_id: winnerId,
          is_playoff: isPlayoff,
          playoff_tier: isPlayoff ? playoffTier : null,
        });
        matchupCount++;
      }
      log.push(`Synced ${matchupCount} matchups (was ${existingMatchups ?? 0})`);
    } else {
      log.push(`Matchups up to date (${existingMatchups} existing)`);
    }

    log.push('Sync complete!');

  } catch (err: any) {
    errors++;
    log.push(`ERROR: ${err.message}`);

    if (err.message?.includes('401') || err.message?.includes('403')) {
      log.push('ESPN cookies have likely expired — update ESPN_S2 in Vercel env vars');
    }
  }

  return NextResponse.json({
    success: errors === 0,
    year,
    errors,
    log,
    timestamp: new Date().toISOString(),
  });
}
