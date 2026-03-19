import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

/**
 * GET /api/players/[playerId]
 * Returns full player profile data: info, draft history, fantasy stats, ownership.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ playerId: string }> }
) {
  const { playerId } = await params;
  const id = parseInt(playerId, 10);
  if (isNaN(id)) return NextResponse.json({ error: 'Invalid ID' }, { status: 400 });

  // Player info
  const { data: player } = await supabase
    .from('players')
    .select('*')
    .eq('id', id)
    .single();

  if (!player) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  // Draft history
  const { data: draftPicks } = await supabase
    .from('draft_picks')
    .select('round, pick_in_round, overall_pick, is_keeper, keeper_year, season_id, current_owner_id, seasons(year), owners!draft_picks_current_owner_id_fkey(id, name)')
    .eq('player_id', id)
    .order('season_id', { ascending: false });

  // Matchup lineups — paginate to get all
  let allLineups: any[] = [];
  let offset = 0;
  while (true) {
    const { data } = await supabase
      .from('matchup_lineups')
      .select('points, is_starter, owner_id, matchups(week, season_id, seasons(year))')
      .eq('player_id', id)
      .range(offset, offset + 999);
    if (!data || data.length === 0) break;
    allLineups.push(...data);
    offset += 1000;
  }

  // Owner names
  const ownerIds = new Set<string>();
  for (const dp of draftPicks ?? []) {
    const o = (dp as any).owners;
    if (o?.id) ownerIds.add(o.id);
  }
  for (const l of allLineups) {
    if (l.owner_id) ownerIds.add(l.owner_id);
  }

  const { data: owners } = await supabase
    .from('owners')
    .select('id, name, team_name')
    .in('id', Array.from(ownerIds));

  const ownerMap = new Map((owners ?? []).map((o: any) => [o.id, o]));

  // Compute fantasy stats
  const starters = allLineups.filter(l => l.is_starter);
  const totalPts = allLineups.reduce((s, l) => s + (l.points ?? 0), 0);
  const starterPts = starters.reduce((s, l) => s + (l.points ?? 0), 0);
  const avgPpg = starters.length > 0 ? starterPts / starters.length : 0;

  // Best game
  let bestGame: any = null;
  for (const l of allLineups) {
    const pts = l.points ?? 0;
    if (!bestGame || pts > bestGame.points) {
      bestGame = {
        points: pts,
        year: l.matchups?.seasons?.year ?? 0,
        week: l.matchups?.week ?? 0,
        ownerName: ownerMap.get(l.owner_id)?.name ?? 'Unknown',
      };
    }
  }

  // Season breakdown
  const bySeason = new Map<number, { year: number; games: number; starts: number; pts: number; startPts: number }>();
  for (const l of allLineups) {
    const yr = l.matchups?.seasons?.year ?? 0;
    if (!bySeason.has(yr)) bySeason.set(yr, { year: yr, games: 0, starts: 0, pts: 0, startPts: 0 });
    const s = bySeason.get(yr)!;
    s.games++;
    s.pts += l.points ?? 0;
    if (l.is_starter) { s.starts++; s.startPts += l.points ?? 0; }
  }

  // Ownership timeline
  const ownership: { year: number; ownerName: string; type: string }[] = [];
  for (const dp of draftPicks ?? []) {
    const o = (dp as any).owners;
    const s = (dp as any).seasons;
    if (o && s) ownership.push({ year: s.year, ownerName: o.name, type: 'drafted' });
  }

  // Keeper info from most recent draft
  const latestPick = (draftPicks ?? [])[0] as any;
  let keeperInfo = null;
  if (latestPick) {
    const draftYear = latestPick.seasons?.year ?? 2025;
    const currentYear = new Date().getFullYear();
    const yearsKept = latestPick.keeper_year ?? 0;
    const originalRound = latestPick.round;
    const nextKeeperYear = yearsKept + 1;
    const roundCost = originalRound === 1 ? 1 : Math.max(1, originalRound - nextKeeperYear);
    const yearsRemaining = Math.max(0, 4 - nextKeeperYear);
    keeperInfo = {
      eligible: nextKeeperYear <= 4,
      keeperYear: nextKeeperYear,
      roundCost,
      yearsRemaining,
      lastDraftedBy: latestPick.owners?.name ?? 'Unknown',
      lastDraftedYear: draftYear,
      lastDraftedRound: originalRound,
    };
  }

  return NextResponse.json({
    player,
    draftHistory: (draftPicks ?? []).map((dp: any) => ({
      year: dp.seasons?.year,
      round: dp.round,
      pickInRound: dp.pick_in_round,
      overall: dp.overall_pick,
      owner: dp.owners?.name ?? 'Unknown',
      ownerId: dp.owners?.id,
      isKeeper: dp.is_keeper,
      keeperYear: dp.keeper_year,
    })),
    stats: {
      totalGames: allLineups.length,
      starterGames: starters.length,
      totalPoints: Math.round(totalPts * 10) / 10,
      starterPoints: Math.round(starterPts * 10) / 10,
      avgPpg: Math.round(avgPpg * 10) / 10,
      bestGame,
    },
    seasonBreakdown: Array.from(bySeason.values()).sort((a, b) => b.year - a.year),
    ownership,
    keeperInfo,
  });
}
