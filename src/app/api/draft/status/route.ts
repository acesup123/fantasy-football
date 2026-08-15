import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireCommissioner } from '@/lib/api-auth';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

/**
 * POST /api/draft/status
 *
 * Body: { season_year: number, draft_status: 'keepers_open' | 'keepers_locked' | 'pending' }
 *
 * Moves a season through the pre-draft states. Locking keepers is what stops
 * the nightly ESPN keeper sync from rewriting them, so it has to happen before
 * the board is built — /api/draft/initialize bakes keepers into pick slots.
 *
 * Starting and completing the draft are deliberately NOT settable here:
 * 'drafting' is set by /api/draft/initialize once the board exists, so the two
 * can't drift apart.
 */

const SETTABLE = ['keepers_open', 'keepers_locked', 'pending'] as const;
type SettableStatus = (typeof SETTABLE)[number];

export async function POST(request: NextRequest) {
  try {
    const { season_year, draft_status } = await request.json();

    if (!season_year || !draft_status) {
      return NextResponse.json(
        { error: 'Missing required fields: season_year, draft_status' },
        { status: 400 }
      );
    }

    if (!SETTABLE.includes(draft_status as SettableStatus)) {
      return NextResponse.json(
        {
          error:
            `draft_status must be one of ${SETTABLE.join(', ')}. ` +
            `"drafting" is set by initializing the draft, not directly.`,
        },
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
        { error: `Draft is already ${season.draft_status} — cannot move it back` },
        { status: 400 }
      );
    }

    const { error } = await supabase
      .from('seasons')
      .update({ draft_status })
      .eq('id', season.id);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Report what's still outstanding before the draft can be initialized.
    const { count: keeperCount } = await supabase
      .from('keepers')
      .select('id', { count: 'exact', head: true })
      .eq('season_id', season.id);

    const { data: fresh } = await supabase
      .from('seasons')
      .select('draft_order')
      .eq('id', season.id)
      .single();

    return NextResponse.json({
      success: true,
      season_year,
      draft_status,
      keepers: keeperCount ?? 0,
      draft_order_set: (fresh?.draft_order ?? []).length === 12,
    });
  } catch (err: any) {
    console.error('Set draft status error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
