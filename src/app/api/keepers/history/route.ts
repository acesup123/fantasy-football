import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

/**
 * GET /api/keepers/history?year=2025
 * Returns all keepers used in a specific year's draft (from draft_picks where is_keeper = true).
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const year = parseInt(searchParams.get('year') ?? '0');

  if (!year) {
    return NextResponse.json({ error: 'Missing year parameter' }, { status: 400 });
  }

  // Get season ID
  const { data: season } = await supabase
    .from('seasons')
    .select('id')
    .eq('year', year)
    .single();

  if (!season) {
    return NextResponse.json([]);
  }

  // Get all keeper picks for this season
  const { data: picks } = await supabase
    .from('draft_picks')
    .select('round, keeper_year, current_owner_id, players(name, position), owners!draft_picks_current_owner_id_fkey(id, name)')
    .eq('season_id', season.id)
    .eq('is_keeper', true)
    .order('round');

  const result = (picks ?? []).map((p: any) => ({
    player_name: p.players?.name ?? 'Unknown',
    position: p.players?.position ?? '?',
    round: p.round,
    keeper_year: p.keeper_year ?? 0,
    owner_name: p.owners?.name ?? 'Unknown',
    owner_id: p.owners?.id ?? '',
  }));

  return NextResponse.json(result);
}
