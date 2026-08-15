import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireLeagueMember } from '@/lib/api-auth';
import { getEspnTeamIdForOwner } from '@/lib/espn/config';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

/**
 * GET /api/draft/export?season_id=N&format=board|espn
 *
 * Downloads the draft board as CSV.
 *
 * - `board` (default): the full board for the league's records — one row per
 *   slot with owner, player, and keeper details.
 * - `espn`: the same picks shaped for entering into ESPN. ESPN has no write
 *   API for draft results, so getting them onto ESPN means the LM Tools
 *   "offline draft" entry flow — this sheet lists every pick in entry order
 *   with the ESPN team and ESPN player id to enter, keepers included (ESPN's
 *   offline entry wants all 15 rounds).
 *
 * Works mid-draft too (unmade picks export with an empty player), so a
 * partial board can be saved if the draft ever has to move to ESPN midway.
 */

function csvCell(v: string | number | null | undefined): string {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toCsv(rows: (string | number | null | undefined)[][]): string {
  return rows.map((r) => r.map(csvCell).join(',')).join('\n') + '\n';
}

export async function GET(request: NextRequest) {
  const auth = await requireLeagueMember();
  if (!auth.ok) return auth.response;

  const seasonId = Number(request.nextUrl.searchParams.get('season_id'));
  const format = request.nextUrl.searchParams.get('format') ?? 'board';

  if (!seasonId) {
    return NextResponse.json({ error: 'season_id is required' }, { status: 400 });
  }
  if (format !== 'board' && format !== 'espn') {
    return NextResponse.json({ error: 'format must be board or espn' }, { status: 400 });
  }

  const { data: season } = await supabase
    .from('seasons')
    .select('id, year')
    .eq('id', seasonId)
    .single();

  if (!season) {
    return NextResponse.json({ error: 'Season not found' }, { status: 404 });
  }

  const [{ data: picks }, { data: owners }] = await Promise.all([
    supabase
      .from('draft_picks')
      .select(
        'round, pick_in_round, overall_pick, current_owner_id, original_owner_id, is_keeper, keeper_year, is_auto_pick, players(name, position, nfl_team, espn_id)'
      )
      .eq('season_id', seasonId)
      .order('overall_pick'),
    supabase.from('owners').select('id, name, team_name'),
  ]);

  if (!picks?.length) {
    return NextResponse.json({ error: 'No draft board for this season' }, { status: 404 });
  }

  const ownerById = new Map((owners ?? []).map((o) => [o.id, o]));

  type PlayerCols = { name: string; position: string; nfl_team: string | null; espn_id: string | null };
  const playerOf = (p: (typeof picks)[number]): PlayerCols | null => {
    const rel = p.players as unknown;
    const row = Array.isArray(rel) ? rel[0] : rel;
    return (row as PlayerCols | null) ?? null;
  };

  let rows: (string | number | null | undefined)[][];

  if (format === 'espn') {
    rows = [
      [
        'Overall', 'Round', 'Pick', 'ESPN Team ID', 'ESPN Team Owner',
        'Player', 'Position', 'NFL Team', 'ESPN Player ID', 'Keeper',
      ],
      ...picks.map((p) => {
        const owner = ownerById.get(p.current_owner_id);
        const player = playerOf(p);
        return [
          p.overall_pick,
          p.round,
          p.pick_in_round,
          owner ? getEspnTeamIdForOwner(owner.name, season.year) : null,
          owner?.name,
          player?.name,
          player?.position,
          player?.nfl_team,
          player?.espn_id,
          p.is_keeper ? `K${p.keeper_year ?? ''}` : '',
        ];
      }),
    ];
  } else {
    rows = [
      [
        'Overall', 'Round', 'Pick', 'Team', 'Owner', 'Player', 'Position',
        'NFL Team', 'Keeper', 'Via Trade', 'Auto Pick',
      ],
      ...picks.map((p) => {
        const owner = ownerById.get(p.current_owner_id);
        const original = ownerById.get(p.original_owner_id);
        const player = playerOf(p);
        return [
          p.overall_pick,
          p.round,
          p.pick_in_round,
          owner?.team_name,
          owner?.name,
          player?.name,
          player?.position,
          player?.nfl_team,
          p.is_keeper ? `K${p.keeper_year ?? ''}` : '',
          p.current_owner_id !== p.original_owner_id ? `from ${original?.name ?? 'unknown'}` : '',
          p.is_auto_pick ? 'yes' : '',
        ];
      }),
    ];
  }

  const filename = `${season.year}-draft-${format === 'espn' ? 'espn-entry-sheet' : 'board'}.csv`;

  return new NextResponse(toCsv(rows), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  });
}
