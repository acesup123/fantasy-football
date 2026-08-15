import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireCommissioner, requireLeagueMember } from '@/lib/api-auth';
import { assignRosterSlots } from '@/lib/draft/finalize';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

/**
 * Finalize a completed draft.
 *
 * The draft flips to 'complete' automatically when the last pick lands; this
 * is the explicit commissioner sign-off after that. It snapshots every team
 * into the `rosters` table (starters assigned by draft position, the rest to
 * the bench) and stamps the season finalized in league_settings. Re-running
 * it rebuilds the snapshot — useful after a post-draft undo/redo.
 *
 * GET  /api/draft/finalize?season_id=N  → finalized state (any league member)
 * POST /api/draft/finalize { season_id } → build the snapshot (commissioner)
 */

const finalizedKey = (seasonId: number) => `draft_finalized:${seasonId}`;

export async function GET(request: NextRequest) {
  const auth = await requireLeagueMember();
  if (!auth.ok) return auth.response;

  const seasonId = Number(request.nextUrl.searchParams.get('season_id'));
  if (!seasonId) {
    return NextResponse.json({ error: 'season_id is required' }, { status: 400 });
  }

  const { data } = await supabase
    .from('league_settings')
    .select('value')
    .eq('key', finalizedKey(seasonId))
    .maybeSingle();

  return NextResponse.json({
    finalized: Boolean(data),
    ...(data?.value as object | undefined),
  });
}

export async function POST(request: NextRequest) {
  try {
    const { season_id } = await request.json();
    if (!season_id) {
      return NextResponse.json({ error: 'season_id is required' }, { status: 400 });
    }

    const auth = await requireCommissioner();
    if (!auth.ok) return auth.response;

    const { data: season } = await supabase
      .from('seasons')
      .select('id, year, draft_status')
      .eq('id', season_id)
      .single();

    if (!season) {
      return NextResponse.json({ error: 'Season not found' }, { status: 404 });
    }

    if (season.draft_status !== 'complete') {
      return NextResponse.json(
        { error: `Draft is ${season.draft_status} — every pick must be in before finalizing` },
        { status: 400 }
      );
    }

    const { data: picks, error: picksErr } = await supabase
      .from('draft_picks')
      .select('overall_pick, current_owner_id, player_id, players(position)')
      .eq('season_id', season_id)
      .order('overall_pick');

    if (picksErr || !picks?.length) {
      return NextResponse.json({ error: 'No draft board for this season' }, { status: 400 });
    }

    const unfilled = picks.filter((p) => p.player_id === null).length;
    if (unfilled > 0) {
      return NextResponse.json(
        { error: `${unfilled} pick(s) have no player — the board is not actually complete` },
        { status: 400 }
      );
    }

    // Group per current owner — traded picks land on whoever holds them now.
    const byOwner = new Map<
      string,
      { playerId: number; position: string; overallPick: number }[]
    >();
    for (const p of picks) {
      // Supabase returns a to-one embed as an object, but normalize both shapes.
      const rel = p.players as unknown;
      const row = Array.isArray(rel) ? rel[0] : rel;
      const position = (row as { position?: string } | null)?.position;
      if (!position) {
        return NextResponse.json(
          { error: `Pick #${p.overall_pick} references a player with no position` },
          { status: 500 }
        );
      }
      const list = byOwner.get(p.current_owner_id) ?? [];
      list.push({ playerId: p.player_id!, position, overallPick: p.overall_pick });
      byOwner.set(p.current_owner_id, list);
    }

    const rows = [...byOwner.entries()].flatMap(([ownerId, entries]) =>
      assignRosterSlots(entries).map((a) => ({
        season_id,
        owner_id: ownerId,
        player_id: a.playerId,
        roster_slot: a.slot,
        acquisition_type: 'draft' as const,
      }))
    );

    // Rebuild the snapshot wholesale so re-finalizing after an undo doesn't
    // leave stale rows behind.
    const { error: deleteErr } = await supabase
      .from('rosters')
      .delete()
      .eq('season_id', season_id);
    if (deleteErr) {
      return NextResponse.json({ error: deleteErr.message }, { status: 500 });
    }

    const { error: insertErr } = await supabase.from('rosters').insert(rows);
    if (insertErr) {
      return NextResponse.json({ error: insertErr.message }, { status: 500 });
    }

    const stamp = {
      finalized_at: new Date().toISOString(),
      finalized_by: auth.owner.name,
      teams: byOwner.size,
      players: rows.length,
    };

    const { error: stampErr } = await supabase.from('league_settings').upsert(
      {
        key: finalizedKey(season_id),
        value: stamp,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'key' }
    );
    if (stampErr) {
      return NextResponse.json({ error: stampErr.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, season_year: season.year, ...stamp });
  } catch (err) {
    console.error('Draft finalize error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
