/**
 * Authenticated ESPN Fantasy API requests.
 *
 * ESPN's read API needs the league cookies (SWID + espn_s2) for a private
 * league. Both live in env — never hardcode them.
 */

const ESPN_BASE = 'https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons';

function cookieHeader(): string {
  const swid = process.env.ESPN_SWID ?? '';
  const s2 = process.env.ESPN_S2 ?? '';
  return `SWID=${swid}; espn_s2=${s2}`;
}

export function hasEspnCredentials(): boolean {
  return Boolean(process.env.ESPN_SWID && process.env.ESPN_S2);
}

export function getLeagueId(): string {
  return process.env.ESPN_LEAGUE_ID ?? '130046';
}

/**
 * Fetch one or more views off the league endpoint for a season.
 */
export async function espnLeague(year: number, views: string[]): Promise<any> {
  const params = views.map(v => `view=${v}`).join('&');
  const url = `${ESPN_BASE}/${year}/segments/0/leagues/${getLeagueId()}?${params}`;

  const resp = await fetch(url, {
    headers: { Cookie: cookieHeader() },
    cache: 'no-store',
  });

  if (!resp.ok) {
    throw new Error(`ESPN API error ${resp.status} for ${year} (${views.join(',')})`);
  }
  return resp.json();
}

/**
 * Fetch the full player pool for a season.
 *
 * Note: ESPN ignores `filterIds` on the players_wl view, so there's no way to
 * request a subset — we pull the whole pool (~9k rows) and index it in memory.
 */
export async function espnPlayerPool(year: number, limit = 20000): Promise<any[]> {
  const url = `${ESPN_BASE}/${year}/players?scoringPeriodId=0&view=players_wl`;

  const resp = await fetch(url, {
    headers: {
      Cookie: cookieHeader(),
      'x-fantasy-filter': JSON.stringify({ players: { limit } }),
    },
    cache: 'no-store',
  });

  if (!resp.ok) {
    throw new Error(`ESPN player pool error ${resp.status} for ${year}`);
  }
  return resp.json();
}
