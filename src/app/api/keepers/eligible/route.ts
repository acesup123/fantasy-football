import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { fetchFinalRosters, keepsDraftStatus } from '@/lib/espn/rosters';
import { hasEspnCredentials } from '@/lib/espn/request';
import { getOwnerForTeam } from '@/lib/espn/config';
import { computeKeeperCost, type DraftHistoryEntry } from '@/lib/keepers/cost-calculator';

/**
 * GET /api/keepers/eligible?season=2026
 *
 * Every player each owner could keep for the upcoming season, with the round
 * each would cost.
 *
 * The eligible pool is last season's ESPN final roster — who actually held
 * each player when the season ended. Rebuilding that from draft picks and
 * lineups misattributes anyone acquired by trade or off waivers afterwards.
 *
 * Costs come from the shared keeper rules so this agrees with
 * /api/keepers/sync; the two used to disagree because this route had its own
 * copy of the maths.
 *
 * Note: the round shown here is a player's base cost. Two keepers landing on
 * the same round bump each other, but that depends on which five an owner
 * actually elects, so it's resolved at sync time rather than here.
 */

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const targetYear = parseInt(searchParams.get('season') ?? '2026');
  const prevYear = targetYear - 1;

  if (!hasEspnCredentials()) {
    return NextResponse.json({ error: 'ESPN credentials not configured' }, { status: 500 });
  }

  const { data: owners } = await supabase
    .from('owners')
    .select('id, name, team_name')
    .eq('is_active', true)
    .order('name');


  // ---------------------------------------------------------------
  // Last season's final rosters — the keeper-eligible pool
  // ---------------------------------------------------------------
  let rosters;
  try {
    rosters = await fetchFinalRosters(prevYear);
  } catch (err: any) {
    return NextResponse.json(
      { error: `Could not read ${prevYear} rosters from ESPN: ${err.message}` },
      { status: 502 }
    );
  }

  // Offseason trades land after the final-roster snapshot, so a player can be
  // on someone else's end-of-season roster but on your roster now. The current
  // season's roster wins where the two disagree.
  let currentOwnerByPlayer = new Map<number, number>();
  try {
    const currentRosters = await fetchFinalRosters(targetYear);
    for (const [playerId, entry] of currentRosters.byPlayerId) {
      currentOwnerByPlayer.set(playerId, entry.espnTeamId);
    }
  } catch {
    // Current-season rosters are optional — fall back to last season's.
  }

  const allEspnIds = [...rosters.byPlayerId.keys()].map(String);

  const { data: players } = await supabase
    .from('players')
    .select('id, name, position, nfl_team, espn_id')
    .in('espn_id', allEspnIds.length > 0 ? allEspnIds : ['-0']);

  const playerByEspnId = new Map((players ?? []).map(p => [p.espn_id, p]));

  // ---------------------------------------------------------------
  // Draft history for cost calculation
  // ---------------------------------------------------------------
  const { data: seasons } = await supabase.from('seasons').select('id, year');
  const yearBySeasonId = new Map((seasons ?? []).map(s => [s.id, s.year]));

  const playerIds = (players ?? []).map(p => p.id);
  const { data: picks } = await supabase
    .from('draft_picks')
    .select('season_id, player_id, round, is_keeper, keeper_year')
    .in('player_id', playerIds.length > 0 ? playerIds : [-1]);

  const historyByPlayer = new Map<number, DraftHistoryEntry[]>();
  for (const pick of picks ?? []) {
    const y = yearBySeasonId.get(pick.season_id);
    if (!y) continue;
    if (!historyByPlayer.has(pick.player_id)) historyByPlayer.set(pick.player_id, []);
    historyByPlayer.get(pick.player_id)!.push({
      year: y,
      round: pick.round,
      isKeeper: Boolean(pick.is_keeper),
      keeperYear: pick.keeper_year,
    });
  }

  // ---------------------------------------------------------------
  // Build per-owner eligible lists
  // ---------------------------------------------------------------
  const result = (owners ?? []).map(owner => {
    // Which ESPN team was this owner last season?
    const espnTeamId = [...rosters.byTeamId.keys()].find(
      id => getOwnerForTeam(id, prevYear) === owner.name
    );
    const entries = espnTeamId
      ? (rosters.byTeamId.get(espnTeamId) ?? []).filter(e => {
          // Dropped from this roster by an offseason trade.
          const now = currentOwnerByPlayer.get(e.espnPlayerId);
          return now === undefined || now === espnTeamId;
        })
      : [];

    // Picked up by an offseason trade — carried over with his prior status.
    if (espnTeamId) {
      for (const [playerId, teamId] of currentOwnerByPlayer) {
        if (teamId !== espnTeamId) continue;
        const prior = rosters.byPlayerId.get(playerId);
        if (prior && prior.espnTeamId !== espnTeamId) {
          entries.push({ ...prior, espnTeamId, acquisitionType: 'TRADE' });
        }
      }
    }

    const players = entries.map(entry => {
      const player = playerByEspnId.get(String(entry.espnPlayerId));
      if (!player) return null;

      // Picked up after the trade deadline — ineligible to keep.
      const pickedUpLate =
        !keepsDraftStatus(entry.acquisitionType) &&
        rosters.tradeDeadline !== null &&
        entry.acquisitionDate !== null &&
        entry.acquisitionDate > rosters.tradeDeadline;

      if (pickedUpLate) {
        return {
          player_id: player.id,
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

      const history = historyByPlayer.get(player.id) ?? [];
      const cost = computeKeeperCost(history, targetYear, {
        keepsDraftStatus: keepsDraftStatus(entry.acquisitionType),
      });

      return {
        player_id: player.id,
        player_name: player.name,
        position: player.position,
        nfl_team: player.nfl_team,
        original_round: history.length > 0 ? history[history.length - 1].round : 0,
        keeper_year: cost.keeperYear,
        round_cost: cost.roundCost,
        years_remaining: cost.eligible ? Math.max(0, 4 - cost.keeperYear) : 0,
        eligible: cost.eligible,
        source: cost.sourceType,
        ...(cost.reason ? { reason: cost.reason } : {}),
      };
    }).filter(Boolean);

    // Eligible first, then cheapest round (a lower round number costs more,
    // so sort ascending to put the priciest keepers at the top).
    players.sort((a, b) => {
      if (a!.eligible !== b!.eligible) return a!.eligible ? -1 : 1;
      return a!.round_cost - b!.round_cost;
    });

    return {
      owner_id: owner.id,
      owner_name: owner.name,
      team_name: owner.team_name,
      players,
    };
  });

  return NextResponse.json(result);
}
