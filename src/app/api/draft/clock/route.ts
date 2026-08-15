import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireCommissioner } from '@/lib/api-auth';
import {
  clockKey, parseClock, viewClock, pauseClock, resumeClock, startClock,
} from '@/lib/draft/clock';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

/**
 * The draft clock, shared by everyone watching.
 *
 * GET  /api/draft/clock?season_id=17   — current deadline, for any viewer
 * POST /api/draft/clock                — pause / resume / reset, commissioner only
 *
 * The countdown used to run per browser, so it started whenever a tab noticed
 * the pick change and everyone saw a different number. The server owns it now:
 * it records when the current pick went on the clock and returns its own
 * timestamp, so clients can render the same deadline even if their machine's
 * clock is wrong.
 */

async function loadSeason(seasonId: number) {
  const { data } = await supabase
    .from('seasons')
    .select('id, current_pick_number, pick_timer_seconds, draft_status')
    .eq('id', seasonId)
    .single();
  return data;
}

async function readClock(seasonId: number, pickNumber: number, now: number) {
  const { data } = await supabase
    .from('league_settings')
    .select('value')
    .eq('key', clockKey(seasonId))
    .maybeSingle();
  return parseClock(data?.value, pickNumber, now);
}

async function writeClock(seasonId: number, state: unknown) {
  await supabase
    .from('league_settings')
    .upsert(
      { key: clockKey(seasonId), value: state, updated_at: new Date().toISOString() },
      { onConflict: 'key' }
    );
}

export async function GET(request: NextRequest) {
  const seasonId = parseInt(request.nextUrl.searchParams.get('season_id') ?? '');
  if (!seasonId) {
    return NextResponse.json({ error: 'Missing season_id' }, { status: 400 });
  }

  const season = await loadSeason(seasonId);
  if (!season) return NextResponse.json({ error: 'Season not found' }, { status: 404 });

  const pickNumber = season.current_pick_number ?? 0;
  const now = Date.now();
  const stored = await readClock(seasonId, pickNumber, now);

  // A pick advanced since the clock was last written — start it now. Persisted
  // so every client agrees on the start, not just the first one to ask.
  if (stored.pickNumber !== pickNumber) {
    const fresh = startClock(pickNumber, now);
    await writeClock(seasonId, fresh);
    return NextResponse.json(viewClock(fresh, season.pick_timer_seconds ?? 120, now));
  }

  return NextResponse.json(viewClock(stored, season.pick_timer_seconds ?? 120, now));
}

export async function POST(request: NextRequest) {
  try {
    const { season_id, action } = await request.json();

    if (!season_id || !['pause', 'resume', 'reset'].includes(action)) {
      return NextResponse.json(
        { error: 'Body must be { season_id, action: "pause" | "resume" | "reset" }' },
        { status: 400 }
      );
    }

    // Only the commissioner controls the clock.
    const auth = await requireCommissioner();
    if (!auth.ok) return auth.response;

    const season = await loadSeason(season_id);
    if (!season) return NextResponse.json({ error: 'Season not found' }, { status: 404 });

    const pickNumber = season.current_pick_number ?? 0;
    const now = Date.now();
    const stored = await readClock(season_id, pickNumber, now);

    const next =
      action === 'pause' ? pauseClock(stored, now)
      : action === 'resume' ? resumeClock(stored, now)
      : startClock(pickNumber, now);

    await writeClock(season_id, next);
    return NextResponse.json(viewClock(next, season.pick_timer_seconds ?? 120, now));
  } catch (err: any) {
    console.error('Draft clock error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
