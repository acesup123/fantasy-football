import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// ESPN config for transaction lookups
const ESPN_LEAGUE_ID = process.env.ESPN_LEAGUE_ID ?? '130046';
const ESPN_SWID = process.env.ESPN_SWID ?? '';
const ESPN_S2 = process.env.ESPN_S2 ?? '';

// ESPN Team ID → owner name mapping
const ESPN_TEAM_OWNERS: Record<number, { name: string; from: number; to: number }[]> = {
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

function getEspnOwnerName(teamId: number, year: number): string | null {
  const entries = ESPN_TEAM_OWNERS[teamId];
  if (!entries) return null;
  for (const e of entries) {
    if (year >= e.from && year <= e.to) return e.name;
  }
  return null;
}

/**
 * Fetch post-trade-deadline FA pickups from ESPN for a given season.
 * Returns a Map<ownerName, Set<espnPlayerId>> of ineligible players.
 */
async function getPostDeadlinePickups(year: number): Promise<Map<string, Set<number>>> {
  const result = new Map<string, Set<number>>();

  if (!ESPN_SWID || !ESPN_S2) return result;

  try {
    // Get trade deadline from settings
    const settingsUrl = `https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/${year}/segments/0/leagues/${ESPN_LEAGUE_ID}?view=mSettings`;
    const settingsResp = await fetch(settingsUrl, {
      headers: { Cookie: `SWID=${ESPN_SWID}; espn_s2=${ESPN_S2}` },
    });
    const settingsData = await settingsResp.json();
    const deadlineMs = settingsData?.settings?.tradeSettings?.deadlineDate;
    if (!deadlineMs) return result;

    const deadline = new Date(deadlineMs);

    // Fetch transactions from each scoring period
    for (let sp = 1; sp <= 18; sp++) {
      const txnUrl = `https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/${year}/segments/0/leagues/${ESPN_LEAGUE_ID}?view=mTransactions2&scoringPeriodId=${sp}`;
      const txnResp = await fetch(txnUrl, {
        headers: { Cookie: `SWID=${ESPN_SWID}; espn_s2=${ESPN_S2}` },
      });
      const txnData = await txnResp.json();

      for (const txn of txnData?.transactions ?? []) {
        if (txn.type !== 'FREEAGENT' && txn.type !== 'WAIVER') continue;

        const txnDate = new Date(txn.proposedDate ?? 0);
        if (txnDate <= deadline) continue;

        const teamId = txn.teamId;
        const ownerName = getEspnOwnerName(teamId, year);
        if (!ownerName) continue;

        for (const item of txn.items ?? []) {
          if (item.type === 'ADD') {
            if (!result.has(ownerName)) result.set(ownerName, new Set());
            result.get(ownerName)!.add(item.playerId);
          }
        }
      }
    }
  } catch (err) {
    console.error('Failed to fetch ESPN transactions:', err);
  }

  return result;
}

/**
 * GET /api/keepers/eligible?season=2026
 *
 * Returns keeper-eligible players for all owners for the upcoming season.
 * Uses draft history to calculate costs and the previous season's final roster
 * to determine who each owner has.
 * Also checks ESPN for post-trade-deadline FA pickups (ineligible).
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const targetYear = parseInt(searchParams.get('season') ?? '2026');
  const prevYear = targetYear - 1;

  // Get the previous season
  const { data: prevSeason } = await supabase
    .from('seasons')
    .select('id')
    .eq('year', prevYear)
    .single();

  if (!prevSeason) {
    return NextResponse.json({ error: `No season found for ${prevYear}` }, { status: 404 });
  }

  // Get all active owners
  const { data: owners } = await supabase
    .from('owners')
    .select('id, name, team_name')
    .eq('is_active', true)
    .order('name');

  // Fetch post-trade-deadline FA pickups from ESPN (ineligible for keeper)
  const postDeadlinePickups = await getPostDeadlinePickups(prevYear);

  // Build a map of owner name → set of ineligible ESPN player IDs
  // We'll match by cross-referencing espn_id on the players table
  const ineligibleEspnIds = new Map<string, Set<number>>();
  for (const [ownerName, espnIds] of postDeadlinePickups) {
    ineligibleEspnIds.set(ownerName, espnIds);
  }

  // Get the final week's matchups to determine end-of-season rosters
  const { data: lastMatchup } = await supabase
    .from('matchups')
    .select('week')
    .eq('season_id', prevSeason.id)
    .order('week', { ascending: false })
    .limit(1)
    .single();

  const finalWeek = lastMatchup?.week ?? 17;

  // Get all final-week matchup IDs
  const { data: finalMatchups } = await supabase
    .from('matchups')
    .select('id, home_owner_id, away_owner_id')
    .eq('season_id', prevSeason.id)
    .eq('week', finalWeek);

  // Get all lineup entries for final week
  const matchupIds = (finalMatchups ?? []).map(m => m.id);
  const { data: lineups } = await supabase
    .from('matchup_lineups')
    .select('owner_id, player_id, players(id, name, position)')
    .in('matchup_id', matchupIds);

  // Build roster map: owner_id → player_ids
  const rosterMap = new Map<string, Set<number>>();
  for (const l of lineups ?? []) {
    if (!rosterMap.has(l.owner_id)) {
      rosterMap.set(l.owner_id, new Set());
    }
    rosterMap.get(l.owner_id)!.add(l.player_id);
  }

  // Also add players drafted in the previous season (in case lineup data is incomplete)
  const { data: draftPicks } = await supabase
    .from('draft_picks')
    .select('current_owner_id, player_id')
    .eq('season_id', prevSeason.id);

  for (const dp of draftPicks ?? []) {
    if (!rosterMap.has(dp.current_owner_id)) {
      rosterMap.set(dp.current_owner_id, new Set());
    }
    rosterMap.get(dp.current_owner_id)!.add(dp.player_id);
  }

  // Get ALL draft picks across all seasons to trace keeper history
  const { data: allPicks } = await supabase
    .from('draft_picks')
    .select('season_id, current_owner_id, player_id, round, is_keeper, keeper_year, seasons(year)')
    .order('season_id', { ascending: true });

  // Build player draft history: player_id → { firstDraftYear, firstDraftRound, ownerHistory }
  const playerHistory = new Map<number, {
    firstDraftYear: number;
    firstDraftRound: number;
    consecutiveKeeps: number;
    lastKeeperYear: number | null;
  }>();

  for (const pick of allPicks ?? []) {
    const year = (pick.seasons as any)?.year;
    if (!year) continue;

    const pid = pick.player_id;
    if (!playerHistory.has(pid)) {
      playerHistory.set(pid, {
        firstDraftYear: year,
        firstDraftRound: pick.round,
        consecutiveKeeps: 0,
        lastKeeperYear: null,
      });
    }

    const h = playerHistory.get(pid)!;
    if (pick.is_keeper && pick.keeper_year) {
      h.consecutiveKeeps = pick.keeper_year;
      h.lastKeeperYear = year;
    }
  }

  // Get all player details
  const allPlayerIds = new Set<number>();
  for (const [, roster] of rosterMap) {
    for (const pid of roster) {
      allPlayerIds.add(pid);
    }
  }

  const { data: players } = await supabase
    .from('players')
    .select('id, name, position, nfl_team, espn_id')
    .in('id', Array.from(allPlayerIds));

  const playerMap = new Map((players ?? []).map(p => [p.id, p]));

  // Build response: per owner, list of keeper-eligible players with costs
  const result = (owners ?? []).map(owner => {
    const roster = rosterMap.get(owner.id) ?? new Set();

    // Check if this owner has any post-deadline pickups
    const ownerPostDeadline = ineligibleEspnIds.get(owner.name) ?? new Set();

    const eligiblePlayers = Array.from(roster).map(pid => {
      const player = playerMap.get(pid);
      if (!player) return null;

      // Check if this player was a post-deadline FA pickup (by ESPN ID)
      const espnId = player.espn_id ? parseInt(player.espn_id) : null;
      const isPostDeadlinePickup = espnId !== null && ownerPostDeadline.has(espnId);

      if (isPostDeadlinePickup) {
        return {
          player_id: pid,
          player_name: player.name,
          position: player.position,
          nfl_team: player.nfl_team,
          original_round: 0,
          keeper_year: 0,
          round_cost: 0,
          years_remaining: 0,
          eligible: false,
          source: 'free_agent' as const,
          reason: 'Picked up after trade deadline',
        };
      }

      const history = playerHistory.get(pid);
      if (!history) {
        // Player not found in draft history — likely a free agent pickup
        // Free agents start as round 10
        return {
          player_id: pid,
          player_name: player.name,
          position: player.position,
          nfl_team: player.nfl_team,
          original_round: 10,
          keeper_year: 1, // Would be K1
          round_cost: 10, // Round 10 first year
          years_remaining: 3,
          eligible: true,
          source: 'free_agent' as const,
        };
      }

      const yearsKept = history.consecutiveKeeps;
      const nextKeeperYear = yearsKept + 1;

      // Max 4 keeper years (K1-K4)
      if (nextKeeperYear > 4) {
        return {
          player_id: pid,
          player_name: player.name,
          position: player.position,
          nfl_team: player.nfl_team,
          original_round: history.firstDraftRound,
          keeper_year: nextKeeperYear,
          round_cost: 0,
          years_remaining: 0,
          eligible: false,
          source: 'draft' as const,
          reason: 'Max keeper years reached (K4 was final year)',
        };
      }

      // Calculate cost: original round - years kept, min 1
      let roundCost = history.firstDraftRound - nextKeeperYear;
      if (history.firstDraftRound === 1) roundCost = 1; // Round 1 always costs round 1
      roundCost = Math.max(1, roundCost);

      return {
        player_id: pid,
        player_name: player.name,
        position: player.position,
        nfl_team: player.nfl_team,
        original_round: history.firstDraftRound,
        keeper_year: nextKeeperYear,
        round_cost: roundCost,
        years_remaining: 4 - nextKeeperYear,
        eligible: true,
        source: 'draft' as const,
      };
    }).filter(Boolean);

    // Sort: eligible first, then by round cost
    eligiblePlayers.sort((a, b) => {
      if (a!.eligible !== b!.eligible) return a!.eligible ? -1 : 1;
      return a!.round_cost - b!.round_cost;
    });

    return {
      owner_id: owner.id,
      owner_name: owner.name,
      team_name: owner.team_name,
      players: eligiblePlayers,
    };
  });

  return NextResponse.json(result);
}
