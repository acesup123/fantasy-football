import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

/**
 * POST /api/trades/propose
 *
 * Body: {
 *   season_id: number,
 *   proposer_id: string,
 *   accepter_id: string,
 *   context: 'draft' | 'in_season' | 'offseason',
 *   notes?: string,
 *   conditions_description?: string,
 *   assets: Array<{
 *     from_owner_id: string,
 *     to_owner_id: string,
 *     asset_type: 'draft_pick' | 'player' | 'future_pick',
 *     draft_pick_id?: number,
 *     player_id?: number,
 *     future_season_year?: number,
 *     future_round?: number,
 *     description?: string,
 *   }>
 * }
 */
export async function POST(request: Request) {
  const body = await request.json();
  const { season_id, proposer_id, accepter_id, context, notes, conditions_description, assets } = body;

  // Validation
  if (!season_id || !proposer_id || !accepter_id || !assets || assets.length === 0) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
  }

  if (proposer_id === accepter_id) {
    return NextResponse.json({ error: 'Cannot trade with yourself' }, { status: 400 });
  }

  // Verify both owners exist and are active
  const { data: owners } = await supabase
    .from('owners')
    .select('id, is_active')
    .in('id', [proposer_id, accepter_id]);

  if (!owners || owners.length !== 2 || owners.some((o: any) => !o.is_active)) {
    return NextResponse.json({ error: 'Invalid or inactive owner' }, { status: 400 });
  }

  // Verify season exists
  const { data: season } = await supabase
    .from('seasons')
    .select('id')
    .eq('id', season_id)
    .single();

  if (!season) {
    return NextResponse.json({ error: 'Invalid season' }, { status: 400 });
  }

  // Validate draft pick assets — make sure they're owned by the from_owner
  for (const asset of assets) {
    if (asset.asset_type === 'draft_pick' && asset.draft_pick_id) {
      const { data: pick } = await supabase
        .from('draft_picks')
        .select('id, current_owner_id')
        .eq('id', asset.draft_pick_id)
        .single();

      if (!pick || pick.current_owner_id !== asset.from_owner_id) {
        return NextResponse.json(
          { error: `Draft pick ${asset.draft_pick_id} is not owned by the sending owner` },
          { status: 400 }
        );
      }
    }
  }

  // Create the trade
  const { data: trade, error: tradeError } = await supabase
    .from('trades')
    .insert({
      season_id,
      proposer_id,
      accepter_id,
      status: 'pending',
      context: context || 'offseason',
      proposed_at: new Date().toISOString(),
      notes: notes || null,
      conditions_description: conditions_description || null,
    })
    .select()
    .single();

  if (tradeError || !trade) {
    return NextResponse.json({ error: tradeError?.message || 'Failed to create trade' }, { status: 500 });
  }

  // Insert trade assets
  const assetRows = assets.map((a: any) => ({
    trade_id: trade.id,
    from_owner_id: a.from_owner_id,
    to_owner_id: a.to_owner_id,
    asset_type: a.asset_type,
    draft_pick_id: a.draft_pick_id || null,
    player_id: a.player_id || null,
    future_season_year: a.future_season_year || null,
    future_round: a.future_round || null,
    description: a.description || null,
  }));

  const { data: insertedAssets, error: assetsError } = await supabase
    .from('trade_assets')
    .insert(assetRows)
    .select();

  if (assetsError) {
    // Rollback: delete the trade if assets failed
    await supabase.from('trades').delete().eq('id', trade.id);
    return NextResponse.json({ error: assetsError.message }, { status: 500 });
  }

  return NextResponse.json({ success: true, trade, assets: insertedAssets });
}
