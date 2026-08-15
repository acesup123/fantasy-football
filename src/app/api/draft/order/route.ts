import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireCommissioner } from '@/lib/api-auth';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

/**
 * POST /api/draft/order
 *
 * Body: { season_year: number, draft_order: string[] }
 *
 * Persists the lottery result to seasons.draft_order — the 12 owner ids in
 * pick order, index 0 = pick 1.
 *
 * The lottery reveal is client-side, so without this the drawn order lived
 * only in React state and was lost on refresh. /api/draft/initialize reads
 * seasons.draft_order and refuses to run while it's empty.
 *
 * Refuses once the draft has started — the board is already built from the
 * order at that point, so changing it would silently desync the two.
 */
export async function POST(request: NextRequest) {
  try {
    const { season_year, draft_order } = await request.json();

    if (!season_year || !Array.isArray(draft_order)) {
      return NextResponse.json(
        { error: 'Missing required fields: season_year, draft_order' },
        { status: 400 }
      );
    }

    const auth = await requireCommissioner();
    if (!auth.ok) return auth.response;

    const { data: season } = await supabase
      .from('seasons')
      .select('id, draft_status')
      .eq('year', season_year)
      .single();

    if (!season) {
      return NextResponse.json({ error: `No season row for ${season_year}` }, { status: 404 });
    }

    if (season.draft_status === 'drafting' || season.draft_status === 'complete') {
      return NextResponse.json(
        { error: `Draft is ${season.draft_status} — the order is locked` },
        { status: 400 }
      );
    }

    // Must be a complete, duplicate-free set of real owners.
    const { data: owners } = await supabase.from('owners').select('id').eq('is_active', true);
    const validIds = new Set((owners ?? []).map(o => o.id));

    if (draft_order.length !== 12) {
      return NextResponse.json(
        { error: `Draft order must have 12 entries, got ${draft_order.length}` },
        { status: 400 }
      );
    }
    if (new Set(draft_order).size !== 12) {
      return NextResponse.json({ error: 'Draft order contains duplicate owners' }, { status: 400 });
    }
    const unknown = draft_order.filter((id: string) => !validIds.has(id));
    if (unknown.length > 0) {
      return NextResponse.json(
        { error: `Draft order contains unknown owner ids: ${unknown.join(', ')}` },
        { status: 400 }
      );
    }

    const { error } = await supabase
      .from('seasons')
      .update({ draft_order })
      .eq('id', season.id);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, season_year, draft_order });
  } catch (err: any) {
    console.error('Save draft order error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
