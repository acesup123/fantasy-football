import { NextResponse } from 'next/server';
import { getLeagueId, hasEspnCredentials } from '@/lib/espn/request';

/**
 * GET /api/players/ranks?season=2026
 *
 * ESPN draft ranks keyed by espn_id, so the draft board can order the player
 * pool by value instead of alphabetically.
 *
 * Superflex rank is the primary sort — this is a superflex league, and it
 * values quarterbacks very differently from standard. PPR and ADP are returned
 * alongside so the board can fall back per player.
 *
 * Ranks live here rather than on the players table because they change through
 * the preseason and would otherwise need a migration plus a nightly job to stay
 * fresh. Cached for 10 minutes; the board degrades to alphabetical if this
 * fails, so a draft is never blocked on it.
 */
export const revalidate = 600;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const season = parseInt(searchParams.get('season') ?? '') || new Date().getFullYear();

  if (!hasEspnCredentials()) {
    return NextResponse.json({ error: 'ESPN credentials not configured' }, { status: 500 });
  }

  const url =
    `https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/${season}` +
    `/segments/0/leagues/${getLeagueId()}?view=kona_player_info`;

  try {
    const resp = await fetch(url, {
      headers: {
        Cookie: `SWID=${process.env.ESPN_SWID}; espn_s2=${process.env.ESPN_S2}`,
        'x-fantasy-filter': JSON.stringify({
          players: {
            limit: 2000,
            sortDraftRanks: { sortPriority: 1, sortAsc: true, value: 'STANDARD' },
          },
        }),
      },
      next: { revalidate },
    });

    if (!resp.ok) {
      return NextResponse.json({ error: `ESPN returned ${resp.status}` }, { status: 502 });
    }

    const data = await resp.json();
    const ranks: Record<string, { rank: number; adp: number | null; source: string }> = {};

    for (const entry of data.players ?? []) {
      const p = entry.player;
      const espnId = String(entry.id ?? p?.id ?? '');
      if (!espnId || !p) continue;

      const byType = p.draftRanksByRankType ?? {};
      const sf = byType.SUPERFLEX?.rank;
      const ppr = byType.PPR?.rank;
      const adp = p.ownership?.averageDraftPosition ?? null;

      const rank =
        typeof sf === 'number' && sf > 0 ? sf
        : typeof ppr === 'number' && ppr > 0 ? ppr
        : typeof adp === 'number' && adp > 0 ? adp
        : null;

      if (rank === null) continue;

      ranks[espnId] = {
        rank,
        adp: typeof adp === 'number' && adp > 0 ? adp : null,
        source: typeof sf === 'number' && sf > 0 ? 'superflex' : typeof ppr === 'number' && ppr > 0 ? 'ppr' : 'adp',
      };
    }

    return NextResponse.json({ season, count: Object.keys(ranks).length, ranks });
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? 'Failed to fetch ranks' }, { status: 502 });
  }
}
