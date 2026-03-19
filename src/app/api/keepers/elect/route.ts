import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

/**
 * POST /api/keepers/elect
 *
 * Body: { season_year: number, owner_id: string, keepers: [{ player_id, keeper_year, round_cost, source_type }] }
 *
 * Saves keeper elections for an owner for a given season.
 */
export async function POST(request: Request) {
  const body = await request.json();
  const { season_year, owner_id, keepers } = body;

  if (!season_year || !owner_id || !keepers) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
  }

  if (keepers.length > 5) {
    return NextResponse.json({ error: 'Maximum 5 keepers allowed' }, { status: 400 });
  }

  // Get or create the target season
  let { data: season } = await supabase
    .from('seasons')
    .select('id, draft_status')
    .eq('year', season_year)
    .single();

  if (!season) {
    const { data: newSeason } = await supabase
      .from('seasons')
      .insert({ year: season_year, draft_status: 'keepers_open', draft_order: [] })
      .select()
      .single();
    season = newSeason;
  }

  if (!season) {
    return NextResponse.json({ error: 'Failed to get/create season' }, { status: 500 });
  }

  if (season.draft_status === 'drafting' || season.draft_status === 'complete') {
    return NextResponse.json({ error: 'Cannot modify keepers after draft has started' }, { status: 400 });
  }

  // Delete existing keeper elections for this owner/season
  await supabase
    .from('keepers')
    .delete()
    .eq('season_id', season.id)
    .eq('owner_id', owner_id);

  // Insert new keepers
  const keeperRows = keepers.map((k: any) => ({
    season_id: season!.id,
    owner_id,
    player_id: k.player_id,
    keeper_year: k.keeper_year,
    round_cost: k.round_cost,
    source_type: k.source_type ?? 'draft',
  }));

  const { data: inserted, error } = await supabase
    .from('keepers')
    .insert(keeperRows)
    .select();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true, keepers: inserted });
}
