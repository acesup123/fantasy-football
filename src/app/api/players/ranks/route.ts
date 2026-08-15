import { NextResponse } from 'next/server';
import { unstable_cache } from 'next/cache';
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
 * fresh. The board degrades to alphabetical if this fails, so a draft is never
 * blocked on it.
 */
export const REVALIDATE_SECONDS = 600;

export interface RankRow {
  rank: number;
  adp: number | null;
  source: 'superflex' | 'ppr' | 'adp';
}

export interface RanksPayload {
  season: number;
  count: number;
  ranks: Record<string, RankRow>;
}

/**
 * Pull the league's player universe from ESPN and reduce it to a rank map.
 *
 * The reduction has to happen before anything is cached. ESPN's kona_player_info
 * response is ~4.5MB and Next refuses to store a fetch entry over 2MB, so
 * caching the *response* silently failed — every request re-pulled the full
 * 4.5MB, which on a live draft night is twelve browsers doing it on every load.
 * The reduced map is ~55KB, so caching that works and the fetch itself is
 * explicitly uncached to stop Next retrying the oversized write.
 */
async function fetchRanks(season: number): Promise<RanksPayload> {
  const url =
    `https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/${season}` +
    `/segments/0/leagues/${getLeagueId()}?view=kona_player_info`;

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
    // Too large for the data cache — unstable_cache below holds the result.
    cache: 'no-store',
  });

  if (!resp.ok) {
    throw new Error(`ESPN returned ${resp.status}`);
  }

  const data = await resp.json();
  const ranks: Record<string, RankRow> = {};

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
      source:
        typeof sf === 'number' && sf > 0 ? 'superflex'
        : typeof ppr === 'number' && ppr > 0 ? 'ppr'
        : 'adp',
    };
  }

  // An empty map means ESPN answered but the shape changed, or the cookies no
  // longer authorize the league. Caching that for ten minutes would silently
  // strip ranks off the board mid-draft, so treat it as a failure instead.
  if (Object.keys(ranks).length === 0) {
    throw new Error('ESPN returned no ranked players');
  }

  return { season, count: Object.keys(ranks).length, ranks };
}

/**
 * `use cache` would be the modern form of this, but it requires
 * `cacheComponents: true`, which changes rendering semantics app-wide — too
 * broad a change to make for one endpoint.
 */
const getCachedRanks = unstable_cache(
  fetchRanks,
  ['espn-player-ranks'],
  { revalidate: REVALIDATE_SECONDS, tags: ['espn-player-ranks'] }
);

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const season = parseInt(searchParams.get('season') ?? '') || new Date().getFullYear();

  if (!hasEspnCredentials()) {
    return NextResponse.json({ error: 'ESPN credentials not configured' }, { status: 500 });
  }

  try {
    const payload = await getCachedRanks(season);
    return NextResponse.json(payload);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to fetch ranks';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
