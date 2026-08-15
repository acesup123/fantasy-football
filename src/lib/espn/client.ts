/**
 * Shared ESPN fantasy API client.
 *
 * Used by the nightly sync (/api/sync) and the live standings refresh
 * (/api/standings/live) so credentials and the team→owner mapping live in
 * exactly one place.
 */

export const ESPN_LEAGUE_ID = process.env.ESPN_LEAGUE_ID ?? '130046';
const ESPN_SWID = process.env.ESPN_SWID ?? '';
const ESPN_S2 = process.env.ESPN_S2 ?? '';

export function hasEspnCredentials(): boolean {
  return Boolean(ESPN_SWID && ESPN_S2);
}

// ESPN Team ID → owner name, with date ranges for franchises that changed hands
const TEAM_OWNERS: Record<number, { name: string; from: number; to: number }[]> = {
  1:  [{ name: 'Alex Altman', from: 2010, to: 9999 }],
  2:  [{ name: 'Joel Oubre', from: 2010, to: 9999 }],
  3:  [{ name: 'Kevin Whitlock', from: 2010, to: 9999 }],
  4:  [{ name: 'Bill Kling', from: 2010, to: 2020 }, { name: 'Ryan Parrilla', from: 2021, to: 9999 }],
  5:  [{ name: 'Kelly Mann', from: 2010, to: 9999 }],
  6:  [{ name: 'Justin Choy', from: 2010, to: 9999 }],
  7:  [{ name: 'Ed Lang', from: 2010, to: 9999 }],
  8:  [{ name: 'Sal Singh', from: 2010, to: 9999 }],
  9:  [{ name: 'Navi Singh', from: 2010, to: 9999 }],
  10: [{ name: 'Aaron Schwartz', from: 2010, to: 2015 }, { name: 'Marcus Moore', from: 2016, to: 9999 }],
  11: [{ name: 'Jason McCartney', from: 2010, to: 9999 }],
  12: [{ name: 'Matt B', from: 2010, to: 2017 }, { name: 'Lance Michihira', from: 2018, to: 9999 }],
};

export function getOwnerName(teamId: number, year: number): string | null {
  for (const e of TEAM_OWNERS[teamId] ?? []) {
    if (year >= e.from && year <= e.to) return e.name;
  }
  return null;
}

/**
 * ESPN returns 0 — not null — for every rank field before a season starts, so a
 * plain `?? null` persists a bogus rank of 0. Treat anything non-positive as
 * "no rank yet".
 */
export function rankOrNull(v: unknown): number | null {
  return typeof v === 'number' && v > 0 ? v : null;
}

export function getCurrentNFLSeason(): number {
  const now = new Date();
  // NFL season year: if before March, it's the previous year's season
  return now.getMonth() < 2 ? now.getFullYear() - 1 : now.getFullYear();
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function espnFetch(year: number, views: string[]): Promise<any> {
  const viewParams = views.map((v) => `view=${v}`).join('&');
  const url = `https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/${year}/segments/0/leagues/${ESPN_LEAGUE_ID}?${viewParams}`;
  const resp = await fetch(url, {
    headers: { Cookie: `SWID=${ESPN_SWID}; espn_s2=${ESPN_S2}` },
    next: { revalidate: 0 },
  });
  if (!resp.ok) throw new Error(`ESPN API error: ${resp.status}`);
  return resp.json();
}

export interface EspnStandingsRow {
  espnTeamId: number;
  ownerName: string | null;
  divisionId: number | null;
  divisionName: string | null;
  /** In-division W/L/T. ESPN does not track points in this bucket. */
  divisionWins: number | null;
  divisionLosses: number | null;
  divisionTies: number | null;
  wins: number;
  losses: number;
  ties: number;
  pointsFor: number;
  pointsAgainst: number;
  /** Regular-season standings rank. */
  playoffSeed: number | null;
  /** Final placement after playoffs — only meaningful once the season is complete. */
  finalRank: number | null;
  streakLength: number | null;
  streakType: 'WIN' | 'LOSS' | 'TIE' | null;
  gamesBack: number | null;
}

/**
 * Shape ESPN's mTeam payload into standings rows.
 *
 * Sorted by live standings order: wins desc, then points for desc — which is how
 * the league breaks ties. Note `finalRank` (rankCalculatedFinal) is a projection
 * until the season is complete; check `isSeasonComplete` before trusting it.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function buildStandings(league: any, year: number): EspnStandingsRow[] {
  // Same rule as the nightly sync: a projected final rank is not a result.
  const complete = isSeasonComplete(league);

  const divisionNames = getDivisionNames(league);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows: EspnStandingsRow[] = (league.teams ?? []).map((team: any) => {
    const rec = team.record?.overall ?? {};
    const div = team.record?.division ?? {};
    const divisionId = typeof team.divisionId === "number" ? team.divisionId : null;
    const streakType = rec.streakType ?? null;
    return {
      espnTeamId: team.id,
      ownerName: getOwnerName(team.id, year),
      divisionId,
      divisionName: divisionId === null ? null : divisionNames.get(divisionId) ?? null,
      divisionWins: typeof div.wins === "number" ? div.wins : null,
      divisionLosses: typeof div.losses === "number" ? div.losses : null,
      divisionTies: typeof div.ties === "number" ? div.ties : null,
      wins: rec.wins ?? 0,
      losses: rec.losses ?? 0,
      ties: rec.ties ?? 0,
      pointsFor: rec.pointsFor ?? 0,
      pointsAgainst: rec.pointsAgainst ?? 0,
      playoffSeed: rankOrNull(team.playoffSeed),
      finalRank: complete ? rankOrNull(team.rankCalculatedFinal) : null,
      streakLength: rec.streakLength ?? null,
      streakType:
        streakType === 'WIN' || streakType === 'LOSS' || streakType === 'TIE'
          ? streakType
          : null,
      gamesBack: rec.gamesBack ?? null,
    };
  });

  return rows.sort(compareStandings);
}

/**
 * Division id -> name, from settings.scheduleSettings.divisions.
 * Requires the mSettings view; returns an empty map without it.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getDivisionNames(league: any): Map<number, string> {
  const divisions = league?.settings?.scheduleSettings?.divisions ?? [];
  const map = new Map<number, string>();
  for (const d of divisions) {
    if (typeof d?.id === "number" && typeof d?.name === "string") map.set(d.id, d.name);
  }
  return map;
}

/**
 * Standings order used wherever ESPN's own seed isn't available.
 *
 * Seeded rows always sort by seed and always sort ahead of unseeded ones —
 * comparing seeded against unseeded on a different key would make the
 * comparator intransitive and yield an implementation-defined order.
 *
 * The fallback is win percentage (not raw wins) so a tie is worth half a win,
 * matching how ESPN itself ranks.
 */
export function compareStandings(
  a: Pick<EspnStandingsRow, 'playoffSeed' | 'wins' | 'losses' | 'ties' | 'pointsFor'>,
  b: Pick<EspnStandingsRow, 'playoffSeed' | 'wins' | 'losses' | 'ties' | 'pointsFor'>
): number {
  if (a.playoffSeed !== null && b.playoffSeed !== null) {
    return a.playoffSeed - b.playoffSeed;
  }
  if (a.playoffSeed !== null) return -1;
  if (b.playoffSeed !== null) return 1;

  return winPct(b) - winPct(a) || b.pointsFor - a.pointsFor;
}

function winPct(r: { wins: number; losses: number; ties: number }): number {
  const games = r.wins + r.losses + r.ties;
  return games === 0 ? 0 : (r.wins + r.ties / 2) / games;
}

/**
 * ESPN keeps updating rankCalculatedFinal during the season, where it is a
 * projection rather than a result. Only trust it once the season has finished.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function isSeasonComplete(league: any): boolean {
  const status = league.status ?? {};
  const final = status.finalScoringPeriod;
  const latest = status.latestScoringPeriod;
  // Deliberately not using status.isActive — it stays true on a finished season
  // (verified against 2025, which reported isActive with the playoffs long over).
  //
  // `final > 0` matters: ESPN reports 0/0 for both periods before a season is
  // set up, and 0 >= 0 would call an unplayed season complete — which would let
  // a projected rankCalculatedFinal be recorded as a real result.
  return (
    typeof final === 'number' &&
    typeof latest === 'number' &&
    final > 0 &&
    latest >= final
  );
}
