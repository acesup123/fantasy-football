import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireCommissioner } from '@/lib/api-auth';
import { clockKey, startClock } from '@/lib/draft/clock';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

/**
 * Reset the draft board. Commissioner only.
 *
 * GET  /api/draft/reset?season_id=17   — preview: what a reset would destroy
 * POST /api/draft/reset                — perform it, requires confirm: true
 *
 * Two modes:
 *
 *   "picks"  — clear every live pick and put the board back to the start.
 *              Keeper slots, pick ownership and the draft order are untouched.
 *              This is the "start the draft over" button.
 *
 *   "board"  — also regenerate every slot from the current keepers table, for
 *              when a keeper's round changed after the board was built.
 *              Requires the season's draft_order to still be set.
 *
 * Both are destructive and irreversible, so the body must carry confirm: true
 * and the response always reports exactly what was removed.
 */

async function summarize(seasonId: number) {
  const { count: livePicks } = await supabase
    .from('draft_picks')
    .select('id', { count: 'exact', head: true })
    .eq('season_id', seasonId)
    .eq('is_keeper', false)
    .not('player_id', 'is', null);

  const { count: keeperSlots } = await supabase
    .from('draft_picks')
    .select('id', { count: 'exact', head: true })
    .eq('season_id', seasonId)
    .eq('is_keeper', true);

  const { count: totalSlots } = await supabase
    .from('draft_picks')
    .select('id', { count: 'exact', head: true })
    .eq('season_id', seasonId);

  return {
    live_picks_that_would_be_lost: livePicks ?? 0,
    keeper_slots: keeperSlots ?? 0,
    total_slots: totalSlots ?? 0,
  };
}

export async function GET(request: NextRequest) {
  const seasonId = parseInt(request.nextUrl.searchParams.get('season_id') ?? '');
  if (!seasonId) return NextResponse.json({ error: 'Missing season_id' }, { status: 400 });

  const auth = await requireCommissioner();
  if (!auth.ok) return auth.response;

  const { data: season } = await supabase
    .from('seasons')
    .select('id, year, draft_status, current_pick_number')
    .eq('id', seasonId)
    .single();
  if (!season) return NextResponse.json({ error: 'Season not found' }, { status: 404 });

  return NextResponse.json({ season: { year: season.year, draft_status: season.draft_status }, ...(await summarize(seasonId)) });
}

export async function POST(request: NextRequest) {
  try {
    const { season_id, mode = 'picks', confirm } = await request.json();

    if (!season_id) return NextResponse.json({ error: 'Missing season_id' }, { status: 400 });
    if (!['picks', 'board'].includes(mode)) {
      return NextResponse.json({ error: 'mode must be "picks" or "board"' }, { status: 400 });
    }
    if (confirm !== true) {
      return NextResponse.json(
        { error: 'Refusing to reset without confirm: true', preview: await summarize(season_id) },
        { status: 400 }
      );
    }

    const auth = await requireCommissioner();
    if (!auth.ok) return auth.response;

    const { data: season } = await supabase
      .from('seasons')
      .select('id, year, draft_order, draft_status')
      .eq('id', season_id)
      .single();
    if (!season) return NextResponse.json({ error: 'Season not found' }, { status: 404 });

    const before = await summarize(season_id);

    if (mode === 'board') {
      if (!season.draft_order || (season.draft_order as string[]).length === 0) {
        return NextResponse.json(
          { error: 'Season has no draft order — cannot regenerate the board' },
          { status: 400 }
        );
      }
      // Regenerating slots is what /api/draft/initialize does; reuse it rather
      // than keeping a second copy of the board-building rules here.
      return NextResponse.json(
        {
          error:
            'Board regeneration runs through /api/draft/initialize. Set draft_status ' +
            'to keepers_locked first, then initialize — that path already applies ' +
            'keepers and traded picks.',
          preview: before,
        },
        { status: 409 }
      );
    }

    // ---- mode: "picks" — clear live picks, keep the board itself.
    const { error: clearErr } = await supabase
      .from('draft_picks')
      .update({ player_id: null, picked_at: null, is_auto_pick: false })
      .eq('season_id', season_id)
      .eq('is_keeper', false);

    if (clearErr) {
      return NextResponse.json({ error: `Failed to clear picks: ${clearErr.message}` }, { status: 500 });
    }

    const { data: firstOpen } = await supabase
      .from('draft_picks')
      .select('overall_pick')
      .eq('season_id', season_id)
      .is('player_id', null)
      .order('overall_pick', { ascending: true })
      .limit(1)
      .maybeSingle();

    const startingPick = firstOpen?.overall_pick ?? 1;

    await supabase
      .from('seasons')
      .update({ draft_status: 'drafting', current_pick_number: startingPick })
      .eq('id', season_id);

    // Put the clock back to a full timer on the pick now on the clock.
    await supabase.from('league_settings').upsert(
      { key: clockKey(season_id), value: startClock(startingPick, Date.now()), updated_at: new Date().toISOString() },
      { onConflict: 'key' }
    );

    return NextResponse.json({
      success: true,
      mode,
      season_year: season.year,
      picks_cleared: before.live_picks_that_would_be_lost,
      keeper_slots_kept: before.keeper_slots,
      on_the_clock: startingPick,
      reset_by: auth.owner.name,
    });
  } catch (err: any) {
    console.error('Draft reset error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
