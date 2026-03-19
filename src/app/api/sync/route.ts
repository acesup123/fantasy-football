import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

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

const ESPN_LEAGUE_ID = process.env.ESPN_LEAGUE_ID ?? '130046';
const ESPN_SWID = process.env.ESPN_SWID ?? '';
const ESPN_S2 = process.env.ESPN_S2 ?? '';

// ESPN Team ID → owner name
const TEAM_OWNERS: Record<number, { name: string; from: number; to: number }[]> = {
  1:  [{ name: 'Alex Altman', from: 2010, to: 9999 }],
  2:  [{ name: 'Joel Oubre', from: 2010, to: 9999 }],
  3:  [{ name: 'Kevin Whitlock', from: 2010, to: 9999 }],
  4:  [{ name: 'Bill Kling', from: 2010, to: 2020 }, { name: 'Ryan Parrilla', from: 2021, to: 9999 }],
  5:  [{ name: 'Kelly Mann', from: 2010, to: 9999 }],
  6:  [{ name: 'Justin Choy', from: 2010, to: 9999 }],
  7:  [{ name: 'Ed Lang', from: 2010, to: 9999 }],
  8:  [{ name: 'Sal Singh', from: 2010, to: 9999 }],
  9:  [{ name: 'Navi Singh', from: 2010, to: 9999 }],
  10: [{ name: 'Aaron Schwartz', from: 2010, to: 2015 }, { name: 'Marcus Moore', from: 2016, to: 9999 }],
  11: [{ name: 'Jason McCartney', from: 2010, to: 9999 }],
  12: [{ name: 'Matt B', from: 2010, to: 2017 }, { name: 'Lance Michihira', from: 2018, to: 9999 }],
};

function getOwnerName(teamId: number, year: number): string | null {
  const entries = TEAM_OWNERS[teamId];
  if (!entries) return null;
  for (const e of entries) {
    if (year >= e.from && year <= e.to) return e.name;
  }
  return null;
}

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

async function espnFetch(year: number, views: string[]): Promise<any> {
  const viewParams = views.map(v => `view=${v}`).join('&');
  const url = `https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/${year}/segments/0/leagues/${ESPN_LEAGUE_ID}?${viewParams}`;
  const resp = await fetch(url, {
    headers: { Cookie: `SWID=${ESPN_SWID}; espn_s2=${ESPN_S2}` },
    next: { revalidate: 0 },
  });
  if (!resp.ok) throw new Error(`ESPN API error: ${resp.status}`);
  return resp.json();
}

function getCurrentNFLSeason(): number {
  const now = new Date();
  // NFL season year: if before March, it's the previous year's season
  return now.getMonth() < 2 ? now.getFullYear() - 1 : now.getFullYear();
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);

  // Optional cron auth
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const secret = searchParams.get('secret') ?? request.headers.get('authorization')?.replace('Bearer ', '');
    if (secret !== cronSecret) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

  const year = parseInt(searchParams.get('year') ?? '') || getCurrentNFLSeason();
  const log: string[] = [];
  let errors = 0;

  log.push(`Syncing ESPN data for ${year} season`);

  // Check ESPN cookies work
  if (!ESPN_SWID || !ESPN_S2) {
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
      const seed = team.playoffSeed ?? null;
      let playoffResult: string | null = null;
      if (espnTeamId === championTeamId) playoffResult = 'champion';
      else if (espnTeamId === runnerUpTeamId) playoffResult = 'runner_up';

      // Upsert: delete existing + insert
      await supabase
        .from('season_results')
        .delete()
        .eq('season_id', season.id)
        .eq('owner_id', ownerId);

      await supabase.from('season_results').insert({
        season_id: season.id,
        owner_id: ownerId,
        wins: rec.wins ?? 0,
        losses: rec.losses ?? 0,
        ties: rec.ties ?? 0,
        points_for: rec.pointsFor ?? 0,
        points_against: rec.pointsAgainst ?? 0,
        playoff_seed: seed,
        playoff_result: playoffResult,
        regular_season_finish: seed,
      });
      resultCount++;
    }
    log.push(`Updated ${resultCount} team standings`);

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
