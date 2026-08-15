import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

/**
 * GET /api/keepers/current?season=2026
 *
 * The keeper elections currently on record for an upcoming season, read from
 * the `keepers` table (populated from ESPN by /api/keepers/sync).
 *
 * Distinct from /api/keepers/history, which reads finished drafts out of
 * `draft_picks` — an upcoming season has no draft picks yet.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const year = parseInt(searchParams.get('season') ?? '0');

  if (!year) {
    return NextResponse.json({ error: 'Missing season parameter' }, { status: 400 });
  }

  const { data: season } = await supabase
    .from('seasons')
    .select('id')
    .eq('year', year)
    .single();

  if (!season) return NextResponse.json([]);

  const { data, error } = await supabase
    .from('keepers')
    .select('owner_id, player_id, keeper_year, round_cost, source_type, players(name, position)')
    .eq('season_id', season.id)
    .order('round_cost');

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(
    (data ?? []).map((k: any) => ({
      owner_id: k.owner_id,
      player_id: k.player_id,
      player_name: k.players?.name ?? 'Unknown',
      position: k.players?.position ?? '?',
      keeper_year: k.keeper_year,
      round_cost: k.round_cost,
      source_type: k.source_type,
    }))
  );
}
