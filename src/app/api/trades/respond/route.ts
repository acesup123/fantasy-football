import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

/**
 * POST /api/trades/respond
 *
 * Body: {
 *   trade_id: number,
 *   owner_id: string,       // The owner responding
 *   action: 'accept' | 'decline' | 'cancel' | 'void'
 * }
 *
 * - accept/decline: must be the accepter_id
 * - cancel: must be the proposer_id
 * - void: must be commissioner (not enforced here yet)
 *
 * On accept: updates draft_picks.current_owner_id for any draft_pick assets.
 */
export async function POST(request: Request) {
  const body = await request.json();
  const { trade_id, owner_id, action } = body;

  if (!trade_id || !owner_id || !action) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
  }

  if (!['accept', 'decline', 'cancel', 'void'].includes(action)) {
    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  }

  // Fetch the trade
  const { data: trade, error: fetchError } = await supabase
    .from('trades')
    .select('*')
    .eq('id', trade_id)
    .single();

  if (fetchError || !trade) {
    return NextResponse.json({ error: 'Trade not found' }, { status: 404 });
  }

  if (trade.status !== 'pending') {
    return NextResponse.json({ error: `Trade is already ${trade.status}` }, { status: 400 });
  }

  // Permission checks
  if (action === 'accept' || action === 'decline') {
    if (trade.accepter_id !== owner_id) {
      return NextResponse.json({ error: 'Only the trade recipient can accept or decline' }, { status: 403 });
    }
  } else if (action === 'cancel') {
    if (trade.proposer_id !== owner_id) {
      return NextResponse.json({ error: 'Only the proposer can cancel a trade' }, { status: 403 });
    }
  }
  // 'void' — skip permission check for now (commissioner-only in future)

  const statusMap: Record<string, string> = {
    accept: 'accepted',
    decline: 'declined',
    cancel: 'cancelled',
    void: 'voided',
  };

  const newStatus = statusMap[action];

  // Update trade status
  const { error: updateError } = await supabase
    .from('trades')
    .update({
      status: newStatus,
      resolved_at: new Date().toISOString(),
    })
    .eq('id', trade_id);

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  // If accepted, execute the trade — swap draft pick ownership
  if (action === 'accept') {
    const { data: assets } = await supabase
      .from('trade_assets')
      .select('*')
      .eq('trade_id', trade_id);

    if (assets) {
      for (const asset of assets) {
        if (asset.asset_type === 'draft_pick' && asset.draft_pick_id) {
          const { error: pickError } = await supabase
            .from('draft_picks')
            .update({ current_owner_id: asset.to_owner_id })
            .eq('id', asset.draft_pick_id);

          if (pickError) {
            console.error(`Failed to update pick ${asset.draft_pick_id}:`, pickError.message);
          }
        }
      }
    }
  }

  return NextResponse.json({ success: true, status: newStatus });
}
