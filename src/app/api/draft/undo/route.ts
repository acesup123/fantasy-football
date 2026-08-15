import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireCommissioner } from '@/lib/api-auth';
import { clockKey, startClock } from '@/lib/draft/clock';
import { pointerAfterUndo, resolveUndoTarget } from '@/lib/draft/undo';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

/**
 * Reverse a pick mid-draft. Commissioner only.
 *
 * GET  /api/draft/undo?season_id=17            — what "undo last" would reverse
 * GET  /api/draft/undo?season_id=17&pick=45    — what undoing #45 would reverse
 * POST /api/draft/undo                         — do it
 *
 * Body: { season_id, overall_pick? }. Omitting overall_pick undoes the most
 * recent pick; naming one undoes that specific slot, which is what you want
 * when the mistake is noticed several picks later.
 *
 * Undoing an earlier slot deliberately leaves the picks after it alone. The
 * board reopens at the hole, that owner picks again, and /api/draft/pick's
 * "next slot that still needs a pick" advance carries on past the already-made
 * picks — so the rest of the draft is undisturbed.
 *
 * This is the narrow alternative to /api/draft/reset, which clears the whole
 * board. Undo is cheap and safe: the player returns to the pool and the same
 * slot can simply be re-picked.
 */

/** The columns the undo rules and the response both need. */
const PICK_COLUMNS = 'id, overall_pick, round, pick_in_round, player_id, picked_at, is_keeper, is_auto_pick, current_owner_id';

async function loadBoard(seasonId: number) {
  const { data } = await supabase
    .from('draft_picks')
    .select(PICK_COLUMNS)
    .eq('season_id', seasonId)
    .order('overall_pick', { ascending: true });

  return data ?? [];
}

/** Name the player and owner, so the response says what it actually reversed. */
async function describe(playerId: number | null, ownerId: string | null) {
  const [{ data: player }, { data: owner }] = await Promise.all([
    playerId
      ? supabase.from('players').select('id, name, position, nfl_team').eq('id', playerId).maybeSingle()
      : Promise.resolve({ data: null }),
    ownerId
      ? supabase.from('owners').select('id, name, team_name').eq('id', ownerId).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  return { player: player ?? null, owner: owner ?? null };
}

export async function GET(request: NextRequest) {
  const seasonId = parseInt(request.nextUrl.searchParams.get('season_id') ?? '');
  if (!seasonId) {
    return NextResponse.json({ error: 'Missing season_id' }, { status: 400 });
  }

  const auth = await requireCommissioner();
  if (!auth.ok) return auth.response;

  const rawPick = request.nextUrl.searchParams.get('pick');
  const requested = rawPick === null ? null : parseInt(rawPick, 10);
  if (rawPick !== null && Number.isNaN(requested)) {
    return NextResponse.json({ error: 'pick must be a number' }, { status: 400 });
  }

  const board = await loadBoard(seasonId);
  if (board.length === 0) {
    return NextResponse.json({ error: 'Season has no draft board' }, { status: 404 });
  }

  const target = resolveUndoTarget(board, requested);
  if (!target.ok) {
    return NextResponse.json({ undoable: false, reason: target.error });
  }

  return NextResponse.json({
    undoable: true,
    pick: {
      overall_pick: target.pick.overall_pick,
      round: target.pick.round,
      pick_in_round: target.pick.pick_in_round,
      is_auto_pick: target.pick.is_auto_pick,
    },
    ...(await describe(target.pick.player_id, target.pick.current_owner_id)),
    on_the_clock_after: pointerAfterUndo(board, target.pick.overall_pick),
  });
}

export async function POST(request: NextRequest) {
  try {
    const { season_id, overall_pick } = await request.json();

    if (!season_id) {
      return NextResponse.json({ error: 'Missing season_id' }, { status: 400 });
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

    // Undo applies to a draft that is running or has just finished. Before the
    // board exists there is nothing to reverse, and reopening a season that
    // moved on to keepers for next year would be a different operation.
    if (season.draft_status !== 'drafting' && season.draft_status !== 'complete') {
      return NextResponse.json(
        { error: `Draft is ${season.draft_status} — nothing to undo` },
        { status: 400 }
      );
    }

    const board = await loadBoard(season_id);
    if (board.length === 0) {
      return NextResponse.json({ error: 'Season has no draft board' }, { status: 404 });
    }

    const target = resolveUndoTarget(board, overall_pick ?? null);
    if (!target.ok) {
      return NextResponse.json({ error: target.error }, { status: 400 });
    }

    const undone = target.pick;
    // Read the names before clearing the row, while player_id is still set.
    const described = await describe(undone.player_id, undone.current_owner_id);

    // Clear the slot. The `not player_id is null` guard makes this a no-op if
    // a concurrent undo already cleared it, rather than silently "succeeding"
    // twice and rewinding the board two picks.
    const { data: cleared, error: clearErr } = await supabase
      .from('draft_picks')
      .update({ player_id: null, picked_at: null, is_auto_pick: false })
      .eq('id', undone.id)
      .not('player_id', 'is', null)
      .select('id');

    if (clearErr) {
      console.error('Failed to clear pick:', clearErr);
      return NextResponse.json({ error: 'Failed to reverse the pick' }, { status: 500 });
    }

    if (!cleared || cleared.length === 0) {
      return NextResponse.json(
        { error: `Pick #${undone.overall_pick} was already reversed` },
        { status: 409 }
      );
    }

    // Point the board at the earliest slot still needing a pick. Recomputed
    // from a fresh read rather than the board loaded above, so a pick made
    // while this ran is taken into account instead of being stomped.
    const pointer = pointerAfterUndo(await loadBoard(season_id), undone.overall_pick);

    const { error: seasonErr } = await supabase
      .from('seasons')
      .update({ current_pick_number: pointer, draft_status: 'drafting' })
      .eq('id', season_id);

    if (seasonErr) {
      console.error('Failed to rewind season pointer:', seasonErr);
      return NextResponse.json(
        { error: 'Pick was cleared but the board pointer did not move — check the draft' },
        { status: 500 }
      );
    }

    // Give whoever is back on the clock a full timer rather than the remains
    // of the previous pick's countdown.
    await supabase.from('league_settings').upsert(
      {
        key: clockKey(season_id),
        value: startClock(pointer, Date.now()),
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'key' }
    );

    return NextResponse.json({
      success: true,
      season_year: season.year,
      undone_pick: {
        overall_pick: undone.overall_pick,
        round: undone.round,
        pick_in_round: undone.pick_in_round,
      },
      ...described,
      on_the_clock: pointer,
      // A completed draft reopens — the slot that was just cleared has to be
      // filled again before it is finished.
      reopened: season.draft_status === 'complete',
      undone_by: auth.owner.name,
    });
  } catch (err) {
    console.error('Draft undo error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
